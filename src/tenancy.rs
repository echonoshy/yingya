use super::*;
use axum::{
    body::{Body, to_bytes},
    extract::Request,
    http::{Uri, header::SET_COOKIE},
};
use std::collections::HashMap;
use tower::ServiceExt;

#[derive(Clone)]
struct PreviewGrant {
    user: User,
    project: String,
    session: String,
    expires: i64,
}

#[derive(Clone)]
struct Gateway {
    previews: Arc<Mutex<HashMap<String, PreviewGrant>>>,
    paths: AppPaths,
    accounts: Accounts,
    tenants: Arc<Mutex<HashMap<String, Router>>>,
    service_tokens: Arc<Mutex<HashMap<String, User>>>,
}
#[derive(Deserialize)]
struct Login {
    email: String,
}
#[derive(Default, Deserialize)]
struct UsageQuery {
    since: Option<i64>,
    until: Option<i64>,
    model: Option<String>,
}
fn failure(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"message":message}))).into_response()
}
fn cookie(headers: &HeaderMap) -> Option<&str> {
    headers
        .get("cookie")?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|part| part.trim().strip_prefix("yingya_session="))
}
fn user(g: &Gateway, headers: &HeaderMap) -> Option<User> {
    g.accounts.session(cookie(headers)?)
}
fn same_origin(headers: &HeaderMap) -> bool {
    if let Some(site) = headers.get("sec-fetch-site").and_then(|v| v.to_str().ok())
        && site == "cross-site"
    {
        return false;
    }
    if let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) {
        let Ok(origin) = origin.parse::<Uri>() else {
            return false;
        };
        return origin.authority().map(|a| a.as_str())
            == headers.get("host").and_then(|h| h.to_str().ok());
    }
    true
}
pub(super) async fn run() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("yingya_server=info")),
        )
        .init();
    let mut paths = AppPaths::from_env().map_err(std::io::Error::other)?;
    fs::create_dir_all(paths.app_data.join("users")).await?;
    paths.app_data = fs::canonicalize(paths.app_data).await?;
    paths.resources = fs::canonicalize(paths.resources).await?;
    let accounts = Accounts::open(
        &paths.app_data.join("yingya.sqlite"),
        env::var("YINGYA_ADMIN_EMAILS")
            .unwrap_or_default()
            .split(',')
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned)
            .collect(),
    )
    .map_err(std::io::Error::other)?;
    let state = Gateway {
        previews: Default::default(),
        paths,
        accounts,
        tenants: Default::default(),
        service_tokens: Default::default(),
    };
    let app = Router::new()
        .route(
            "/health",
            get(|| async {
                Json(json!({"status":"ok","backend":"rust","loginMode":"email-preview"}))
            }),
        )
        .route("/api/auth/login", post(login))
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        .route("/api/usage", get(usage))
        .route("/api/admin/usage", get(admin_usage))
        .fallback(dispatch)
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .with_state(state);
    let address: SocketAddr = env::var("YINGYA_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8797".into())
        .parse()?;
    let listener = TcpListener::bind(address).await?;
    info!(%address,"Yingya multi-user backend is listening");
    axum::serve(listener, app).await?;
    Ok(())
}
async fn login(State(g): State<Gateway>, headers: HeaderMap, Json(input): Json<Login>) -> Response {
    if !same_origin(&headers) {
        return failure(StatusCode::FORBIDDEN, "不允许跨站登录");
    }
    match g.accounts.login(&input.email) {
        Ok((user, token)) => {
            if let Some(old) = cookie(&headers) {
                let _ = g.accounts.logout(old);
            }
            let mut response =
                Json(json!({"user":user,"loginMode":"email-preview"})).into_response();
            let secure = env_bool("YINGYA_SECURE_COOKIES", false);
            response.headers_mut().insert(
                SET_COOKIE,
                format!(
                    "yingya_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000{}",
                    if secure { "; Secure" } else { "" }
                )
                .parse()
                .unwrap(),
            );
            response
                .headers_mut()
                .insert("cache-control", "no-store".parse().unwrap());
            response
        }
        Err(message) => failure(StatusCode::BAD_REQUEST, &message),
    }
}
async fn logout(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    if !same_origin(&headers) {
        return failure(StatusCode::FORBIDDEN, "不允许跨站请求");
    }
    if let Some(token) = cookie(&headers)
        && let Err(error) = g.accounts.logout(token)
    {
        return failure(StatusCode::INTERNAL_SERVER_ERROR, &error);
    }
    let mut r = StatusCode::NO_CONTENT.into_response();
    r.headers_mut().insert(
        SET_COOKIE,
        "yingya_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
            .parse()
            .unwrap(),
    );
    r
}
async fn me(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    let Some(user) = user(&g, &headers) else {
        return failure(StatusCode::UNAUTHORIZED, "请先登录");
    };
    let mut r = Json(json!({"user":user,"loginMode":"email-preview"})).into_response();
    r.headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    r
}
async fn usage(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Query(q): Query<UsageQuery>,
) -> Response {
    report(g, headers, q, false)
}
async fn admin_usage(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Query(q): Query<UsageQuery>,
) -> Response {
    report(g, headers, q, true)
}
fn report(g: Gateway, headers: HeaderMap, q: UsageQuery, admin: bool) -> Response {
    let Some(user) = user(&g, &headers) else {
        return failure(StatusCode::UNAUTHORIZED, "请先登录");
    };
    if admin && !user.is_admin {
        return failure(StatusCode::FORBIDDEN, "仅管理员可以查看所有用户用量");
    }
    let since = q.since.unwrap_or(0);
    let until = q.until.unwrap_or(crate::accounts::now() + 1);
    if since < 0 || until <= since {
        return failure(StatusCode::BAD_REQUEST, "日期范围无效");
    }
    match g.accounts.usage(
        if admin { None } else { Some(&user.id) },
        since,
        until,
        q.model.as_deref().filter(|s| !s.is_empty()),
    ) {
        Ok(value) => {
            let mut r = Json(value).into_response();
            r.headers_mut()
                .insert("cache-control", "no-store".parse().unwrap());
            r
        }
        Err(e) => failure(StatusCode::INTERNAL_SERVER_ERROR, &e),
    }
}
async fn copy_tree(source: &FilePath, dest: &FilePath) -> Result<(), std::io::Error> {
    let mut pending = vec![(source.to_owned(), dest.to_owned())];
    while let Some((source, dest)) = pending.pop() {
        fs::create_dir_all(&dest).await?;
        let mut entries = fs::read_dir(source).await?;
        while let Some(e) = entries.next_entry().await? {
            let kind = e.file_type().await?;
            if kind.is_dir() {
                pending.push((e.path(), dest.join(e.file_name())));
            } else if kind.is_file() {
                fs::copy(e.path(), dest.join(e.file_name())).await?;
            }
        }
    }
    Ok(())
}
impl Gateway {
    async fn router(&self, user: &User) -> Result<Router, String> {
        let mut tenants = self.tenants.lock().await;
        if let Some(router) = tenants.get(&user.id) {
            return Ok(router.clone());
        }
        let root = self.paths.app_data.join("users").join(&user.id);
        for dir in [
            "projects",
            "assets",
            "voices",
            "runtime/home",
            "runtime/codex-home",
            "runtime/hyperframes-home",
        ] {
            fs::create_dir_all(root.join(dir))
                .await
                .map_err(|e| e.to_string())?;
        }
        // Only credentials and installed skills are copied. No shared conversations, histories or project trust.
        let home = root.join("runtime/codex-home");
        fs::copy(
            self.paths.codex_home.join("auth.json"),
            home.join("auth.json"),
        )
        .await
        .map_err(|e| format!("模型凭据不可用：{e}"))?;
        copy_tree(&self.paths.codex_home.join("skills"), &home.join("skills"))
            .await
            .map_err(|e| e.to_string())?;
        let token = crate::accounts::secret();
        self.service_tokens
            .lock()
            .await
            .insert(token.clone(), user.clone());
        let paths = AppPaths {
            resources: self.paths.resources.clone(),
            app_data: root.clone(),
            cache: root.join("runtime/cache"),
            runtime: root.join("runtime"),
            projects: root.join("projects"),
            assets: root.join("assets"),
            codex_home: home,
            hyperframes_home: root.join("runtime/hyperframes-home"),
        };
        // Reuse the installed browser binary as read-only tooling.
        let router = user_router(paths, self.accounts.clone(), user.clone(), &token)
            .await
            .map_err(|e| e.to_string())?;
        tenants.insert(user.id.clone(), router.clone());
        Ok(router)
    }
}
async fn dispatch(State(g): State<Gateway>, mut request: Request) -> Response {
    if !request.uri().path().starts_with("/api/") && !request.uri().path().starts_with("/assets/") {
        let dir = g.paths.resources.join("web-dist");
        return ServeDir::new(&dir)
            .not_found_service(ServeFile::new(dir.join("index.html")))
            .oneshot(request)
            .await
            .unwrap()
            .into_response();
    }

    let preview_request = if let Some(rest) = request.uri().path().strip_prefix("/api/preview/") {
        if request.method() != "GET" && request.method() != "HEAD" {
            return failure(StatusCode::METHOD_NOT_ALLOWED, "预览只支持读取文件");
        }
        let Some((token, tail)) = rest.split_once('/') else {
            return failure(StatusCode::NOT_FOUND, "预览不存在");
        };
        let grant = g.previews.lock().await.get(token).cloned();
        let Some(grant) = grant.filter(|p| {
            p.expires > crate::accounts::now() && g.accounts.session(&p.session).is_some()
        }) else {
            return failure(StatusCode::UNAUTHORIZED, "预览已过期，请重新连接");
        };
        Some((grant, tail.to_owned()))
    } else {
        None
    };
    let service_token = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));
    let service = if let Some(token) = service_token {
        g.service_tokens.lock().await.get(token).cloned()
    } else {
        None
    };
    let internal = service.is_some();
    let Some(user) = preview_request
        .as_ref()
        .map(|(p, _)| p.user.clone())
        .or(service)
        .or_else(|| user(&g, request.headers()))
    else {
        return failure(StatusCode::UNAUTHORIZED, "请先登录");
    };
    if !internal && preview_request.is_none() && !same_origin(request.headers()) {
        return failure(StatusCode::FORBIDDEN, "不允许跨站请求");
    }
    if let Some(expected) = request
        .headers()
        .get("x-yingya-user")
        .and_then(|v| v.to_str().ok())
        && expected != user.id
    {
        return failure(StatusCode::UNAUTHORIZED, "账号已切换，请刷新页面");
    }
    let raw_path = request.uri().path().to_owned();
    let mut path = preview_request
        .as_ref()
        .map(|(grant, tail)| format!("/api/agent-projects/{}/files/{tail}", grant.project))
        .unwrap_or_else(|| raw_path.clone());
    for prefix in ["/api/u/", "/assets/u/"] {
        if let Some(rest) = path.strip_prefix(prefix) {
            let Some((id, tail)) = rest.split_once('/') else {
                return failure(StatusCode::NOT_FOUND, "资源不存在");
            };
            if id != user.id {
                return failure(StatusCode::NOT_FOUND, "资源不存在");
            }
            path = format!(
                "{}{tail}",
                if prefix.starts_with("/api") {
                    "/api/"
                } else {
                    "/assets/"
                }
            );
            break;
        }
    }
    if path.starts_with("/api/internal/") && !internal {
        return failure(StatusCode::NOT_FOUND, "接口不存在");
    }
    if path.starts_with("/api/auth/") || path.starts_with("/api/admin/") || path == "/api/usage" {
        return failure(StatusCode::NOT_FOUND, "接口不存在");
    }
    let root = g.paths.app_data.join("users").join(&user.id);
    if let Some(rest) = path.strip_prefix("/api/agent-projects/") {
        let id = rest.split('/').next().unwrap_or("");
        if Uuid::parse_str(id).is_err()
            || !root
                .join("projects")
                .join(id)
                .join("project.json")
                .is_file()
        {
            return failure(StatusCode::NOT_FOUND, "项目不存在");
        }
    }
    if let Err(e) = reject_escaping_links(&root).await {
        return failure(StatusCode::FORBIDDEN, &e);
    }
    let uri = format!(
        "{path}{}",
        request
            .uri()
            .query()
            .map(|q| format!("?{q}"))
            .unwrap_or_default()
    );
    *request.uri_mut() = match uri.parse() {
        Ok(uri) => uri,
        Err(_) => return failure(StatusCode::BAD_REQUEST, "无效路径"),
    };
    if request
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"))
    {
        let (parts, body) = request.into_parts();
        let bytes = match to_bytes(body, 25 * 1024 * 1024).await {
            Ok(b) => b,
            Err(_) => return failure(StatusCode::PAYLOAD_TOO_LARGE, "请求过大"),
        };
        let mut bytes = bytes.to_vec();
        if let Ok(mut value) = serde_json::from_slice::<Value>(&bytes) {
            normalize_input(&mut value, &user.id);
            bytes = serde_json::to_vec(&value).unwrap();
        }
        request = Request::from_parts(parts, Body::from(bytes));
        request.headers_mut().remove(CONTENT_LENGTH);
    }
    let preview_link = if !internal
        && preview_request.is_none()
        && (path.ends_with("/studio") || path.ends_with("/studio/heartbeat"))
    {
        if let Some(session) = cookie(request.headers()) {
            let project = path
                .strip_prefix("/api/agent-projects/")
                .and_then(|s| s.split('/').next())
                .unwrap_or("");
            let mut grants = g.previews.lock().await;
            grants.retain(|_, p| p.expires > crate::accounts::now());
            let existing = grants
                .iter()
                .find(|(_, p)| p.session == session && p.project == project)
                .map(|(token, _)| token.clone());
            let token = existing.unwrap_or_else(crate::accounts::secret);
            grants.insert(
                token.clone(),
                PreviewGrant {
                    user: user.clone(),
                    project: project.into(),
                    session: session.into(),
                    expires: crate::accounts::now() + 1800,
                },
            );
            Some(format!("/api/preview/{token}/index.html"))
        } else {
            None
        }
    } else {
        None
    };
    let router = match g.router(&user).await {
        Ok(r) => r,
        Err(e) => {
            warn!(%e,"user runtime unavailable");
            return failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "用户运行环境启动失败，请检查后端日志",
            );
        }
    };
    let mut response = router.oneshot(request).await.unwrap();
    if preview_request.is_some()
        && response.status() == StatusCode::OK
        && response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.starts_with("text/html"))
    {
        let (mut parts, body) = response.into_parts();
        let bytes = match to_bytes(body, 16 * 1024 * 1024).await {
            Ok(bytes) => bytes,
            Err(_) => return failure(StatusCode::PAYLOAD_TOO_LARGE, "预览页面过大"),
        };
        let html = String::from_utf8_lossy(&bytes);
        let player = format!(
            "<script>{}</script>",
            include_str!("../web/preview-player.js")
        );
        let html = if let Some(index) = html.rfind("</body>") {
            format!("{}{}{}", &html[..index], player, &html[index..])
        } else {
            format!("{html}{player}")
        };
        parts.headers.remove(CONTENT_LENGTH);
        parts.headers.remove(ETAG);
        response = Response::from_parts(parts, Body::from(html));
    }

    if response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"))
    {
        let (parts, body) = response.into_parts();
        match to_bytes(body, 32 * 1024 * 1024).await {
            Ok(bytes) => {
                if let Ok(mut value) = serde_json::from_slice::<Value>(&bytes) {
                    scope_urls(&mut value, &user.id);
                    if let Some(link) = &preview_link
                        && value.get("storyboardUrl").is_some()
                    {
                        value["storyboardUrl"] = json!(link);
                        value["previewUrl"] = json!(link);
                    }
                    response = Response::from_parts(
                        parts,
                        Body::from(serde_json::to_vec(&value).unwrap()),
                    );
                    response.headers_mut().remove(CONTENT_LENGTH);
                } else {
                    response = Response::from_parts(parts, Body::from(bytes));
                }
            }
            Err(_) => return failure(StatusCode::INTERNAL_SERVER_ERROR, "响应过大"),
        }
    }
    response
        .headers_mut()
        .insert("cache-control", "private, no-store".parse().unwrap());
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert("referrer-policy", "no-referrer".parse().unwrap());
    if response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/html") || v.contains("image/svg+xml"))
    {
        response.headers_mut().insert(
            "content-security-policy",
            "sandbox allow-scripts; frame-ancestors 'self'; form-action 'none'; base-uri 'none'"
                .parse()
                .unwrap(),
        );
    }
    response
}
fn scope_urls(value: &mut Value, user: &str) {
    match value {
        Value::String(s) => {
            for (from, to) in [
                ("/assets/", format!("/assets/u/{user}/")),
                (
                    "/api/agent-projects/",
                    format!("/api/u/{user}/agent-projects/"),
                ),
            ] {
                if s.starts_with(from) && !s.starts_with("/assets/u/") {
                    *s = format!("{to}{}", &s[from.len()..]);
                    break;
                }
            }
        }
        Value::Array(v) => {
            for x in v {
                scope_urls(x, user)
            }
        }
        Value::Object(v) => {
            for x in v.values_mut() {
                scope_urls(x, user)
            }
        }
        _ => {}
    }
}
fn normalize_input(value: &mut Value, user: &str) {
    match value {
        Value::String(s) => {
            if let Some(rest) = s.strip_prefix(&format!("/assets/u/{user}/")) {
                *s = format!("/assets/{rest}");
            }
        }
        Value::Array(v) => {
            for x in v {
                normalize_input(x, user)
            }
        }
        Value::Object(v) => {
            for x in v.values_mut() {
                normalize_input(x, user)
            }
        }
        _ => {}
    }
}
async fn reject_escaping_links(root: &FilePath) -> Result<(), String> {
    // User-created links must never make a host-side API follow paths outside the user's storage.
    let mut pending = vec![root.join("projects"), root.join("assets")];
    while let Some(dir) = pending.pop() {
        if fs::symlink_metadata(&dir)
            .await
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            return Err("用户数据目录不能是符号链接".into());
        }
        let Ok(mut entries) = fs::read_dir(&dir).await else {
            continue;
        };
        while let Some(e) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let kind = e.file_type().await.map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                let canonical = fs::canonicalize(e.path())
                    .await
                    .map_err(|_| "沙箱中有不可访问的链接")?;
                if !canonical.starts_with(root) {
                    return Err("沙箱文件链接不能指向用户目录之外".into());
                }
            } else if kind.is_dir() {
                pending.push(e.path());
            }
        }
    }
    Ok(())
}
pub(super) async fn asset_file(
    State(state): State<AppState>,
    Path(path): Path<String>,
    request: Request,
) -> Response {
    let root = state.assets.root.as_ref();
    let resolved = match fs::canonicalize(root.join(&path)).await {
        Ok(p) if p.starts_with(root) => p,
        _ => return failure(StatusCode::NOT_FOUND, "素材不存在"),
    };
    ServeFile::new(resolved)
        .oneshot(request)
        .await
        .unwrap()
        .into_response()
}
pub(super) async fn voice_proxy(
    State(state): State<AppState>,
    Path(path): Path<String>,
    request: Request,
) -> Response {
    if path == "v1/audio/voices" && request.method() == "GET" {
        return match state.voices.list_visible().await {
            Ok(v) => Json(v).into_response(),
            Err(e) => failure(StatusCode::BAD_GATEWAY, &e.to_string()),
        };
    }
    if path == "v1/audio/speech" && request.method() == "POST" {
        let bytes = match to_bytes(request.into_body(), 1024 * 1024).await {
            Ok(b) => b,
            Err(_) => return failure(StatusCode::BAD_REQUEST, "请求过大"),
        };
        let v: Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(_) => return failure(StatusCode::BAD_REQUEST, "无效语音请求"),
        };
        let voice = v["voice"].as_str().unwrap_or("default");
        let text = v["input"].as_str().unwrap_or("");
        return match state.voices.synthesize(voice, text).await {
            Ok(audio) => ([(CONTENT_TYPE, "audio/wav")], audio).into_response(),
            Err(e) => failure(StatusCode::BAD_REQUEST, &e.to_string()),
        };
    }
    failure(StatusCode::NOT_FOUND, "语音接口不可用")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn links_cannot_expose_another_users_data() {
        let root = env::temp_dir().join(format!("yingya-links-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("projects")).await.unwrap();
        std::os::unix::fs::symlink("/etc", root.join("projects/escape")).unwrap();
        assert!(reject_escaping_links(&root).await.is_err());
        fs::remove_dir_all(root).await.unwrap();
    }
    #[test]
    fn scoped_references_are_not_reinterpreted_for_another_user() {
        let mut value = json!({"url":"/assets/uploads/a.png","nested":["/api/agent-projects/p/files/index.html"]});
        scope_urls(&mut value, "a");
        assert_eq!(value["url"], "/assets/u/a/uploads/a.png");
        normalize_input(&mut value, "b");
        assert_eq!(value["url"], "/assets/u/a/uploads/a.png");
        normalize_input(&mut value, "a");
        assert_eq!(value["url"], "/assets/uploads/a.png");
        let mut headers = HeaderMap::new();
        headers.insert("host", "localhost:8798".parse().unwrap());
        headers.insert("origin", "https://evil.example".parse().unwrap());
        assert!(!same_origin(&headers));
    }
}
