//! Single-host rolling runtime. An OS file lock, held for the worker's entire
//! lifetime, is the authority to write a user's files. Heartbeats are diagnostic:
//! a slow/stopped worker is NEVER replaced merely because its heartbeat expires.
use axum::{
    body::{Body, to_bytes},
    extract::Request,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use fs2::FileExt;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::process::Command;

#[derive(Clone, Default)]
pub struct Control(Arc<Mutex<Activity>>);
#[derive(Default)]
struct Activity {
    draining: bool,
    stopping: bool,
    active: usize,
}
pub struct WorkGuard(Control);
impl Drop for WorkGuard {
    fn drop(&mut self) {
        self.0.0.lock().unwrap().active -= 1;
    }
}
impl Control {
    pub fn enter(&self) -> Option<WorkGuard> {
        let mut s = self.0.lock().unwrap();
        if s.stopping {
            return None;
        }
        s.active += 1;
        Some(WorkGuard(self.clone()))
    }
    pub fn drain(&self) {
        self.0.lock().unwrap().draining = true;
    }
    pub fn draining(&self) -> bool {
        self.0.lock().unwrap().draining
    }
    pub fn finish_if_idle(&self) -> bool {
        let mut s = self.0.lock().unwrap();
        if s.draining && s.active == 0 {
            s.stopping = true;
        }
        s.stopping
    }
    pub fn active(&self) -> usize {
        self.0.lock().unwrap().active
    }
}

pub struct Ownership {
    _file: File,
}
impl Ownership {
    pub fn shared(path: &Path) -> Result<Self, String> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        FileExt::try_lock_shared(&file)
            .map_err(|_| "standalone backend still owns the deployment data")?;
        Ok(Self { _file: file })
    }
    pub fn acquire(path: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(path.parent().ok_or("lock has no parent")?)
            .map_err(|e| e.to_string())?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        file.try_lock_exclusive()
            .map_err(|_| format!("runtime already owns {}", path.display()))?;
        Ok(Self { _file: file })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Release {
    pub id: String,
    pub binary: PathBuf,
    pub resources: PathBuf,
}
impl Release {
    pub fn current(resources: &Path) -> Result<Self, String> {
        let binary = std::env::current_exe().map_err(|e| e.to_string())?;
        Ok(Self {
            id: std::env::var("YINGYA_RELEASE_ID").unwrap_or_else(|_| "development".into()),
            binary,
            resources: resources.into(),
        })
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Worker {
    pub user: String,
    pub instance: String,
    pub endpoint: String,
    pub release: String,
    pub session: String,
    pub heartbeat: i64,
    #[serde(skip_serializing)]
    pub token: String,
}
#[derive(Clone)]
pub struct Registry {
    db: Arc<Mutex<Connection>>,
    pub root: PathBuf,
}
impl Registry {
    pub fn open(data: &Path) -> Result<Self, String> {
        let root = data.join("deployment");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let db = Connection::open(root.join("registry.sqlite")).map_err(|e| e.to_string())?;
        db.busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS target(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workers(user TEXT PRIMARY KEY, instance TEXT NOT NULL, endpoint TEXT NOT NULL, release TEXT NOT NULL, session TEXT NOT NULL, token TEXT NOT NULL, heartbeat INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS previews(token TEXT PRIMARY KEY, user TEXT NOT NULL, payload TEXT NOT NULL, expires INTEGER NOT NULL);").map_err(|e|e.to_string())?;
        Ok(Self {
            db: Arc::new(Mutex::new(db)),
            root,
        })
    }
    pub fn initialize_target(&self, release: &Release) -> Result<(), String> {
        self.db
            .lock()
            .unwrap()
            .execute(
                "INSERT OR IGNORE INTO target VALUES(1,?1)",
                [serde_json::to_string(release).unwrap()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn target(&self) -> Result<Release, String> {
        let payload: String = self
            .db
            .lock()
            .unwrap()
            .query_row("SELECT payload FROM target WHERE id=1", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&payload).map_err(|e| e.to_string())
    }
    pub fn set_target(&self, release: &Release) -> Result<(), String> {
        if !release.binary.is_file() || !release.resources.join("web-dist/index.html").is_file() {
            return Err("release binary or frontend missing".into());
        }
        self.db.lock().unwrap().execute("INSERT INTO target VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload", [serde_json::to_string(release).unwrap()]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn owner_path(&self, user: &str) -> Result<PathBuf, String> {
        uuid::Uuid::parse_str(user).map_err(|_| "invalid worker user")?;
        Ok(self.root.join(format!("{user}.owner.lock")))
    }
    pub fn register(&self, worker: &Worker) -> Result<(), String> {
        self.db.lock().unwrap().execute("INSERT INTO workers VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(user) DO UPDATE SET instance=excluded.instance,endpoint=excluded.endpoint,release=excluded.release,session=excluded.session,token=excluded.token,heartbeat=excluded.heartbeat", params![worker.user,worker.instance,worker.endpoint,worker.release,worker.session,worker.token,worker.heartbeat]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn heartbeat(&self, worker: &Worker) -> Result<(), String> {
        self.db
            .lock()
            .unwrap()
            .execute(
                "UPDATE workers SET heartbeat=?3 WHERE user=?1 AND instance=?2",
                params![worker.user, worker.instance, crate::accounts::now()],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn worker(&self, user: &str) -> Result<Option<Worker>, String> {
        self.db.lock().unwrap().query_row("SELECT user,instance,endpoint,release,session,token,heartbeat FROM workers WHERE user=?1", [user], |r| Ok(Worker { user:r.get(0)?,instance:r.get(1)?,endpoint:r.get(2)?,release:r.get(3)?,session:r.get(4)?,token:r.get(5)?,heartbeat:r.get(6)? })).optional().map_err(|e|e.to_string())
    }
    pub fn users(&self) -> Result<Vec<String>, String> {
        let db = self.db.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT user FROM workers")
            .map_err(|e| e.to_string())?;
        stmt.query_map([], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn save_preview(
        &self,
        token: &str,
        user: &str,
        payload: &str,
        expires: i64,
    ) -> Result<(), String> {
        let db = self.db.lock().unwrap();
        db.execute(
            "DELETE FROM previews WHERE expires<=?1",
            [crate::accounts::now()],
        )
        .map_err(|e| e.to_string())?;
        db.execute("INSERT INTO previews VALUES(?1,?2,?3,?4) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload,expires=excluded.expires", params![token,user,payload,expires]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn preview(&self, token: &str) -> Result<Option<(String, String)>, String> {
        self.db
            .lock()
            .unwrap()
            .query_row(
                "SELECT user,payload FROM previews WHERE token=?1 AND expires>?2",
                params![token, crate::accounts::now()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())
    }
}

#[derive(Clone)]
pub struct Pool {
    pub registry: Registry,
    data: PathBuf,
    client: reqwest::Client,
}
impl Pool {
    pub fn new(data: PathBuf, registry: Registry) -> Result<Self, String> {
        Ok(Self {
            registry,
            data,
            client: reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(2))
                .build()
                .map_err(|e| e.to_string())?,
        })
    }
    pub async fn ensure(&self, user: &str) -> Result<Worker, String> {
        let owner_path = self.registry.owner_path(user)?;
        // This also prevents two API generations from racing to start a worker.
        let _launch = Ownership::acquire(&self.registry.root.join(format!("{user}.launch.lock")))?;
        if let Some(worker) = self.registry.worker(user)? {
            if Ownership::acquire(&owner_path).is_err() {
                let response = self
                    .client
                    .get(format!("{}/internal/runtime", worker.endpoint))
                    .header("x-yingya-worker", &worker.token)
                    .timeout(Duration::from_secs(3))
                    .send()
                    .await
                    .map_err(|_| "worker still owns data but is not responding")?;
                if response.status().is_success() {
                    let status: serde_json::Value =
                        response.json().await.map_err(|e| e.to_string())?;
                    if status["instance"].as_str() != Some(&worker.instance) {
                        return Err("worker identity mismatch".into());
                    }
                    if worker.release != self.registry.target()?.id {
                        self.client
                            .post(format!("{}/internal/drain", worker.endpoint))
                            .header("x-yingya-worker", &worker.token)
                            .timeout(Duration::from_secs(3))
                            .send()
                            .await
                            .map_err(|e| e.to_string())?;
                    }
                    return Ok(worker);
                }
                return Err("worker is handing off".into());
            }
        }
        // A live owner without a registration may still be initializing.
        drop(Ownership::acquire(&owner_path)?);
        let release = self.registry.target()?;
        let namespace = format!(
            "{:x}",
            Sha256::digest(self.data.to_string_lossy().as_bytes())
        );
        let session = format!("yingya-worker-{}-{user}", &namespace[..8]);
        if Command::new("tmux")
            .args(["has-session", "-t", &format!("={session}")])
            .output()
            .await
            .map_err(|e| e.to_string())?
            .status
            .success()
        {
            return Err("worker tmux session is still starting or stopping".into());
        }
        let instance = uuid::Uuid::new_v4().to_string();
        let mut cmd = Command::new("tmux");
        cmd.args(["new-session", "-d", "-s", &session, "-c"])
            .arg(&release.resources);
        for (key, value) in std::env::vars() {
            if !matches!(key.as_str(), "TMUX" | "TMUX_PANE") {
                cmd.arg("-e").arg(format!("{key}={value}"));
            }
        }
        for (key, value) in [
            ("YINGYA_MODE", "worker".to_owned()),
            ("YINGYA_WORKER_USER", user.to_owned()),
            ("YINGYA_WORKER_INSTANCE", instance.clone()),
            ("YINGYA_WORKER_SESSION", session.clone()),
            ("YINGYA_RELEASE_ID", release.id.clone()),
            (
                "YINGYA_RESOURCE_DIR",
                release.resources.to_string_lossy().into_owned(),
            ),
            (
                "YINGYA_APP_DATA_DIR",
                self.data.to_string_lossy().into_owned(),
            ),
            (
                "YINGYA_CODEX_BIN",
                release
                    .resources
                    .join("node_modules/.bin/codex")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ("YINGYA_ADDR", "127.0.0.1:0".into()),
        ] {
            cmd.arg("-e").arg(format!("{key}={value}"));
        }
        let output = cmd
            .arg(&release.binary)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(format!(
                "could not start tmux={session}: {}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        // Keep launch ownership until registration; cancellation cannot create a
        // duplicate because tmux existence and the worker lock are also checked.
        for _ in 0..300 {
            if let Some(worker) = self.registry.worker(user)?
                && worker.instance == instance
            {
                return Ok(worker);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err(format!(
            "worker initialization pending; inspect tmux={session}"
        ))
    }
    pub async fn forward(&self, user: &str, request: Request) -> Response {
        let (parts, body) = request.into_parts();
        let bytes = match to_bytes(body, 25 * 1024 * 1024).await {
            Ok(b) => b,
            Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
        };
        for attempt in 0..60 {
            let worker = match self.ensure(user).await {
                Ok(w) => w,
                Err(error) => {
                    if attempt == 59 {
                        tracing::warn!(%error,%user,"worker unavailable");
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    continue;
                }
            };
            let mut headers = parts.headers.clone();
            strip_hop_headers(&mut headers);
            headers.insert("x-yingya-worker", worker.token.parse().unwrap());
            let url = format!(
                "{}{}",
                worker.endpoint,
                parts.uri.path_and_query().map_or("/", |p| p.as_str())
            );
            match self
                .client
                .request(parts.method.clone(), url)
                .headers(headers)
                .body(bytes.clone())
                .send()
                .await
            {
                Ok(response) => {
                    if response.headers().get("x-yingya-not-accepted").is_some() {
                        tokio::time::sleep(Duration::from_millis(250)).await;
                        continue;
                    }
                    let status = response.status();
                    let mut headers = response.headers().clone();
                    strip_hop_headers(&mut headers);
                    let mut result = Response::new(Body::from_stream(response.bytes_stream()));
                    *result.status_mut() = status;
                    *result.headers_mut() = headers;
                    return result;
                }
                Err(_) if parts.method == "GET" || parts.method == "HEAD" => {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                // The worker might already have accepted a write. Never replay
                // ambiguous POSTs, uploads, media generation or billing calls.
                Err(error) => {
                    tracing::warn!(%error,"worker response lost; request was not replayed");
                    return (StatusCode::BAD_GATEWAY, "连接中断，请刷新任务状态后再操作")
                        .into_response();
                }
            }
        }
        (
            StatusCode::SERVICE_UNAVAILABLE,
            [("retry-after", "2")],
            "任务执行环境正在恢复，请稍后重试",
        )
            .into_response()
    }
    pub fn supervise(&self) {
        let pool = self.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(2)).await;
                match pool.registry.users() {
                    Ok(users) => {
                        for user in users {
                            let pool = pool.clone();
                            tokio::spawn(async move {
                                if let Err(error) = pool.ensure(&user).await {
                                    tracing::debug!(%user,%error,"worker reconciliation pending");
                                }
                            });
                        }
                    }
                    Err(error) => tracing::warn!(%error,"cannot read runtime registry"),
                }
            }
        });
    }
}
fn strip_hop_headers(headers: &mut HeaderMap) {
    if let Some(connection) = headers
        .get("connection")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
    {
        for name in connection.split(',') {
            headers.remove(name.trim());
        }
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn a_lost_write_response_is_not_replayed_or_reassigned_on_stale_heartbeat() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let root = std::env::temp_dir().join(format!("yingya-no-replay-{}", uuid::Uuid::new_v4()));
        let registry = Registry::open(&root).unwrap();
        let release = Release::current(Path::new(".")).unwrap();
        registry.initialize_target(&release).unwrap();
        let user = uuid::Uuid::new_v4().to_string();
        let _owner = Ownership::acquire(&registry.owner_path(&user).unwrap()).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        registry
            .register(&Worker {
                user: user.clone(),
                instance: "owned".into(),
                endpoint: format!("http://{}", listener.local_addr().unwrap()),
                release: release.id,
                session: "test-only".into(),
                token: "test-token".into(),
                heartbeat: 0,
            })
            .unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let server_calls = calls.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let calls = server_calls.clone();
                tokio::spawn(async move {
                    let mut buffer = vec![0; 8192];
                    let n = socket.read(&mut buffer).await.unwrap();
                    if String::from_utf8_lossy(&buffer[..n]).starts_with("GET /internal/runtime ") {
                        let body = r#"{"instance":"owned"}"#;
                        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).as_bytes()).await.unwrap();
                    } else {
                        calls.fetch_add(1, Ordering::SeqCst);
                    }
                    // The write endpoint accepts its operation, then loses the
                    // connection before returning headers.
                });
            }
        });
        let pool = Pool::new(root.clone(), registry.clone()).unwrap();
        let response = pool
            .forward(
                &user,
                Request::builder()
                    .method("POST")
                    .uri("/api/paid-operation")
                    .body(Body::from("operation"))
                    .unwrap(),
            )
            .await;
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(registry.worker(&user).unwrap().unwrap().instance, "owned");
        server.abort();
        drop(_owner);
        drop(pool);
        drop(registry);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ownership_fences_a_second_writer_until_exit() {
        let path = std::env::temp_dir().join(format!("yingya-lock-{}", uuid::Uuid::new_v4()));
        let first = Ownership::acquire(&path).unwrap();
        assert!(Ownership::acquire(&path).is_err());
        drop(first);
        assert!(Ownership::acquire(&path).is_ok());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn draining_waits_for_work_and_closes_admission_atomically() {
        let control = Control::default();
        let work = control.enter().unwrap();
        control.drain();
        assert!(control.draining());
        assert!(!control.finish_if_idle());
        let request = control.enter().unwrap();
        drop(work);
        assert!(!control.finish_if_idle());
        drop(request);
        assert!(control.finish_if_idle());
        assert!(control.enter().is_none());
    }
    #[test]
    fn target_is_shared_and_old_gateway_cannot_overwrite_it() {
        let dir = std::env::temp_dir().join(format!("yingya-registry-{}", uuid::Uuid::new_v4()));
        let a = Registry::open(&dir).unwrap();
        let b = Registry::open(&dir).unwrap();
        let mut release = Release::current(Path::new(".")).unwrap();
        a.initialize_target(&release).unwrap();
        release.id = "old".into();
        b.initialize_target(&release).unwrap();
        assert_ne!(a.target().unwrap().id, "old");
        drop(a);
        drop(b);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
