//! The sandbox gets a non-secret login placeholder. Provider credentials are
//! attached only here, on the host, to a fixed allowlist of model endpoints.
use axum::{
    body::{Body, to_bytes},
    extract::Request,
    http::{Method, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{fs, sync::Mutex};

mod diagnostics;
#[cfg(test)]
mod transport_tests;

const REQUEST_HEADERS: &[&str] = &[
    "content-type",
    "accept",
    "user-agent",
    "openai-beta",
    "originator",
    "version",
    "session-id",
    "thread-id",
    "x-client-request-id",
    "x-openai-subagent",
    "session_id",
    "conversation_id",
    "x-codex-turn-state",
    "x-codex-turn-metadata",
    "x-openai-client-request-id",
];

fn setting(name: &str, default: u64, min: u64, max: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
        .clamp(min, max)
}

fn retry_after(value: Option<&str>) -> Option<Duration> {
    let value = value?;
    value
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
        .or_else(|| {
            httpdate::parse_http_date(value)
                .ok()
                .map(|date| date.duration_since(SystemTime::now()).unwrap_or_default())
        })
}

#[derive(Clone)]
pub struct ModelRelay {
    auth_path: PathBuf,
    client: reqwest::Client,
    refresh: Arc<Mutex<()>>,
    diagnostics: PathBuf,
    #[cfg(test)]
    upstream_url: Option<String>,
}

impl ModelRelay {
    pub fn new(home: &Path) -> Result<Self, reqwest::Error> {
        Ok(Self {
            auth_path: home.join("auth.json"),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(15))
                // Codex's own SSE idle timeout is 300s. Do not preempt it.
                .read_timeout(Duration::from_secs(setting(
                    "YINGYA_MODEL_READ_TIMEOUT_SECS",
                    330,
                    330,
                    3600,
                )))
                .build()?,
            refresh: Default::default(),
            diagnostics: home.join("model-relay"),
            #[cfg(test)]
            upstream_url: None,
        })
    }

    pub async fn prepare_user_auth(&self, home: &Path) -> Result<(), String> {
        let auth = self.read_auth().await?;
        let placeholder = if auth["OPENAI_API_KEY"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
        {
            json!({"auth_mode":"apikey", "OPENAI_API_KEY":"yingya-host-relay"})
        } else if auth["tokens"]["access_token"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
        {
            let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({
                "exp": 4102444800_u64,
                "https://api.openai.com/auth": {"chatgpt_account_id":"yingya", "chatgpt_plan_type":"plus"}
            })).unwrap());
            let token = format!("e30.{payload}.placeholder");
            json!({"auth_mode":"chatgptAuthTokens", "OPENAI_API_KEY":null,
                "tokens":{"id_token":token,"access_token":token,"refresh_token":"","account_id":"yingya"}})
        } else {
            return Err("模型凭据不可用，请在宿主侧登录 Codex".into());
        };
        write_auth(&home.join("auth.json"), &placeholder).await
    }

    pub async fn ready(&self) -> Result<(), String> {
        let auth = self.read_auth().await?;
        if auth["OPENAI_API_KEY"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
            || auth["tokens"]["access_token"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
        {
            Ok(())
        } else {
            Err("模型凭据不可用".into())
        }
    }

    async fn read_auth(&self) -> Result<Value, String> {
        let bytes = fs::read(&self.auth_path)
            .await
            .map_err(|_| "模型凭据不可用")?;
        serde_json::from_slice(&bytes).map_err(|_| "模型凭据格式无效".into())
    }

    async fn credentials(&self) -> Result<Value, String> {
        // One refresh for all tenants; reread the host file to pick up a fresh login.
        let _guard = self.refresh.lock().await;
        // All user workers share the host refresh credential. Serialize refresh
        // across processes as well as tasks, without using the user sandbox.
        let lock_path = self.auth_path.with_extension("refresh.lock");
        let wait_started = tokio::time::Instant::now();
        let _process_guard = loop {
            if wait_started.elapsed() > Duration::from_secs(30) {
                return Err("模型凭据正在刷新，请稍后重试".into());
            }
            match crate::runtime::Ownership::acquire(&lock_path) {
                Ok(guard) => break guard,
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            }
        };
        let mut auth = self.read_auth().await?;
        if !access_token_expiring(&auth) {
            return Ok(auth);
        }
        let refresh = auth["tokens"]["refresh_token"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("模型登录已过期，请重新登录 Codex")?;
        let response = self.client.post("https://auth.openai.com/oauth/token")
            .timeout(Duration::from_secs(30))
            .json(&json!({"client_id":"app_EMoamEEZ73f0CkXaXp7hrann", "grant_type":"refresh_token", "refresh_token":refresh}))
            .send().await.map_err(|_| "模型登录刷新连接失败")?;
        if !response.status().is_success() {
            return Err("模型登录刷新失败，请重新登录 Codex".into());
        }
        let updated: Value = response.json().await.map_err(|_| "模型登录刷新响应无效")?;
        if updated["access_token"].as_str().is_none_or(str::is_empty) {
            return Err("模型登录刷新响应缺少令牌".into());
        }
        for field in ["access_token", "id_token", "refresh_token"] {
            if let Some(value) = updated[field].as_str().filter(|s| !s.is_empty()) {
                auth["tokens"][field] = Value::String(value.to_owned());
            }
        }
        write_auth(&self.auth_path, &auth).await?;
        Ok(auth)
    }

    pub async fn forward(
        &self,
        request: Request,
        accounts: crate::accounts::Accounts,
        user: &str,
    ) -> Response {
        if !request
            .uri()
            .path()
            .strip_prefix("/api/internal/model/backend-api/")
            .is_some_and(|path| allowed_endpoint(request.method(), path))
        {
            return StatusCode::NOT_FOUND.into_response();
        }
        let charge = if request.method() == Method::POST {
            match accounts.reserve_model(user) {
                Ok(charge)=>Some(charge),
                Err(message)=>return (StatusCode::PAYMENT_REQUIRED,axum::Json(json!({"error":{"message":message,"type":"quota_exceeded"},"message":message}))).into_response(),
            }
        } else {
            None
        };
        match self.forward_inner(request, charge).await {
            Ok(response) => response,
            Err(message) => (StatusCode::BAD_GATEWAY, message).into_response(),
        }
    }

    async fn forward_inner(
        &self,
        request: Request,
        mut charge: Option<crate::accounts::ModelCharge>,
    ) -> Result<Response, String> {
        let path = request
            .uri()
            .path()
            .strip_prefix("/api/internal/model/backend-api/")
            .ok_or("模型接口不存在")?;
        if !allowed_endpoint(request.method(), path) {
            return Ok(StatusCode::NOT_FOUND.into_response());
        }
        let mut diagnostic = diagnostics::Diagnostic::new(self.diagnostics.clone());
        let auth = self.credentials().await.inspect_err(|_| {
            diagnostic.record.outcome = "auth_error";
        })?;
        let api_key = auth["OPENAI_API_KEY"].as_str().filter(|s| !s.is_empty());
        let (base, tail, bearer) = if let Some(key) = api_key {
            (
                "https://api.openai.com/v1",
                path.strip_prefix("codex/").ok_or("模型接口不存在")?,
                key,
            )
        } else {
            (
                "https://chatgpt.com/backend-api",
                path,
                auth["tokens"]["access_token"]
                    .as_str()
                    .ok_or("模型凭据不可用")?,
            )
        };
        let url = format!(
            "{base}/{tail}{}",
            request
                .uri()
                .query()
                .map(|q| format!("?{q}"))
                .unwrap_or_default()
        );
        #[cfg(test)]
        let url = self.upstream_url.clone().unwrap_or(url);
        let mut outgoing = self
            .client
            .request(request.method().clone(), url)
            .bearer_auth(bearer);
        // Never forward client-controlled auth/account/host headers or cookies.
        for &name in REQUEST_HEADERS {
            if let Some(value) = request.headers().get(name) {
                outgoing = outgoing.header(name, value);
            }
        }
        if api_key.is_none()
            && let Some(account) = auth["tokens"]["account_id"].as_str()
        {
            outgoing = outgoing.header("chatgpt-account-id", account);
        }
        let encoding = request
            .headers()
            .get("content-encoding")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let body = to_bytes(request.into_body(), 25 * 1024 * 1024)
            .await
            .map_err(|_| "模型请求过大")?;
        let body = if let Some(charge) = charge.as_mut() {
            match model_body(&body, &encoding, charge) {
                Ok(body) => body,
                Err(error) => {
                    diagnostic.record.outcome = "invalid_request";
                    charge.settle(Some(0), 0)?;
                    return Err(error);
                }
            }
        } else {
            body.to_vec()
        };
        let key = if charge.is_some() {
            let value: Value = serde_json::from_slice(&body).map_err(|_| "模型请求格式无效")?;
            let model = value["model"].as_str().ok_or("模型请求缺少模型")?;
            diagnostic.record.model = diagnostics::code(Some(model));
            diagnostic.record.requested_tier = diagnostics::tier(value["service_tier"].as_str());
            diagnostic.record.request_fingerprint =
                Some(diagnostics::fingerprint(&String::from_utf8_lossy(&body)));
            let account = api_key
                .or_else(|| auth["tokens"]["account_id"].as_str())
                .unwrap_or(bearer);
            Some(diagnostics::fingerprint(&format!("{account}\0{model}")))
        } else {
            None
        };
        diagnostic.record.account_model = key;
        if let Some(charge) = charge.as_mut() {
            charge.mark_sent();
        }
        let mut upstream = match outgoing.body(body).send().await {
            Ok(response) => response,
            Err(error) => {
                diagnostic.record.outcome = match (error.is_connect(), error.is_timeout()) {
                    (true, true) => "connect_timeout",
                    (true, false) => "connect_error",
                    (false, true) => "headers_timeout",
                    _ => "request_error",
                };
                if error.is_connect()
                    && let Some(charge) = charge.as_mut()
                {
                    charge.settle(Some(0), 0)?;
                }
                return Err("模型服务连接失败".into());
            }
        };
        diagnostic.record.headers_ms = Some(diagnostic.elapsed_ms());
        diagnostic.record.status = Some(upstream.status().as_u16());
        diagnostic.record.upstream_request_id = diagnostics::code(
            upstream
                .headers()
                .get("x-request-id")
                .and_then(|h| h.to_str().ok()),
        );
        let retry_after = retry_after(
            upstream
                .headers()
                .get("retry-after")
                .and_then(|h| h.to_str().ok()),
        );
        diagnostic.record.retry_after_secs = retry_after.map(|d| d.as_secs());
        let status = upstream.status();
        if !upstream.status().is_success()
            && let Some(charge) = charge.as_mut()
        {
            charge.settle(Some(0), 0)?;
        }
        // The worker has an external-auth placeholder, so a provider 401 must
        // not ask it to refresh (or receive) the host's actual OAuth credentials.
        if upstream.status() == StatusCode::UNAUTHORIZED {
            diagnostic.record.outcome = "auth_error";
            return Err("宿主模型登录已失效，请重新登录 Codex 后重试".into());
        }
        if upstream.status().is_redirection() {
            diagnostic.record.outcome = "unexpected_redirect";
            return Err("模型接口发生非预期重定向".into());
        }
        let mut response = Response::builder().status(upstream.status());
        for name in [
            "content-type",
            "cache-control",
            "x-request-id",
            "retry-after",
            "x-codex-turn-state",
        ] {
            if let Some(value) = upstream.headers().get(name) {
                response = response.header(name, value);
            }
        }
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        tokio::spawn(async move {
            let mut usage = RelayUsage::default();
            loop {
                let chunk = tokio::select! {
                    _ = tx.closed() => break,
                    chunk = upstream.chunk() => chunk,
                };
                match chunk {
                    Ok(Some(bytes)) => {
                        if diagnostic.record.first_byte_ms.is_none() {
                            diagnostic.record.first_byte_ms = Some(diagnostic.elapsed_ms());
                        }
                        usage.push(&bytes);
                        if tx.send(Ok::<_, reqwest::Error>(bytes)).await.is_err() {
                            break;
                        }
                    }
                    Ok(None) => {
                        diagnostic.record.outcome = if status.is_success() {
                            "completed"
                        } else {
                            "upstream_http_error"
                        };
                        break;
                    }
                    Err(error) => {
                        diagnostic.record.outcome = if error.is_timeout() {
                            "stream_timeout"
                        } else {
                            "stream_error"
                        };
                        let _ = tx.send(Err(error)).await;
                        break;
                    }
                }
            }
            usage.finish();
            if diagnostic.record.outcome == "completed" {
                diagnostic.record.outcome = if usage.error_code.is_some() || usage.failed {
                    "provider_error"
                } else if usage.json_body != Some(true) && !usage.completed {
                    "incomplete_stream"
                } else {
                    "completed"
                };
            }
            diagnostic.record.actual_tier = usage.tier;
            diagnostic.record.error_code = usage.error_code;
            diagnostic.record.tokens = usage.tokens;
            if let Some(mut charge) = charge {
                charge.record_usage(usage.detail);
                if let Err(error) = charge.settle(usage.tokens, usage.images) {
                    tracing::error!(%error,"model usage settlement failed");
                }
            }
        });
        response
            .body(Body::from_stream(
                tokio_stream::wrappers::ReceiverStream::new(rx),
            ))
            .map_err(|_| "模型响应无效".into())
    }
}

fn model_body(
    bytes: &[u8],
    encoding: &str,
    charge: &crate::accounts::ModelCharge,
) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let decoded = match encoding {
        "" | "identity" => bytes.to_vec(),
        "zstd" => {
            let decoder =
                zstd::stream::read::Decoder::new(bytes).map_err(|_| "模型请求压缩格式无效")?;
            let mut output = Vec::new();
            decoder
                .take(25 * 1024 * 1024 + 1)
                .read_to_end(&mut output)
                .map_err(|_| "无法读取模型请求")?;
            output
        }
        _ => return Err("不支持的模型请求压缩格式".into()),
    };
    if decoded.len() > 25 * 1024 * 1024 {
        return Err("模型请求过大".into());
    }
    let mut value: Value = serde_json::from_slice(&decoded).map_err(|_| "模型请求格式无效")?;
    let model = value["model"]
        .as_str()
        .filter(|model| crate::model_settings::model_allowed(model))
        .ok_or("请选择已开放的四个模型")?;
    charge.set_billing_model(model)?;
    if let Some(tools) = value.get_mut("tools").and_then(Value::as_array_mut)
        && tools.iter().any(|t| t["type"] == "image_generation")
        && !charge.reserve_image()?
    {
        tools.retain(|t| t["type"] != "image_generation");
        if value.pointer("/tool_choice/type").and_then(Value::as_str) == Some("image_generation") {
            return Err("素材生成额度已用完，请联系管理员".into());
        }
    }
    serde_json::to_vec(&value).map_err(|e| e.to_string())
}

#[derive(Default)]
struct RelayUsage {
    buffer: Vec<u8>,
    tokens: Option<i64>,
    detail: Option<crate::accounts::TokenUsage>,
    images: i64,
    json_body: Option<bool>,
    tier: Option<String>,
    error_code: Option<String>,
    completed: bool,
    failed: bool,
}
impl RelayUsage {
    fn push(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
        if self.json_body.is_none() {
            self.json_body = self
                .buffer
                .iter()
                .find(|b| !b.is_ascii_whitespace())
                .map(|b| *b == b'{');
        }
        if self.json_body == Some(true) {
            if self.buffer.len() > 32 * 1024 * 1024 {
                self.buffer.clear();
            }
            return;
        }
        while let Some(end) = self.buffer.iter().position(|&b| b == b'\n') {
            let line: Vec<_> = self.buffer.drain(..=end).collect();
            if let Some(json) = line.strip_prefix(b"data:")
                && let Ok(value) = serde_json::from_slice::<Value>(json)
            {
                self.read(&value);
            }
        }
        if self.buffer.len() > 32 * 1024 * 1024 {
            self.buffer.clear();
        }
    }
    fn read(&mut self, value: &Value) {
        let response = value.get("response").unwrap_or(value);
        if let Some(tier) = diagnostics::tier(response["service_tier"].as_str()) {
            self.tier = Some(tier);
        }
        let error = response.get("error").unwrap_or(value);
        if let Some(code) = diagnostics::code(error["code"].as_str()) {
            self.error_code = Some(code);
        }
        self.failed |= matches!(
            value["type"].as_str(),
            Some("error" | "response.failed" | "response.incomplete")
        );
        self.completed |= value["type"] == "response.completed";
        if value["type"].as_str().is_some_and(|kind| {
            !matches!(
                kind,
                "response.completed" | "response.incomplete" | "response.failed"
            )
        }) {
            return;
        }
        if let Some(detail) = crate::accounts::TokenUsage::from_response(response) {
            self.detail = Some(detail);
        }
        if let Some(usage) = response.get("usage") {
            let tokens = usage["total_tokens"].as_i64().or_else(|| {
                Some(
                    usage["input_tokens"]
                        .as_i64()?
                        .saturating_add(usage["output_tokens"].as_i64()?),
                )
            });
            if let Some(tokens) = tokens {
                self.tokens = Some(tokens.max(self.tokens.unwrap_or(0)));
            }
            if let Some(output) = response["output"].as_array() {
                self.images = output
                    .iter()
                    .filter(|item| item["type"] == "image_generation_call")
                    .count() as i64;
            }
        }
    }
    fn finish(&mut self) {
        if let Ok(value) = serde_json::from_slice::<Value>(&self.buffer) {
            self.read(&value);
        } else if let Some(bytes) = self.buffer.strip_prefix(b"data:")
            && let Ok(value) = serde_json::from_slice::<Value>(bytes)
        {
            self.read(&value);
        }
    }
}

fn allowed_endpoint(method: &Method, path: &str) -> bool {
    match method.as_str() {
        "GET" => matches!(path, "codex/models" | "wham/usage"),
        "POST" => matches!(
            path,
            "codex/responses" | "codex/responses/compact" | "codex/memories/trace_summarize"
        ),
        _ => false,
    }
}

fn access_token_expiring(auth: &Value) -> bool {
    let Some(token) = auth["tokens"]["access_token"].as_str() else {
        return false;
    };
    let expiration = token
        .split('.')
        .nth(1)
        .and_then(|s| URL_SAFE_NO_PAD.decode(s).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v["exp"].as_u64());
    expiration.is_some_and(|exp| {
        exp <= SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            + 300
    })
}

async fn write_auth(path: &Path, auth: &Value) -> Result<(), String> {
    crate::agent_projects::reject_symlink_components(path)?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let bytes = serde_json::to_vec(auth).map_err(|_| "模型凭据格式无效")?;
    use tokio::io::AsyncWriteExt;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)
        .await
        .map_err(|_| "无法保存模型登录状态")?;
    let result = async {
        file.write_all(&bytes).await?;
        file.sync_all().await?;
        fs::rename(&temporary, path).await
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(temporary).await;
    }
    result.map_err(|_| "无法保存模型登录状态".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn usage_handles_fragmented_sse_duplicate_events_and_json() {
        let payload = json!({"type":"response.completed","response":{"usage":{"input_tokens":100,"output_tokens":20,"total_tokens":120},"output":[{"type":"image_generation_call"}]}});
        let sse = format!(
            "event: response.completed\r\ndata: {payload}\r\n\r\ndata: {payload}\n\ndata: [DONE]\n\n"
        );
        let mut usage = RelayUsage::default();
        for bytes in sse.as_bytes().chunks(3) {
            usage.push(bytes);
        }
        usage.finish();
        assert_eq!(usage.tokens, Some(120));
        assert_eq!(usage.images, 1);
        let mut usage = RelayUsage::default();
        let json =
            serde_json::to_vec_pretty(&json!({"usage":{"input_tokens":7,"output_tokens":3}}))
                .unwrap();
        for bytes in json.chunks(2) {
            usage.push(bytes);
        }
        usage.finish();
        assert_eq!(usage.tokens, Some(10));
    }
    #[test]
    fn streamed_input_output_usage_is_recorded_once_at_the_relay_boundary() {
        let db = crate::accounts::Accounts::open(Path::new(":memory:"), vec![]).unwrap();
        let (user, _) = db.login("bill-relay@example.test").unwrap();
        let mut charge = db.reserve_model(&user.id).unwrap();
        model_body(br#"{"model":"gpt-6-astra"}"#, "", &charge).unwrap();
        let mut usage = RelayUsage::default();
        let value = json!({"type":"response.completed","response":{"model":"gpt-6-astra","usage":{"input_tokens":100000,"output_tokens":10000,"total_tokens":110000,"input_tokens_details":{"cached_tokens":20000},"output_tokens_details":{"reasoning_tokens":9000}}}});
        let stream = format!("data: {value}\n\ndata: {value}\n\n");
        for chunk in stream.as_bytes().chunks(3) {
            usage.push(chunk);
        }
        usage.finish();
        charge.record_usage(usage.detail);
        charge.settle(usage.tokens, 0).unwrap();
        let month = db.billing_report(Some(&user.id), "2026-09").unwrap();
        // This assertion does not depend on the wall-clock month.
        assert_eq!(db.quota(&user.id).unwrap().used_tokens, 110000);
        assert_eq!(month["priceVersion"], "openai-standard-2026-09-11");
        let mut partial = RelayUsage::default();
        partial.read(&json!({"type":"response.created","response":{"usage":{"input_tokens":0,"output_tokens":0}}}));
        assert!(partial.tokens.is_none());
        assert!(partial.detail.is_none());
        let charge = db.reserve_model(&user.id).unwrap();
        assert!(model_body(br#"{"model":"gpt-5.5"}"#, "", &charge).is_err());
    }
    #[test]
    fn image_tools_remain_available_after_legacy_media_limit_in_compressed_requests() {
        let db = crate::accounts::Accounts::open(Path::new(":memory:"), vec![]).unwrap();
        let (user, _) = db.login("image@example.com").unwrap();
        for _ in 0..20 {
            db.consume_media(&user.id).unwrap();
        }
        let mut charge = db.reserve_model(&user.id).unwrap();
        let input = json!({"model":"gpt-6-astra","tools":[{"type":"image_generation"},{"type":"function","name":"example"}]});
        let compressed = zstd::stream::encode_all(input.to_string().as_bytes(), 1).unwrap();
        let body: Value =
            serde_json::from_slice(&model_body(&compressed, "zstd", &charge).unwrap()).unwrap();
        assert_eq!(body["tools"].as_array().unwrap().len(), 2);
        assert_eq!(body["tools"][0]["type"], "image_generation");
        assert_eq!(db.quota(&user.id).unwrap().reserved_media, 1);
        charge.settle(Some(0), 0).unwrap();
    }
    #[tokio::test]
    async fn sandbox_auth_never_contains_provider_credentials() {
        let root = std::env::temp_dir().join(format!("yingya-auth-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("user")).await.unwrap();
        let auth = json!({"tokens":{"access_token":"private-access", "refresh_token":"private-refresh", "id_token":"private-id", "account_id":"private-account"}});
        fs::write(root.join("auth.json"), serde_json::to_vec(&auth).unwrap())
            .await
            .unwrap();
        let relay = ModelRelay::new(&root).unwrap();
        relay.prepare_user_auth(&root.join("user")).await.unwrap();
        let text = fs::read_to_string(root.join("user/auth.json"))
            .await
            .unwrap();
        assert!(!text.contains("private-"));
        assert!(text.contains("chatgptAuthTokens"));
        assert_eq!(relay.read_auth().await.unwrap(), auth);
        fs::remove_dir_all(root).await.unwrap();
    }
    #[test]
    fn relay_only_accepts_model_operations() {
        assert!(allowed_endpoint(&Method::POST, "codex/responses"));
        for path in [
            "codex/../accounts",
            "codex/responses/../secrets",
            "codex/responses/https://evil.example",
            "accounts",
            "codex/auth",
        ] {
            assert!(!allowed_endpoint(&Method::POST, path));
        }
        assert!(!allowed_endpoint(&Method::GET, "codex/responses"));
    }
}
