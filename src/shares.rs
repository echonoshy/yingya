//! Public, immutable video snapshots. This store is outside all Agent sandboxes.
use super::*;
use rusqlite::{Connection, OptionalExtension, params};
use std::os::{fd::AsRawFd, unix::fs::PermissionsExt};
use tokio::{io::AsyncReadExt, sync::Semaphore};

const MAX_FILE: u64 = 1024 * 1024 * 1024;
const GB: i64 = 1_000_000_000;
#[derive(Clone)]
pub(super) struct Store {
    root: PathBuf,
    db: Arc<std::sync::Mutex<Connection>>,
    streams: Arc<Semaphore>,
    copies: Arc<Semaphore>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Share {
    id: String,
    owner: String,
    project_id: String,
    artifact_id: String,
    token: String,
    title: String,
    version: String,
    created_at: i64,
    expires_at: Option<i64>,
    revoked_at: Option<i64>,
    state: String,
    bytes: u64,
    duration: f64,
    width: u64,
    height: u64,
}
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub(super) struct Error {
    status: StatusCode,
    message: String,
}
type Result<T> = std::result::Result<T, Error>;
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        protected(failure(self.status, &self.message))
    }
}
impl From<rusqlite::Error> for Error {
    fn from(error: rusqlite::Error) -> Self {
        warn!(%error,"share database failure");
        err(
            StatusCode::SERVICE_UNAVAILABLE,
            "分享服务暂不可用，请稍后重试",
        )
    }
}
impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        warn!(%error,"share storage failure");
        err(
            StatusCode::SERVICE_UNAVAILABLE,
            "视频文件暂不可用，请稍后重试",
        )
    }
}
fn err(status: StatusCode, message: &str) -> Error {
    Error {
        status,
        message: message.into(),
    }
}
fn bad(message: &str) -> Error {
    err(StatusCode::BAD_REQUEST, message)
}
fn missing() -> Error {
    err(StatusCode::NOT_FOUND, "分享不存在或已失效")
}
fn limited() -> Error {
    err(
        StatusCode::TOO_MANY_REQUESTS,
        "分享访问较多或已达到流量保护上限，请稍后重试",
    )
}
fn protected(mut r: Response) -> Response {
    for (key, value) in [
        ("cache-control", "private, no-store"),
        ("referrer-policy", "no-referrer"),
        ("x-robots-tag", "noindex, nofollow, noarchive"),
        ("x-content-type-options", "nosniff"),
        ("cross-origin-resource-policy", "same-origin"),
    ] {
        r.headers_mut().insert(key, value.parse().unwrap());
    }
    if r.status() == StatusCode::TOO_MANY_REQUESTS {
        r.headers_mut().insert("retry-after", "60".parse().unwrap());
    }
    r
}
fn authenticated(g: &Gateway, headers: &HeaderMap) -> Result<User> {
    let u = user(g, headers).ok_or_else(|| err(StatusCode::UNAUTHORIZED, "请先登录"))?;
    if !same_origin(headers) {
        return Err(err(StatusCode::FORBIDDEN, "不允许跨站请求"));
    }
    if headers
        .get("x-yingya-user")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|id| id != u.id)
    {
        return Err(err(StatusCode::UNAUTHORIZED, "账号已切换，请刷新页面"));
    }
    Ok(u)
}
fn expiry(days: u16) -> Result<Option<i64>> {
    match days {
        0 => Ok(None),
        7 | 30 => Ok(Some(crate::accounts::now() + i64::from(days) * 86400)),
        _ => Err(bad("有效期请选择 7 天、30 天或长期有效")),
    }
}
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Share> {
    let data: String = r.get(0)?;
    let mut s: Share = serde_json::from_str(&data).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e))
    })?;
    s.state = r.get(1)?;
    s.expires_at = r.get(2)?;
    s.revoked_at = r.get(3)?;
    Ok(s)
}
impl Store {
    pub(super) fn open(data: &FilePath) -> Result<Self> {
        let root = data.join("video-shares");
        std::fs::create_dir_all(&root)?;
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700))?;
        let db = Connection::open(root.join("shares.sqlite"))?;
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,owner TEXT NOT NULL,project TEXT NOT NULL,data TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL,expires INTEGER,revoked INTEGER,state TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS shares_owner ON shares(owner,project,created);
        CREATE TABLE IF NOT EXISTS share_counters(scope TEXT NOT NULL,bucket INTEGER NOT NULL,amount INTEGER NOT NULL,PRIMARY KEY(scope,bucket));
        CREATE TABLE IF NOT EXISTS share_audit(id TEXT PRIMARY KEY,share TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,created INTEGER NOT NULL);")?;
        Ok(Self {
            root,
            db: Arc::new(std::sync::Mutex::new(db)),
            streams: Arc::new(Semaphore::new(64)),
            copies: Arc::new(Semaphore::new(2)),
        })
    }
    fn by(&self, column: &str, value: &str) -> Result<Share> {
        self.db
            .lock()
            .unwrap()
            .query_row(
                &format!("SELECT data,state,expires,revoked FROM shares WHERE {column}=?1"),
                [value],
                row,
            )
            .optional()?
            .ok_or_else(missing)
    }
    fn get(&self, id: &str) -> Result<Share> {
        self.by("id", id)
    }
    fn token(&self, token: &str) -> Result<Share> {
        if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(missing());
        }
        self.by(
            "token_hash",
            &format!("{:x}", Sha256::digest(token.as_bytes())),
        )
    }
    fn audit(db: &Connection, id: &str, actor: &str, action: &str) -> rusqlite::Result<usize> {
        db.execute(
            "INSERT INTO share_audit VALUES(?1,?2,?3,?4,?5)",
            params![
                Uuid::new_v4().to_string(),
                id,
                actor,
                action,
                crate::accounts::now()
            ],
        )
    }
    fn reserve(&self, s: &Share) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let (count, total): (i64, i64) = tx.query_row(
            "SELECT COUNT(*),COALESCE(SUM(bytes),0) FROM shares WHERE owner=?1 AND state!='purged'",
            [&s.owner],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let global: i64 = tx.query_row(
            "SELECT COALESCE(SUM(bytes),0) FROM shares WHERE state!='purged'",
            [],
            |r| r.get(0),
        )?;
        if count >= 100 || total + s.bytes as i64 > 20 * GB || global + s.bytes as i64 > 100 * GB {
            return Err(bad(
                "分享存储已达上限，请取消不再需要的分享，文件清理后再试",
            ));
        }
        tx.execute(
            "INSERT INTO shares VALUES(?1,?2,?3,?4,?5,?6,?7,?8,NULL,'preparing')",
            params![
                s.id,
                format!("{:x}", Sha256::digest(s.token.as_bytes())),
                s.owner,
                s.project_id,
                serde_json::to_string(s).unwrap(),
                s.bytes,
                s.created_at,
                s.expires_at
            ],
        )?;
        Self::audit(&tx, &s.id, &s.owner, "创建分享")?;
        tx.commit()?;
        Ok(())
    }
    fn activate(&self, s: &Share) -> Result<()> {
        self.db.lock().unwrap().execute("UPDATE shares SET data=?2,bytes=?3,state='active' WHERE id=?1 AND state='preparing' AND revoked IS NULL",params![s.id,serde_json::to_string(s).unwrap(),s.bytes])?;
        if self.get(&s.id)?.state != "active" {
            return Err(missing());
        }
        Ok(())
    }
    fn revoke(&self, id: &str, actor: &str) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        tx.execute("UPDATE shares SET revoked=COALESCE(revoked,?2),state=CASE WHEN state='purged' THEN state ELSE 'revoked' END WHERE id=?1",params![id,crate::accounts::now()])?;
        Self::audit(&tx, id, actor, "取消分享")?;
        tx.commit()?;
        Ok(())
    }
    pub(super) fn revoke_project(&self, owner: &str, project: &str) -> Result<()> {
        self.db.lock().unwrap().execute("UPDATE shares SET revoked=COALESCE(revoked,?3),state='revoked' WHERE owner=?1 AND project=?2 AND state IN ('active','preparing')",params![owner,project,crate::accounts::now()])?;
        Ok(())
    }
    pub(super) fn revoke_owner(&self, owner: &str) -> Result<()> {
        self.db.lock().unwrap().execute("UPDATE shares SET revoked=COALESCE(revoked,?2),state='revoked' WHERE owner=?1 AND state IN ('active','preparing')",params![owner,crate::accounts::now()])?;
        Ok(())
    }
    fn change_expiry(&self, id: &str, owner: &str, expires: Option<i64>) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction()?;
        let n=tx.execute("UPDATE shares SET expires=?3 WHERE id=?1 AND owner=?2 AND revoked IS NULL AND state='active'",params![id,owner,expires])?;
        if n == 0 {
            return Err(missing());
        }
        Self::audit(&tx, id, owner, "调整分享有效期")?;
        tx.commit()?;
        Ok(())
    }
    // Reserve full response lengths, including interrupted transfers. This is a conservative
    // traffic ceiling, not billing or a viewer count. Counters survive rolling releases.
    fn budget(&self, limits: &[(String, i64, i64)], bucket: i64) -> Result<()> {
        let mut db = self.db.lock().unwrap();
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        for (scope, amount, limit) in limits {
            let used: i64 = tx
                .query_row(
                    "SELECT amount FROM share_counters WHERE scope=?1 AND bucket=?2",
                    params![scope, bucket],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(0);
            if used.saturating_add(*amount) > *limit {
                return Err(limited());
            }
            tx.execute("INSERT INTO share_counters VALUES(?1,?2,?3) ON CONFLICT(scope,bucket) DO UPDATE SET amount=amount+excluded.amount",params![scope,bucket,amount])?;
        }
        tx.commit()?;
        Ok(())
    }
    fn list(&self, owner: Option<&str>, project: Option<&str>, offset: i64) -> Result<Vec<Share>> {
        let db = self.db.lock().unwrap();
        let mut query=db.prepare("SELECT data,state,expires,revoked FROM shares WHERE (?1 IS NULL OR owner=?1) AND (?2 IS NULL OR project=?2) AND (?1 IS NULL OR state!='purged') ORDER BY created DESC,rowid DESC LIMIT 100 OFFSET ?3")?;
        Ok(query
            .query_map(params![owner, project, offset], row)?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }
    fn management(&self, s: &Share, include_link: bool) -> Result<Value> {
        let db = self.db.lock().unwrap();
        let traffic: i64 = db
            .query_row(
                "SELECT amount FROM share_counters WHERE scope=?1 AND bucket=?2",
                params![format!("bytes:{}", s.id), crate::accounts::now() / 86400],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(0);
        let state = if s.revoked_at.is_some() || s.state == "purged" {
            "revoked"
        } else if s.expires_at.is_some_and(|e| e <= crate::accounts::now()) {
            "expired"
        } else {
            &s.state
        };
        Ok(
            json!({"id":s.id,"projectId":s.project_id,"ownerId":s.owner,"artifactId":s.artifact_id,"title":s.title,"version":s.version,"createdAt":s.created_at,"expiresAt":s.expires_at,"status":state,"bytes":s.bytes,"reservedBytesToday":traffic,"url":if include_link && s.revoked_at.is_none() && s.state=="active" {Some(format!("/s/{}",s.token))}else{None}}),
        )
    }
    pub(super) async fn cleanup(&self, data: &FilePath, accounts: &Accounts) -> Result<()> {
        let items = {
            let db = self.db.lock().unwrap();
            let mut q =
                db.prepare("SELECT data,state,expires,revoked FROM shares WHERE state!='purged'")?;
            q.query_map([], row)?
                .collect::<std::result::Result<Vec<_>, _>>()?
        };
        let now = crate::accounts::now();
        for s in items {
            if s.state != "purging"
                && (!project_exists(data, &s.owner, &s.project_id)
                    || accounts.runtime_user(&s.owner).is_err()
                    || (s.state == "preparing" && s.created_at < now - 3600))
            {
                self.revoke(&s.id, "system")?;
            }
            let s = self.get(&s.id)?;
            let ended = s.revoked_at.or(s.expires_at);
            if s.state == "purging" || ended.is_some_and(|t| t < now - 86400) {
                // Claim cleanup before removing files; an expiry extension cannot race deletion.
                let claimed = self.db.lock().unwrap().execute("UPDATE shares SET state='purging',revoked=COALESCE(revoked,?2) WHERE id=?1 AND state!='purged' AND (state='purging' OR COALESCE(revoked,expires)<?3)",params![s.id,now,now-86400])?;
                if claimed == 0 {
                    continue;
                }
                match fs::remove_dir_all(self.root.join(&s.id)).await {
                    Ok(()) => (),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                    Err(e) => return Err(e.into()),
                }
                self.db.lock().unwrap().execute(
                    "UPDATE shares SET state='purged',revoked=COALESCE(revoked,?2) WHERE id=?1",
                    params![s.id, now],
                )?;
            }
        }
        self.db.lock().unwrap().execute("DELETE FROM share_counters WHERE (scope LIKE 'req:%' AND bucket<?1) OR (scope LIKE 'bytes:%' AND bucket<?2)",params![now/60-1440,now/86400-30])?;
        Ok(())
    }
}
fn project_exists(data: &FilePath, owner: &str, project: &str) -> bool {
    let path = data
        .join("users")
        .join(owner)
        .join("projects")
        .join(project)
        .join("project.json");
    Uuid::parse_str(project).is_ok()
        && agent_projects::reject_symlink_components(&path).is_ok()
        && path.is_file()
}
fn live(g: &Gateway, s: &Share) -> Result<()> {
    if s.state != "active"
        || s.revoked_at.is_some()
        || s.expires_at.is_some_and(|e| e <= crate::accounts::now())
    {
        return Err(missing());
    }
    if !project_exists(&g.paths.app_data, &s.owner, &s.project_id)
        || g.accounts.runtime_user(&s.owner).is_err()
    {
        g.shares.revoke(&s.id, "system")?;
        return Err(missing());
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Create {
    project_id: String,
    artifact_id: Option<String>,
    version_id: Option<String>,
    days: u16,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Update {
    days: u16,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Listing {
    project_id: Option<String>,
    #[serde(default)]
    offset: i64,
}

pub(super) fn routes() -> Router<Gateway> {
    Router::new()
        .route("/api/shares", get(list).post(create))
        .route("/api/shares/{id}", patch(update).delete(revoke))
        .route("/api/public/shares/{token}", get(metadata))
        .route("/api/public/shares/{token}/video", get(video))
        .route("/api/public/shares/{token}/poster", get(poster))
        .route("/api/admin/shares", get(admin_list))
        .route(
            "/api/admin/shares/{id}",
            axum::routing::delete(admin_revoke),
        )
        .layer(DefaultBodyLimit::max(4096))
}
pub(super) async fn page(State(g): State<Gateway>, request: Request) -> Response {
    let response = ServeFile::new(g.paths.resources.join("web-dist/index.html"))
        .oneshot(request)
        .await
        .unwrap()
        .into_response();
    let mut response = protected(response);
    response.headers_mut().insert("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'".parse().unwrap());
    response
}
async fn list(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Query(q): Query<Listing>,
) -> Result<Response> {
    let u = authenticated(&g, &headers)?;
    let items = g
        .shares
        .list(Some(&u.id), q.project_id.as_deref(), q.offset.max(0))?;
    let values = items
        .iter()
        .map(|s| g.shares.management(s, true))
        .collect::<Result<Vec<_>>>()?;
    Ok(protected(Json(json!({"shares":values})).into_response()))
}
async fn admin_list(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Query(q): Query<Listing>,
) -> Result<Response> {
    if let Err(r) = admin(&g, &headers) {
        return Ok(*r);
    }
    let items = g
        .shares
        .list(None, q.project_id.as_deref(), q.offset.max(0))?;
    let values = items
        .iter()
        .map(|s| g.shares.management(s, false))
        .collect::<Result<Vec<_>>>()?;
    Ok(protected(Json(json!({"shares":values})).into_response()))
}
async fn update(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(input): Json<Update>,
) -> Result<Response> {
    let u = authenticated(&g, &headers)?;
    let s = g.shares.get(&id)?;
    if s.owner != u.id {
        return Err(missing());
    }
    if !project_exists(&g.paths.app_data, &u.id, &s.project_id) {
        return Err(missing());
    }
    g.shares.change_expiry(&id, &u.id, expiry(input.days)?)?;
    Ok(protected(
        Json(g.shares.management(&g.shares.get(&id)?, true)?).into_response(),
    ))
}
async fn revoke(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response> {
    let u = authenticated(&g, &headers)?;
    let s = g.shares.get(&id)?;
    if s.owner != u.id {
        return Err(missing());
    }
    g.shares.revoke(&id, &u.id)?;
    Ok(protected(StatusCode::NO_CONTENT.into_response()))
}
async fn admin_revoke(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Response> {
    let actor = match admin(&g, &headers) {
        Ok(u) => u,
        Err(r) => return Ok(*r),
    };
    g.shares.get(&id)?;
    g.shares.revoke(&id, &actor.id)?;
    g.accounts
        .record_admin_action(&actor.id, "下架视频分享", &id, json!({}))
        .map_err(|_| {
            err(
                StatusCode::SERVICE_UNAVAILABLE,
                "分享已下架，操作记录暂不可用",
            )
        })?;
    Ok(protected(StatusCode::NO_CONTENT.into_response()))
}
async fn create(
    State(g): State<Gateway>,
    headers: HeaderMap,
    Json(input): Json<Create>,
) -> Result<Response> {
    let u = authenticated(&g, &headers)?;
    let expires = expiry(input.days)?;
    let permit = g
        .shares
        .copies
        .clone()
        .try_acquire_owned()
        .map_err(|_| limited())?;
    g.shares.budget(
        &[(format!("req:create:{}", u.id), 1, 10)],
        crate::accounts::now() / 60,
    )?;
    // Finish or clean up the copy even when the browser disconnects.
    tokio::spawn(async move {
        let _permit = permit;
        create_snapshot(&g, &u, input, expires).await
    })
    .await
    .map_err(|_| err(StatusCode::SERVICE_UNAVAILABLE, "创建分享失败，请重试"))?
}
async fn read_json<T: serde::de::DeserializeOwned>(path: &FilePath) -> Result<T> {
    agent_projects::reject_symlink_components(path).map_err(|_| bad("项目文件路径不可用"))?;
    let bytes = fs::read(path).await?;
    serde_json::from_slice(&bytes).map_err(|_| bad("项目记录不可用"))
}
async fn create_snapshot(
    g: &Gateway,
    u: &User,
    input: Create,
    expires: Option<i64>,
) -> Result<Response> {
    if !project_exists(&g.paths.app_data, &u.id, &input.project_id) {
        return Err(err(StatusCode::NOT_FOUND, "项目不存在"));
    }
    let root = g
        .paths
        .app_data
        .join("users")
        .join(&u.id)
        .join("projects")
        .join(&input.project_id);
    let project: AgentProjectRecord = read_json(&root.join("project.json")).await?;
    let manifest: agent_projects::AgentManifest =
        read_json(&root.join(".yingya/manifest.json")).await?;
    // Resolve only recorded videos; never accept a caller-supplied file path.
    let (video_path, artifact_id, version_id) = match (&input.artifact_id, &input.version_id) {
        (Some(id), None) => {
            let artifact = manifest
                .artifacts
                .iter()
                .find(|a| {
                    &a.id == id
                        && matches!(a.kind.as_str(), "final-video" | "video" | "draft-video")
                })
                .ok_or_else(|| bad("请选择已生成的视频再分享"))?;
            if artifact.kind == "final-video" {
                let jobs: Vec<RenderJob> =
                    read_json(&root.join(".yingya/render-jobs.json")).await?;
                if !jobs.iter().any(|j| {
                    j.status == RenderJobStatus::Completed
                        && j.output_path.as_deref() == Some(&artifact.path)
                        && Some(&j.version_id) == artifact.version.as_ref()
                }) {
                    return Err(bad("这次视频尚未完成导出，请选择已生成的预览视频"));
                }
            }
            (artifact.path.clone(), id.clone(), artifact.version.clone())
        }
        (None, Some(id)) => {
            let version = manifest
                .versions
                .iter()
                .find(|v| &v.id == id && !v.video_path.is_empty())
                .ok_or_else(|| bad("该版本还没有可分享的预览视频"))?;
            (
                version.video_path.clone(),
                format!("version:{id}"),
                Some(id.clone()),
            )
        }
        _ => return Err(bad("请选择一个视频版本或视频文件")),
    };
    let path = root.join(&video_path);
    agent_projects::reject_symlink_components(&path).map_err(|_| bad("视频路径不可用"))?;
    let canonical = fs::canonicalize(&path).await?;
    if !canonical.starts_with(&root)
        || canonical.extension().and_then(|v| v.to_str()) != Some("mp4")
    {
        return Err(bad("仅支持分享项目内已生成的 MP4 视频"));
    }
    // Pin the opened inode and recheck its resolved path to close symlink replacement races.
    let opened = std::fs::File::open(&canonical)?;
    let pinned = std::fs::read_link(format!("/proc/self/fd/{}", opened.as_raw_fd()))?;
    if !pinned.starts_with(&root) {
        return Err(bad("视频路径不可用"));
    }
    let meta = opened.metadata()?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_FILE {
        return Err(bad("分享视频须大于 0 字节且不超过 1 GiB"));
    }
    let mut s = Share {
        id: Uuid::new_v4().to_string(),
        owner: u.id.clone(),
        project_id: input.project_id,
        artifact_id,
        token: crate::accounts::secret(),
        title: project.title.chars().take(80).collect(),
        version: manifest
            .versions
            .iter()
            .find(|v| Some(&v.id) == version_id.as_ref())
            .map(|v| v.label.replace("草稿", "视频"))
            .unwrap_or_else(|| "视频".into()),
        created_at: crate::accounts::now(),
        expires_at: expires,
        revoked_at: None,
        state: "preparing".into(),
        bytes: meta.len(),
        duration: 0.,
        width: 0,
        height: 0,
    };
    g.shares.reserve(&s)?;
    let dir = g.shares.root.join(&s.id);
    let result = async {
        fs::create_dir(&dir).await?;
        let mut source = fs::File::from_std(opened).take(MAX_FILE + 1);
        let mut dest = fs::File::create(dir.join("source.mp4")).await?;
        let copied = tokio::io::copy(&mut source, &mut dest).await?;
        dest.sync_all().await?;
        drop(dest);
        let after = source.get_ref().metadata().await?;
        if copied != meta.len()
            || after.len() != meta.len()
            || after.modified()? != meta.modified()?
        {
            return Err(bad("视频正在变化，请等待生成完成后重试"));
        }
        prepare_video(&dir, &mut s).await?;
        if !project_exists(&g.paths.app_data, &u.id, &s.project_id)
            || g.accounts.runtime_user(&u.id).is_err()
        {
            return Err(missing());
        }
        s.state = "active".into();
        g.shares.activate(&s)?;
        Ok(protected(
            (StatusCode::CREATED, Json(g.shares.management(&s, true)?)).into_response(),
        ))
    }
    .await;
    if result.is_err() {
        g.shares.revoke(&s.id, "system")?;
        let _ = fs::remove_dir_all(&dir).await;
    }
    result
}
async fn process(mut command: Command) -> Result<Vec<u8>> {
    command.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(180), command.output())
        .await
        .map_err(|_| bad("准备分享超时，请稍后重试"))??;
    if !output.status.success() {
        return Err(bad("视频无法准备为可播放的分享，请重新导出成片"));
    }
    Ok(output.stdout)
}
async fn prepare_video(dir: &FilePath, s: &mut Share) -> Result<()> {
    let mut probe = Command::new("ffprobe");
    probe
        .args([
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "stream=codec_type,codec_name,pix_fmt,width,height:format=duration",
            "-of",
            "json",
        ])
        .arg(dir.join("source.mp4"));
    let info: Value =
        serde_json::from_slice(&process(probe).await?).map_err(|_| bad("无法读取视频信息"))?;
    let streams = info["streams"]
        .as_array()
        .ok_or_else(|| bad("文件没有视频轨道"))?;
    let video = streams
        .iter()
        .find(|v| v["codec_type"] == "video")
        .ok_or_else(|| bad("文件没有视频轨道"))?;
    if video["codec_name"] != "h264"
        || video["pix_fmt"] != "yuv420p"
        || streams
            .iter()
            .any(|v| v["codec_type"] == "audio" && v["codec_name"] != "aac")
    {
        return Err(bad("请导出 H.264（yuv420p）视频和 AAC 音频的 MP4 后再分享"));
    }
    s.width = video["width"].as_u64().unwrap_or(0);
    s.height = video["height"].as_u64().unwrap_or(0);
    s.duration = info["format"]["duration"]
        .as_str()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.);
    if s.width > 8192
        || s.height > 8192
        || s.width == 0
        || s.height == 0
        || !s.duration.is_finite()
        || s.duration <= 0.
    {
        return Err(bad("视频时长或画面尺寸无效"));
    }
    let mut remux = Command::new("ffmpeg");
    remux
        .args([
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
        ])
        .arg(dir.join("source.mp4"))
        .args([
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c",
            "copy",
            "-map_metadata",
            "-1",
            "-movflags",
            "+faststart",
            "-y",
        ])
        .arg(dir.join("video.mp4"));
    process(remux).await?;
    let mut poster = Command::new("ffmpeg");
    poster
        .args([
            "-nostdin",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
        ])
        .arg(dir.join("video.mp4"))
        .args([
            "-frames:v",
            "1",
            "-vf",
            "scale=960:960:force_original_aspect_ratio=decrease",
            "-threads",
            "1",
            "-y",
        ])
        .arg(dir.join("poster.jpg"));
    process(poster).await?;
    s.bytes = fs::metadata(dir.join("video.mp4")).await?.len();
    if s.bytes > MAX_FILE {
        return Err(bad("分享视频超过 1 GiB"));
    }
    for name in ["video.mp4", "poster.jpg"] {
        let file = fs::File::open(dir.join(name)).await?;
        file.sync_all().await?;
        fs::set_permissions(dir.join(name), std::fs::Permissions::from_mode(0o444)).await?;
    }
    fs::remove_file(dir.join("source.mp4")).await?;
    Ok(())
}
fn public_share(g: &Gateway, token: &str) -> Result<Share> {
    g.shares.budget(
        &[("req:public".into(), 1, 3000)],
        crate::accounts::now() / 60,
    )?;
    let s = g.shares.token(token)?;
    live(g, &s)?;
    g.shares.budget(
        &[(format!("req:share:{}", s.id), 1, 600)],
        crate::accounts::now() / 60,
    )?;
    Ok(s)
}
async fn metadata(State(g): State<Gateway>, Path(token): Path<String>) -> Result<Response> {
    let s = public_share(&g, &token)?;
    Ok(protected(Json(json!({"title":s.title,"version":s.version,"expiresAt":s.expires_at,"duration":s.duration,"width":s.width,"height":s.height,"videoUrl":format!("/api/public/shares/{token}/video"),"posterUrl":format!("/api/public/shares/{token}/poster")})).into_response()))
}
async fn video(
    State(g): State<Gateway>,
    Path(token): Path<String>,
    request: Request,
) -> Result<Response> {
    media(g, token, request, "video.mp4").await
}
async fn poster(
    State(g): State<Gateway>,
    Path(token): Path<String>,
    request: Request,
) -> Result<Response> {
    media(g, token, request, "poster.jpg").await
}
async fn media(g: Gateway, token: String, mut request: Request, name: &str) -> Result<Response> {
    let s = public_share(&g, &token)?;
    let permit = g
        .shares
        .streams
        .clone()
        .try_acquire_owned()
        .map_err(|_| limited())?;
    if request
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains(','))
    {
        return Err(bad("一次请求仅支持一个视频范围"));
    }
    // Never return 304 based on a previously authorized response.
    request.headers_mut().remove("if-none-match");
    request.headers_mut().remove("if-modified-since");
    let head = request.method() == "HEAD";
    let response = ServeFile::new(g.shares.root.join(&s.id).join(name))
        .oneshot(request)
        .await
        .unwrap()
        .into_response();
    if response.status().is_success() && !head {
        let bytes = response
            .headers()
            .get(CONTENT_LENGTH)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(s.bytes as i64);
        g.shares.budget(
            &[
                (format!("bytes:{}", s.id), bytes, 20 * GB),
                (format!("bytes:owner:{}", s.owner), bytes, 100 * GB),
                ("bytes:global".into(), bytes, 500 * GB),
            ],
            crate::accounts::now() / 86400,
        )?;
    }
    let (parts, body) = response.into_parts();
    let stream = body.into_data_stream().map(move |chunk| {
        let _ = &permit;
        chunk
    });
    Ok(protected(Response::from_parts(
        parts,
        Body::from_stream(stream),
    )))
}

#[cfg(test)]
#[path = "shares_tests.rs"]
mod tests;
