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

#[derive(Clone)]
pub struct ModelRelay {
    auth_path: PathBuf,
    client: reqwest::Client,
    refresh: Arc<Mutex<()>>,
}

impl ModelRelay {
    pub fn new(home: &Path) -> Result<Self, reqwest::Error> {
        Ok(Self {
            auth_path: home.join("auth.json"),
            client: reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .read_timeout(Duration::from_secs(120))
                .build()?,
            refresh: Default::default(),
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

    async fn read_auth(&self) -> Result<Value, String> {
        let bytes = fs::read(&self.auth_path)
            .await
            .map_err(|_| "模型凭据不可用")?;
        serde_json::from_slice(&bytes).map_err(|_| "模型凭据格式无效".into())
    }

    async fn credentials(&self) -> Result<Value, String> {
        // One refresh for all tenants; reread the host file to pick up a fresh login.
        let _guard = self.refresh.lock().await;
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

    pub async fn forward(&self, request: Request) -> Response {
        match self.forward_inner(request).await {
            Ok(response) => response,
            Err(message) => (StatusCode::BAD_GATEWAY, message).into_response(),
        }
    }

    async fn forward_inner(&self, request: Request) -> Result<Response, String> {
        let path = request
            .uri()
            .path()
            .strip_prefix("/api/internal/model/backend-api/")
            .ok_or("模型接口不存在")?;
        if !allowed_endpoint(request.method(), path) {
            return Ok(StatusCode::NOT_FOUND.into_response());
        }
        let auth = self.credentials().await?;
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
        let mut outgoing = self
            .client
            .request(request.method().clone(), url)
            .bearer_auth(bearer);
        // Never forward client-controlled auth/account/host headers or cookies.
        for name in [
            "content-type",
            "accept",
            "content-encoding",
            "user-agent",
            "openai-beta",
            "originator",
            "version",
            "session_id",
            "conversation_id",
            "x-codex-turn-state",
            "x-codex-turn-metadata",
            "x-openai-client-request-id",
        ] {
            if let Some(value) = request.headers().get(name) {
                outgoing = outgoing.header(name, value);
            }
        }
        if api_key.is_none()
            && let Some(account) = auth["tokens"]["account_id"].as_str()
        {
            outgoing = outgoing.header("chatgpt-account-id", account);
        }
        let body = to_bytes(request.into_body(), 25 * 1024 * 1024)
            .await
            .map_err(|_| "模型请求过大")?;
        let mut upstream = outgoing
            .body(body)
            .send()
            .await
            .map_err(|_| "模型服务连接失败")?;
        // The worker has an external-auth placeholder, so a provider 401 must
        // not ask it to refresh (or receive) the host's actual OAuth credentials.
        if upstream.status() == StatusCode::UNAUTHORIZED {
            return Err("宿主模型登录已失效，请重新登录 Codex 后重试".into());
        }
        if upstream.status().is_redirection() {
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
            loop {
                let chunk = tokio::select! {
                    _ = tx.closed() => break,
                    chunk = upstream.chunk() => chunk,
                };
                match chunk {
                    Ok(Some(bytes)) => {
                        if tx.send(Ok::<_, reqwest::Error>(bytes)).await.is_err() {
                            break;
                        }
                    }
                    Ok(None) => break,
                    Err(error) => {
                        let _ = tx.send(Err(error)).await;
                        break;
                    }
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
