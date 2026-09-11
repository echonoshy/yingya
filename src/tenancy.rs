use super::*;
use axum::{
    body::{Body, to_bytes},
    extract::Request,
    http::{
        Uri,
        header::{CONTENT_LENGTH, SET_COOKIE},
    },
};
use std::collections::HashMap;
use tokio::sync::OnceCell;
use tower::ServiceExt;

type TenantRouters = Arc<Mutex<HashMap<String, Arc<OnceCell<Router>>>>>;
type ServiceTokens = Arc<std::sync::Mutex<HashMap<String, User>>>;

// Revoke tokens even if initialization is cancelled by a disconnected request.
struct PendingServiceToken {
    tokens: ServiceTokens,
    token: String,
    committed: bool,
}
impl Drop for PendingServiceToken {
    fn drop(&mut self) {
        if !self.committed {
            self.tokens.lock().unwrap().remove(&self.token);
        }
    }
}

async fn tenant_slot(tenants: &TenantRouters, id: &str) -> Arc<OnceCell<Router>> {
    tenants
        .lock()
        .await
        .entry(id.to_owned())
        .or_default()
        .clone()
}

#[derive(Clone, Serialize, Deserialize)]
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
    model_relay: crate::model_relay::ModelRelay,
    tenants: TenantRouters,
    service_tokens: ServiceTokens,
    registry: Option<crate::runtime::Registry>,
    pool: Option<crate::runtime::Pool>,
    worker: Option<crate::runtime::Worker>,
    control: crate::runtime::Control,
    service_base: String,
}
#[derive(Deserialize)]
struct Login {
    email: String,
    password: String,
    invite_code: Option<String>,
    reset_code: Option<String>,
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
    crate::config::load_env();
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
    let mode = env::var("YINGYA_MODE").unwrap_or_else(|_| "gateway".into());
    if !matches!(mode.as_str(), "gateway" | "worker" | "standalone") {
        return Err("invalid YINGYA_MODE".into());
    }
    let registry = crate::runtime::Registry::open(&paths.app_data)?;
    let _topology = if mode == "standalone" {
        crate::runtime::Ownership::acquire(&registry.root.join("topology.lock"))?
    } else {
        crate::runtime::Ownership::shared(&registry.root.join("topology.lock"))?
    };
    let worker_user = if mode == "worker" {
        Some(env::var("YINGYA_WORKER_USER")?)
    } else {
        None
    };
    let _owner = worker_user
        .as_ref()
        .map(|id| {
            registry
                .owner_path(id)
                .and_then(|p| crate::runtime::Ownership::acquire(&p))
        })
        .transpose()?;
    if let Some(id) = &worker_user {
        accounts.recover_user_accounting(id)?;
    } else if mode == "standalone" {
        accounts.recover_accounting()?;
    }
    let address: SocketAddr = env::var("YINGYA_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8797".into())
        .parse()?;
    if mode == "worker" && !address.ip().is_loopback() {
        return Err("worker must bind to loopback".into());
    }
    let listener = TcpListener::bind(address).await?;
    let address = listener.local_addr()?;
    let release = crate::runtime::Release::current(&paths.resources)?;
    let worker = worker_user.map(|user| crate::runtime::Worker {
        user,
        instance: env::var("YINGYA_WORKER_INSTANCE").unwrap_or_else(|_| Uuid::new_v4().to_string()),
        session: env::var("YINGYA_WORKER_SESSION").unwrap_or_default(),
        endpoint: format!("http://{address}"),
        release: release.id.clone(),
        token: crate::accounts::secret(),
        heartbeat: crate::accounts::now(),
    });
    let pool = if mode == "gateway" {
        registry.initialize_target(&release)?;
        Some(crate::runtime::Pool::new(
            paths.app_data.clone(),
            registry.clone(),
        )?)
    } else {
        None
    };
    let model_relay = crate::model_relay::ModelRelay::new(&paths.codex_home)?;
    // Remove legacy credential copies before accepting requests, including dormant tenants.
    let mut users = fs::read_dir(paths.app_data.join("users")).await?;
    while let Some(entry) = users.next_entry().await? {
        if mode != "standalone" {
            break;
        }
        if entry.file_type().await?.is_dir() {
            let home = entry.path().join("runtime/codex-home");
            if home.is_dir() {
                model_relay
                    .prepare_user_auth(&home)
                    .await
                    .map_err(std::io::Error::other)?;
            }
        }
    }
    let mut state = Gateway {
        previews: Default::default(),
        paths,
        accounts,
        model_relay,
        tenants: Default::default(),
        service_tokens: Default::default(),
        registry: None,
        pool: None,
        worker: None,
        control: Default::default(),
        service_base: "http://127.0.0.1:8797".into(),
    };
    state.registry = Some(registry.clone());
    state.pool = pool;
    state.worker = worker.clone();
    state.service_base = format!("http://{address}");
    if let Some(worker) = &worker {
        let user = state.accounts.runtime_user(&worker.user)?;
        let _ = state.router(&user).await?;
        registry.register(worker)?;
        info!(tmux=%worker.session, port=address.port(), release=%worker.release, "user worker ready");
    }
    if let Some(pool) = &state.pool {
        pool.supervise();
    }
    let lifecycle = state.clone();
    let app = Router::new()
        .route("/ready", get(readiness))
        .route("/internal/runtime", get(runtime_status))
        .route("/internal/drain", post(drain_runtime))
        .route(
            "/health",
            get(|| async {
                Json(json!({"status":"ok","backend":"rust","loginMode":"invite-password","release":env::var("YINGYA_RELEASE_ID").unwrap_or_else(|_|"development".into())}))
            }),
        )
        .route(
            "/api/auth/login",
            post(login).layer(DefaultBodyLimit::max(4096)),
        )
        .route(
            "/api/auth/register",
            post(register).layer(DefaultBodyLimit::max(4096)),
        )
        .route(
            "/api/auth/reset",
            post(reset_password).layer(DefaultBodyLimit::max(4096)),
        )
        .route("/api/auth/logout", post(logout))
        .route("/api/auth/me", get(me))
        .route("/api/usage", get(usage))
        .route("/api/admin/usage", get(admin_usage))
        .route("/api/billing", get(billing))
        .route("/api/admin/billing", get(admin_billing))
        .route("/api/billing/invoices", post(create_invoice))
        .route("/api/admin/billing/invoices", post(create_admin_invoice))
        .route("/api/billing/invoices/{id}", get(get_invoice))
        .route("/api/admin/billing/invoices/{id}", get(get_admin_invoice))
        .route(
            "/api/admin/login",
            post(admin_login).layer(DefaultBodyLimit::max(4096)),
        )
        .route("/api/admin/me", get(admin_me))
        .route("/api/admin/audit", get(admin_audit))
        .route(
            "/api/admin/password",
            post(change_admin_password).layer(DefaultBodyLimit::max(4096)),
        )
        .route("/api/quota", get(account_quota))
        .route(
            "/api/admin/accounts",
            get(admin_accounts).post(create_managed_user),
        )
        .route(
            "/api/admin/accounts/{id}/profile",
            axum::routing::patch(edit_profile),
        )
        .route(
            "/api/admin/accounts/{id}/sessions",
            axum::routing::delete(revoke_user_sessions),
        )
        .route("/api/admin/password-reset", post(create_password_reset))
        .route(
            "/api/admin/accounts/{id}",
            axum::routing::patch(update_account),
        )
        .route("/api/admin/invites", get(list_invites).post(create_invite))
        .route(
            "/api/admin/invites/{id}",
            axum::routing::delete(revoke_invite).patch(edit_invite),
        )
        .fallback(dispatch)
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            runtime_admission,
        ))
        .with_state(state);
    info!(%address,%mode,"Yingya backend is listening");
    let shutdown = async move {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("SIGTERM");
        let mut hup =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::hangup()).expect("SIGHUP");
        let mut last_heartbeat = tokio::time::Instant::now();
        loop {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => lifecycle.control.drain(),
                _ = term.recv() => lifecycle.control.drain(),
                _ = hup.recv() => lifecycle.control.drain(),
                _ = tokio::time::sleep(Duration::from_millis(250)) => {}
            }
            if let Some(worker) = &lifecycle.worker
                && last_heartbeat.elapsed() >= Duration::from_secs(5)
            {
                last_heartbeat = tokio::time::Instant::now();
                if let Err(error) = registry.heartbeat(worker) {
                    warn!(%error,"worker heartbeat failed");
                }
            }
            if lifecycle.control.finish_if_idle() {
                break;
            }
        }
    };
    // SSE connections can remain open indefinitely. Once all finite work has
    // drained, close these connections; clients replay their saved event cursor.
    tokio::select! {
        result = axum::serve(listener, app) => { result?; }
        _ = shutdown => {}
    }
    if worker.is_some() {
        std::process::exit(0);
    }
    Ok(())
}
async fn readiness(State(g): State<Gateway>) -> Response {
    if [
        "web-dist/index.html",
        "node_modules/.bin/codex",
        "node_modules/.bin/hyperframes",
        "scripts/sandbox-gateway.mjs",
        "scripts/sandbox-bridge.mjs",
        "skills/yingya-video-agent/SKILL.md",
    ]
    .iter()
    .any(|path| !g.paths.resources.join(path).is_file())
    {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    if let Some(registry) = &g.registry
        && registry.users().is_err()
    {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    if g.model_relay.ready().await.is_err() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    StatusCode::OK.into_response()
}
async fn runtime_status(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    let Some(worker) = &g.worker else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("x-yingya-worker").and_then(|v| v.to_str().ok()) != Some(&worker.token) {
        return StatusCode::NOT_FOUND.into_response();
    }
    Json(json!({"instance":worker.instance,"release":worker.release,"draining":g.control.draining(),"active":g.control.active()})).into_response()
}
async fn drain_runtime(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    let Some(worker) = &g.worker else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if headers.get("x-yingya-worker").and_then(|v| v.to_str().ok()) != Some(&worker.token) {
        return StatusCode::NOT_FOUND.into_response();
    }
    g.control.drain();
    StatusCode::ACCEPTED.into_response()
}
async fn runtime_admission(
    State(g): State<Gateway>,
    request: Request,
    next: axum::middleware::Next,
) -> Response {
    if request.uri().path().starts_with("/internal/") {
        return next.run(request).await;
    }
    if let Some(worker) = &g.worker {
        let proxy = request
            .headers()
            .get("x-yingya-worker")
            .and_then(|v| v.to_str().ok())
            == Some(&worker.token);
        let internal = request
            .headers()
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .is_some_and(|token| g.service_tokens.lock().unwrap().contains_key(token));
        if !proxy && !internal {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    let Some(guard) = g.control.enter() else {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            [("x-yingya-not-accepted", "1"), ("retry-after", "1")],
        )
            .into_response();
    };
    let response = next.run(request).await;
    if response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("text/event-stream"))
    {
        // Model relay streams are finite and belong to active Agent jobs; public
        // SSE subscriptions must not prevent worker retirement.
        drop(guard);
        return response;
    }
    let (parts, body) = response.into_parts();
    let stream = body.into_data_stream().map(move |chunk| {
        let _keep_alive = &guard;
        chunk
    });
    Response::from_parts(parts, Body::from_stream(stream))
}
async fn login(State(g): State<Gateway>, headers: HeaderMap, Json(input): Json<Login>) -> Response {
    authenticate(g, headers, input, "login").await
}
#[derive(Deserialize)]
struct AdminLogin {
    email: String,
    password: String,
}
async fn admin_login(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<AdminLogin>,
) -> Response {
    authenticate(
        g,
        headers,
        Login {
            email: input.email,
            password: input.password,
            invite_code: None,
            reset_code: None,
        },
        "admin",
    )
    .await
}
async fn register(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Response {
    authenticate(g, headers, input, "register").await
}
async fn reset_password(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<Login>,
) -> Response {
    authenticate(g, headers, input, "reset").await
}
async fn authenticate(
    g: Gateway,
    headers: HeaderMap,
    input: Login,
    mode: &'static str,
) -> Response {
    let register = mode == "register";
    if !same_origin(&headers) {
        return failure(StatusCode::FORBIDDEN, "不允许跨站登录");
    }
    static AUTH_WORKERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let Ok(permit) = AUTH_WORKERS.try_acquire() else {
        return failure(StatusCode::TOO_MANY_REQUESTS, "登录服务繁忙，请稍后重试");
    };
    if register
        && input
            .invite_code
            .as_deref()
            .is_none_or(|code| code.trim().is_empty())
    {
        return failure(StatusCode::BAD_REQUEST, "请输入邀请码");
    }
    let accounts = g.accounts.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if mode == "admin" {
            return accounts.admin_login(&input.email, &input.password);
        }
        if mode == "reset" {
            accounts.reset_password(
                &input.email,
                &input.password,
                input.reset_code.as_deref().ok_or("缺少重置凭据")?,
            )?;
        }
        accounts.authenticate(
            &input.email,
            &input.password,
            if register {
                input.invite_code.as_deref()
            } else {
                None
            },
        )
    })
    .await;
    let result = match result {
        Ok(value) => value,
        Err(_) => {
            return failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                "暂时无法登录，请稍后重试",
            );
        }
    };
    match result {
        Ok((user, token)) => {
            if let Some(old) = cookie(&headers) {
                let _ = g.accounts.logout(old);
            }
            let mut response =
                Json(json!({"user":user,"loginMode":"invite-password"})).into_response();
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
    let mut r = Json(json!({"user":user,"loginMode":"invite-password"})).into_response();
    r.headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    r
}
fn admin(g: &Gateway, headers: &HeaderMap) -> Result<User, Box<Response>> {
    let user =
        user(g, headers).ok_or_else(|| Box::new(failure(StatusCode::UNAUTHORIZED, "请先登录")))?;
    if !user.is_admin || !same_origin(headers) {
        return Err(Box::new(failure(
            StatusCode::FORBIDDEN,
            "仅管理员可以执行此操作",
        )));
    }
    Ok(user)
}
fn account_result(result: Result<Value, String>) -> Response {
    match result {
        Ok(value) => {
            let mut r = Json(value).into_response();
            r.headers_mut()
                .insert("cache-control", "no-store".parse().unwrap());
            r
        }
        Err(error) => failure(StatusCode::BAD_REQUEST, &error),
    }
}
async fn account_quota(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    let Some(user) = user(&g, &headers) else {
        return failure(StatusCode::UNAUTHORIZED, "请先登录");
    };
    account_result(g.accounts.quota(&user.id).map(|q| json!(q)))
}
async fn admin_accounts(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    if let Err(r) = admin(&g, &headers) {
        return *r;
    }
    account_result(g.accounts.managed_users())
}
async fn admin_me(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    account_result(Ok(json!({"user":actor})))
}
async fn admin_audit(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    if let Err(r) = admin(&g, &headers) {
        return *r;
    }
    account_result(g.accounts.audit_log())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PasswordChange {
    current_password: String,
    new_password: String,
}
async fn change_admin_password(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<PasswordChange>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    static PASSWORD_WORKERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let Ok(permit) = PASSWORD_WORKERS.try_acquire() else {
        return failure(StatusCode::TOO_MANY_REQUESTS, "请稍后重试");
    };
    account_result(
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            g.accounts
                .change_own_password(&actor.id, &input.current_password, &input.new_password)
                .map(|_| json!({"ok":true}))
        })
        .await
        .unwrap_or_else(|_| Err("修改密码失败".into())),
    )
}
async fn create_managed_user(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<crate::accounts::ManagedUserInput>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    static CREATE_WORKERS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let Ok(permit) = CREATE_WORKERS.try_acquire() else {
        return failure(StatusCode::TOO_MANY_REQUESTS, "请稍后再创建用户");
    };
    account_result(
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            g.accounts.create_managed_user(&actor.id, input)
        })
        .await
        .unwrap_or_else(|_| Err("创建用户失败".into())),
    )
}
async fn edit_profile(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<crate::accounts::ProfileUpdate>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    account_result(
        g.accounts
            .edit_profile(&actor.id, &id, input)
            .map(|_| json!({"ok":true})),
    )
}
async fn edit_invite(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<crate::accounts::InviteUpdate>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    account_result(
        g.accounts
            .edit_invite(&actor.id, &id, input)
            .map(|_| json!({"ok":true})),
    )
}
async fn revoke_user_sessions(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    account_result(
        g.accounts
            .revoke_user_sessions(&actor.id, &id)
            .map(|_| json!({"ok":true})),
    )
}
#[derive(Deserialize)]
struct ResetTarget {
    email: String,
}
async fn create_password_reset(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<ResetTarget>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    account_result(g.accounts.password_reset(&input.email).and_then(|value| {
        g.accounts
            .record_admin_action(&actor.id, "生成密码重置链接", &input.email, json!({}))?;
        Ok(value)
    }))
}
async fn list_invites(State(g): State<Gateway>, headers: HeaderMap) -> Response {
    if let Err(r) = admin(&g, &headers) {
        return *r;
    }
    account_result(g.accounts.managed_invites())
}
async fn create_invite(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<crate::accounts::InviteInput>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    account_result(g.accounts.invite(input, false).and_then(|value| {
        g.accounts.record_admin_action(
            &actor.id,
            "创建邀请",
            value["id"].as_str().unwrap_or_default(),
            json!({}),
        )?;
        Ok(value)
    }))
}
async fn revoke_invite(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    account_result(g.accounts.revoke_invite(&id).and_then(|_| {
        g.accounts
            .record_admin_action(&actor.id, "撤销邀请", &id, json!({}))?;
        Ok(json!({"ok":true}))
    }))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountUpdate {
    tokens: i64,
    media: i64,
    disabled: Option<bool>,
    request_id: String,
}
async fn update_account(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<AccountUpdate>,
) -> Response {
    let actor = match admin(&g, &headers) {
        Ok(actor) => actor,
        Err(r) => return *r,
    };
    account_result(
        g.accounts
            .update_account(
                &actor.id,
                &id,
                input.tokens,
                input.media,
                input.disabled,
                &input.request_id,
            )
            .map(|_| json!({"ok":true})),
    )
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BillingQuery {
    month: String,
    user_id: Option<String>,
}
fn billing_owner(
    g: &Gateway,
    headers: &HeaderMap,
    input: &BillingQuery,
    administrative: bool,
) -> Result<(User, Option<String>), Box<Response>> {
    let identity =
        user(g, headers).ok_or_else(|| Box::new(failure(StatusCode::UNAUTHORIZED, "请先登录")))?;
    if !same_origin(headers) {
        return Err(Box::new(failure(StatusCode::FORBIDDEN, "请求来源无效")));
    }
    if administrative {
        if !identity.is_admin {
            return Err(Box::new(failure(
                StatusCode::FORBIDDEN,
                "仅管理员可以查看所有人的账单",
            )));
        }
        Ok((identity, input.user_id.clone().filter(|s| !s.is_empty())))
    } else {
        if input.user_id.as_deref().is_some_and(|id| id != identity.id) {
            return Err(Box::new(failure(
                StatusCode::FORBIDDEN,
                "只能查看自己的账单",
            )));
        }
        let owner = identity.id.clone();
        Ok((identity, Some(owner)))
    }
}
async fn billing(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Query(input): Query<BillingQuery>,
) -> Response {
    billing_report(g, headers, input, false, false)
}
async fn admin_billing(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Query(input): Query<BillingQuery>,
) -> Response {
    billing_report(g, headers, input, true, false)
}
async fn create_invoice(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<BillingQuery>,
) -> Response {
    billing_report(g, headers, input, false, true)
}
async fn create_admin_invoice(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<BillingQuery>,
) -> Response {
    billing_report(g, headers, input, true, true)
}
fn billing_report(
    g: Gateway,
    headers: HeaderMap,
    input: BillingQuery,
    administrative: bool,
    create: bool,
) -> Response {
    let (actor, owner) = match billing_owner(&g, &headers, &input, administrative) {
        Ok(value) => value,
        Err(response) => return *response,
    };
    let value = if create {
        g.accounts
            .create_invoice(&actor.id, owner.as_deref(), &input.month)
            .map(|invoice| json!({"invoice":invoice}))
    } else {
        g.accounts.billing_report(owner.as_deref(), &input.month)
    };
    account_result(value)
}
async fn get_invoice(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    invoice_response(g, headers, id, false)
}
async fn get_admin_invoice(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    invoice_response(g, headers, id, true)
}
fn invoice_response(g: Gateway, headers: HeaderMap, id: String, administrative: bool) -> Response {
    let identity = if administrative {
        match admin(&g, &headers) {
            Ok(user) => user,
            Err(response) => return *response,
        }
    } else {
        match user(&g, &headers) {
            Some(user) => user,
            None => return failure(StatusCode::UNAUTHORIZED, "请先登录"),
        }
    };
    match g.accounts.invoice(&identity.id, administrative, &id) {
        Ok(Some(invoice)) => account_result(Ok(json!({"invoice":invoice}))),
        Ok(None) => failure(StatusCode::NOT_FOUND, "账单不存在"),
        Err(message) => failure(StatusCode::INTERNAL_SERVER_ERROR, &message),
    }
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
        let slot = tenant_slot(&self.tenants, &user.id).await;
        slot.get_or_try_init(|| self.initialize_router(user))
            .await
            .cloned()
    }

    async fn initialize_router(&self, user: &User) -> Result<Router, String> {
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
        let home = root.join("runtime/codex-home");
        self.model_relay.prepare_user_auth(&home).await?;
        copy_tree(&self.paths.codex_home.join("skills"), &home.join("skills"))
            .await
            .map_err(|e| e.to_string())?;
        let token = crate::accounts::secret();
        self.service_tokens
            .lock()
            .unwrap()
            .insert(token.clone(), user.clone());
        let mut registration = PendingServiceToken {
            tokens: self.service_tokens.clone(),
            token: token.clone(),
            committed: false,
        };
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
        let router = user_router(
            paths,
            self.accounts.clone(),
            user.clone(),
            &token,
            &self.service_base,
            self.control.clone(),
        )
        .await
        .map_err(|e| e.to_string())?;
        registration.committed = true;
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

    if let Some(pool) = &g.pool {
        let owner = if let Some(rest) = request.uri().path().strip_prefix("/api/preview/") {
            let token = rest.split('/').next().unwrap_or("");
            match pool.registry.preview(token) {
                Ok(Some((owner, _))) => Some(owner),
                _ => None,
            }
        } else {
            user(&g, request.headers()).map(|u| u.id)
        };
        let Some(owner) = owner else {
            return failure(StatusCode::UNAUTHORIZED, "请先登录");
        };
        return pool.forward(&owner, request).await;
    }

    let preview_request = if let Some(rest) = request.uri().path().strip_prefix("/api/preview/") {
        if request.method() != "GET" && request.method() != "HEAD" {
            return failure(StatusCode::METHOD_NOT_ALLOWED, "预览只支持读取文件");
        }
        let Some((token, tail)) = rest.split_once('/') else {
            return failure(StatusCode::NOT_FOUND, "预览不存在");
        };
        let grant = if let Some(registry) = &g.registry {
            registry
                .preview(token)
                .ok()
                .flatten()
                .and_then(|(_, payload)| serde_json::from_str::<PreviewGrant>(&payload).ok())
        } else {
            g.previews.lock().await.get(token).cloned()
        };
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
        g.service_tokens.lock().unwrap().get(token).cloned()
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
    if g.worker.as_ref().is_some_and(|w| w.user != user.id) {
        return failure(StatusCode::NOT_FOUND, "用户运行环境不匹配");
    }
    if g.accounts.quota(&user.id).map_or(true, |q| q.disabled) {
        return failure(StatusCode::FORBIDDEN, "账号已停用，请联系管理员");
    }
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
    if path.starts_with("/api/internal/model/") {
        return g
            .model_relay
            .forward(request, g.accounts.clone(), &user.id)
            .await;
    }
    if path.starts_with("/api/auth/")
        || path.starts_with("/api/admin/")
        || path == "/api/usage"
        || path == "/api/quota"
    {
        return failure(StatusCode::NOT_FOUND, "接口不存在");
    }
    if request.method() == "POST" {
        let model_action = path == "/api/agent-projects"
            || path == "/api/codex/threads"
            || path.ends_with("/turns")
            || path.ends_with("/images")
            || path.ends_with("/title")
            || path.ends_with("/resume")
            || path.ends_with("/execute")
            || path.ends_with("/checkpoint");
        if model_action && let Err(error) = g.accounts.check_quota(&user.id) {
            return failure(StatusCode::PAYMENT_REQUIRED, &error);
        }
        if matches!(
            path.as_str(),
            "/api/voices" | "/api/voices/design" | "/api/voices/preview"
        ) && let Err(error) = g.accounts.consume_media(&user.id)
        {
            return failure(StatusCode::PAYMENT_REQUIRED, &error);
        }
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
    if let Some(rest) = path.strip_prefix("/api/agent-projects/") {
        let id = rest.split('/').next().unwrap_or("");
        if let Err(e) = agent_projects::reject_symlink_components(
            &root.join("projects").join(id).join("project.json"),
        ) {
            return failure(StatusCode::FORBIDDEN, &e);
        }
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
            if let Some(registry) = &g.registry {
                let grant = grants.get(&token).unwrap();
                if let Err(error) = registry.save_preview(
                    &token,
                    &user.id,
                    &serde_json::to_string(grant).unwrap(),
                    grant.expires,
                ) {
                    warn!(%error,"preview grant persistence failed");
                    return failure(StatusCode::SERVICE_UNAVAILABLE, "预览暂不可用");
                }
            }
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
pub(super) async fn asset_file(
    State(state): State<AppState>,
    Path(path): Path<String>,
    request: Request,
) -> Response {
    let root = state.assets.root.as_ref();
    if agent_projects::reject_symlink_components(&root.join(&path)).is_err() {
        return failure(StatusCode::NOT_FOUND, "素材不存在");
    }
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
        if let Err(error) = state.accounts.consume_media(&state.user.id) {
            return failure(StatusCode::PAYMENT_REQUIRED, &error);
        }
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
    async fn account_permissions_and_empty_quota_are_enforced_before_tenant_work() {
        let root = env::temp_dir().join(format!("yingya-account-gateway-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let accounts = Accounts::open(&root.join("db.sqlite"), vec![]).unwrap();
        let invitation = accounts
            .invite(
                crate::accounts::InviteInput {
                    email: None,
                    expires_in_days: 1,
                    max_uses: 1,
                    token_limit: 0,
                    media_limit: 0,
                },
                false,
            )
            .unwrap();
        let (member, session) = accounts
            .authenticate(
                "member@example.test",
                "a-test-password",
                invitation["code"].as_str(),
            )
            .unwrap();
        let mut paths = AppPaths::from_env().unwrap();
        paths.app_data = root.clone();
        let g = Gateway {
            paths,
            accounts,
            model_relay: crate::model_relay::ModelRelay::new(&root).unwrap(),
            previews: Default::default(),
            tenants: Default::default(),
            service_tokens: Default::default(),
            registry: None,
            pool: None,
            worker: None,
            control: Default::default(),
            service_base: "http://127.0.0.1:8797".into(),
        };
        let mut headers = HeaderMap::new();
        headers.insert(
            "cookie",
            format!("yingya_session={session}").parse().unwrap(),
        );
        assert_eq!(
            admin_accounts(State(g.clone()), headers.clone())
                .await
                .status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            account_quota(State(g.clone()), headers.clone())
                .await
                .status(),
            StatusCode::OK
        );
        tenant_slot(&g.tenants, &member.id)
            .await
            .set(Router::new().fallback(|| async { StatusCode::OK }))
            .unwrap();
        for (method, path, status) in [
            ("GET", "/api/codex/models", StatusCode::OK),
            (
                "POST",
                "/api/codex/threads/test/turns",
                StatusCode::PAYMENT_REQUIRED,
            ),
            ("POST", "/api/voices/preview", StatusCode::PAYMENT_REQUIRED),
        ] {
            let mut request = Request::builder()
                .method(method)
                .uri(path)
                .body(Body::empty())
                .unwrap();
            *request.headers_mut() = headers.clone();
            assert_eq!(dispatch(State(g.clone()), request).await.status(), status);
        }
        g.service_tokens
            .lock()
            .unwrap()
            .insert("worker".into(), member.clone());
        g.accounts
            .update_account(
                "admin",
                &member.id,
                0,
                0,
                Some(true),
                &Uuid::new_v4().to_string(),
            )
            .unwrap();
        let request = Request::builder()
            .uri("/api/internal/model/backend-api/codex/models")
            .header("authorization", "Bearer worker")
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            dispatch(State(g.clone()), request).await.status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            account_quota(State(g), headers).await.status(),
            StatusCode::UNAUTHORIZED
        );
        let _ = fs::remove_dir_all(root).await;
    }
    #[tokio::test]
    async fn broken_generated_link_does_not_block_another_project_or_deletion() {
        let root = env::temp_dir().join(format!("yingya-gateway-path-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let accounts = Accounts::open(&root.join("db.sqlite"), vec![]).unwrap();
        let (user, session) = accounts.login("path-test@example.test").unwrap();
        let own = root.join("users").join(&user.id);
        let first = Uuid::new_v4().to_string();
        let second = Uuid::new_v4().to_string();
        for id in [&first, &second] {
            fs::create_dir_all(own.join("projects").join(id))
                .await
                .unwrap();
            fs::write(own.join("projects").join(id).join("project.json"), b"{}")
                .await
                .unwrap();
        }
        std::os::unix::fs::symlink(
            "missing-dependency",
            own.join("projects").join(&first).join("broken"),
        )
        .unwrap();
        let paths = AppPaths {
            app_data: root.clone(),
            resources: root.clone(),
            cache: root.clone(),
            runtime: root.clone(),
            projects: own.join("projects"),
            assets: own.join("assets"),
            codex_home: root.clone(),
            hyperframes_home: root.clone(),
        };
        let g = Gateway {
            paths,
            accounts,
            model_relay: crate::model_relay::ModelRelay::new(&root).unwrap(),
            previews: Default::default(),
            tenants: Default::default(),
            service_tokens: Default::default(),
            registry: None,
            pool: None,
            worker: None,
            control: Default::default(),
            service_base: "http://127.0.0.1:8797".into(),
        };
        tenant_slot(&g.tenants, &user.id)
            .await
            .set(Router::new().fallback(|| async { StatusCode::OK }))
            .unwrap();
        for (method, id) in [("GET", &second), ("DELETE", &first)] {
            let request = Request::builder()
                .method(method)
                .uri(format!("/api/agent-projects/{id}"))
                .header("cookie", format!("yingya_session={session}"))
                .body(Body::empty())
                .unwrap();
            assert_eq!(
                dispatch(State(g.clone()), request).await.status(),
                StatusCode::OK
            );
        }
        fs::remove_file(own.join("projects").join(&first).join("project.json"))
            .await
            .unwrap();
        std::os::unix::fs::symlink(
            own.join("projects").join(&second).join("project.json"),
            own.join("projects").join(&first).join("project.json"),
        )
        .unwrap();
        let request = Request::builder()
            .uri(format!("/api/agent-projects/{first}"))
            .header("cookie", format!("yingya_session={session}"))
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            dispatch(State(g), request).await.status(),
            StatusCode::FORBIDDEN
        );
        fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn tenant_initialization_waits_only_for_the_same_user_and_retries_failures() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let tenants = TenantRouters::default();
        let a = tenant_slot(&tenants, "a").await;
        let b = tenant_slot(&tenants, "b").await;
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let init = tokio::spawn(async move {
            a.get_or_try_init(|| async {
                started_tx.send(()).unwrap();
                release_rx.await.unwrap();
                Ok::<_, String>(Router::new())
            })
            .await
            .unwrap()
            .clone()
        });
        started_rx.await.unwrap();
        let same = tenant_slot(&tenants, "a").await;
        assert!(same.get().is_none());
        tokio::time::timeout(
            Duration::from_secs(1),
            b.get_or_try_init(|| async { Ok::<_, String>(Router::new()) }),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(tenant_slot(&tenants, "b").await.get().is_some());
        release_tx.send(()).unwrap();
        let _ = init.await.unwrap();
        let calls = AtomicUsize::new(0);
        same.get_or_init(|| async {
            calls.fetch_add(1, Ordering::SeqCst);
            Router::new()
        })
        .await;
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        let failed = tenant_slot(&tenants, "failed").await;
        assert!(
            failed
                .get_or_try_init(|| async { Err::<Router, _>("failure") })
                .await
                .is_err()
        );
        assert!(
            failed
                .get_or_try_init(|| async { Ok::<_, String>(Router::new()) })
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn cancelling_initialization_revokes_its_service_token() {
        let tokens = ServiceTokens::default();
        tokens.lock().unwrap().insert(
            "test-token".into(),
            User {
                id: "u".into(),
                email: "u@example.test".into(),
                is_admin: false,
            },
        );
        let registration = PendingServiceToken {
            tokens: tokens.clone(),
            token: "test-token".into(),
            committed: false,
        };
        let task = tokio::spawn(async move {
            let _registration = registration;
            std::future::pending::<()>().await;
        });
        task.abort();
        let _ = task.await;
        assert!(tokens.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn links_cannot_expose_another_users_data() {
        let root = env::temp_dir().join(format!("yingya-links-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("projects")).await.unwrap();
        std::os::unix::fs::symlink("/etc", root.join("projects/escape")).unwrap();
        assert!(
            agent_projects::reject_symlink_components(&root.join("projects/escape/passwd"))
                .is_err()
        );
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
