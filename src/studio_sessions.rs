use std::{
    collections::{HashMap, HashSet},
    future::Future,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{fs, process::Command, sync::Mutex};
use uuid::Uuid;

const STUDIO_PORT_START: u16 = 8600;
const STUDIO_PORT_END: u16 = 8799;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioSession {
    pub state: String,
    pub host: String,
    pub port: u16,
    pub project_name: String,
    pub server_url: String,
    pub preview_url: String,
    pub storyboard_url: String,
    pub last_seen_at: u64,
    #[serde(skip)]
    pub project_id: String,
    #[serde(skip)]
    pub project_dir: PathBuf,
    #[serde(skip)]
    source_fingerprint: u64,
}

#[derive(Clone)]
pub struct StudioSessionManager {
    runner: Arc<dyn PreviewCommandRunner>,
    projects_root: Arc<PathBuf>,
    sessions: Arc<Mutex<HashMap<String, StudioSession>>>,
    operation_lock: Arc<Mutex<()>>,
}

impl StudioSessionManager {
    pub fn new(cli: PathBuf, hyperframes_home: PathBuf, projects_root: PathBuf) -> Self {
        Self {
            runner: Arc::new(CliPreviewCommandRunner {
                cli: Arc::new(cli),
                hyperframes_home: Arc::new(hyperframes_home),
            }),
            projects_root: Arc::new(projects_root),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            operation_lock: Arc::new(Mutex::new(())),
        }
    }

    #[cfg(test)]
    fn with_runner(projects_root: PathBuf, runner: Arc<dyn PreviewCommandRunner>) -> Self {
        Self {
            runner,
            projects_root: Arc::new(projects_root),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            operation_lock: Arc::new(Mutex::new(())),
        }
    }

    pub async fn adopt_existing(&self) -> Result<usize, String> {
        let _guard = self.operation_lock.lock().await;
        let sessions = self.list_managed().await?;
        let root = fs::canonicalize(self.projects_root.as_ref())
            .await
            .unwrap_or_else(|_| self.projects_root.as_ref().clone());
        let now = now_millis();
        let mut adopted = 0;
        let mut state = self.sessions.lock().await;
        for listed in sessions {
            let Some(project_dir) = listed.project_dir.clone() else {
                continue;
            };
            let canonical = fs::canonicalize(&project_dir).await.unwrap_or(project_dir);
            let Ok(relative) = canonical.strip_prefix(&root) else {
                continue;
            };
            if relative.components().count() != 1 {
                continue;
            }
            let project_id = relative.to_string_lossy().to_string();
            if Uuid::parse_str(&project_id).is_err() {
                continue;
            }
            let session =
                studio_session_from_listed(project_id.clone(), canonical, listed, now).await?;
            state.insert(project_id, session);
            adopted += 1;
        }
        Ok(adopted)
    }

    pub async fn start(
        &self,
        project_id: &str,
        project_dir: &Path,
    ) -> Result<StudioSession, String> {
        Uuid::parse_str(project_id).map_err(|_| "invalid project id".to_owned())?;
        let _guard = self.operation_lock.lock().await;
        let canonical = fs::canonicalize(project_dir)
            .await
            .map_err(|error| error.to_string())?;
        let project_root = fs::canonicalize(self.projects_root.as_ref())
            .await
            .map_err(|error| error.to_string())?;
        if canonical.parent() != Some(project_root.as_path())
            || canonical.file_name().and_then(|name| name.to_str()) != Some(project_id)
        {
            return Err(
                "Studio project must be a direct child of the Yingya project root".to_owned(),
            );
        }

        let mut listed = self.list_managed().await?;
        if let Some(existing) = listed
            .iter()
            .find(|item| {
                item.ready
                    && item.state == "running"
                    && item.project_dir.as_deref() == Some(canonical.as_path())
            })
            .cloned()
        {
            if existing.host == "0.0.0.0" {
                let session = studio_session_from_listed(
                    project_id.to_owned(),
                    canonical,
                    existing,
                    now_millis(),
                )
                .await?;
                self.sessions
                    .lock()
                    .await
                    .insert(project_id.to_owned(), session.clone());
                return Ok(session);
            }
            self.run_preview(&canonical, &["--stop"]).await?;
            listed = self.list_managed().await?;
        }

        let used_ports: HashSet<u16> = listed.iter().map(|item| item.port).collect();
        let port = available_studio_port(&used_ports)
            .await
            .ok_or_else(|| "没有可用的 HyperFrames Studio 端口".to_owned())?;
        let output = self
            .run_preview(
                &canonical,
                &["--port", &port.to_string(), "--background", "--force-new"],
            )
            .await?;
        let listed = parse_preview_result(&output)?;
        let session =
            studio_session_from_listed(project_id.to_owned(), canonical, listed, now_millis())
                .await?;
        self.sessions
            .lock()
            .await
            .insert(project_id.to_owned(), session.clone());
        Ok(session)
    }

    pub async fn heartbeat(&self, project_id: &str) -> Result<StudioSession, String> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get_mut(project_id)
            .ok_or_else(|| "Studio 会话不存在，请重新连接".to_owned())?;
        session.last_seen_at = now_millis();
        Ok(session.clone())
    }

    pub async fn stop(&self, project_id: &str) -> Result<bool, String> {
        let _guard = self.operation_lock.lock().await;
        let session = self.sessions.lock().await.get(project_id).cloned();
        let Some(session) = session else {
            return Ok(false);
        };
        self.run_preview(&session.project_dir, &["--stop"]).await?;
        self.sessions.lock().await.remove(project_id);
        Ok(true)
    }

    pub async fn detect_source_changes(&self) -> Vec<String> {
        let snapshots: Vec<(String, PathBuf, u64)> = self
            .sessions
            .lock()
            .await
            .values()
            .map(|session| {
                (
                    session.project_id.clone(),
                    session.project_dir.clone(),
                    session.source_fingerprint,
                )
            })
            .collect();
        let mut changed = Vec::new();
        for (project_id, project_dir, baseline) in snapshots {
            let Ok(current) = source_fingerprint(&project_dir).await else {
                continue;
            };
            if current != baseline
                && let Some(session) = self.sessions.lock().await.get_mut(&project_id)
                && session.source_fingerprint != current
            {
                session.source_fingerprint = current;
                changed.push(project_id);
            }
        }
        changed
    }

    pub async fn reap_idle(&self, now: u64, idle_ms: u64) -> Vec<String> {
        let expired = {
            let sessions = self.sessions.lock().await;
            expired_session_ids(&sessions, now, idle_ms)
        };
        let mut stopped = Vec::new();
        for project_id in expired {
            if self.stop(&project_id).await.is_ok() {
                stopped.push(project_id);
            }
        }
        stopped
    }

    async fn list_managed(&self) -> Result<Vec<ListedSession>, String> {
        let output = self
            .run_preview(self.projects_root.as_ref(), &["--list"])
            .await?;
        let sessions = output
            .pointer("/result/sessions")
            .and_then(Value::as_array)
            .ok_or_else(|| "HyperFrames preview list 未返回会话列表".to_owned())?;
        sessions.iter().map(parse_listed_session).collect()
    }

    async fn run_preview(&self, directory: &Path, arguments: &[&str]) -> Result<Value, String> {
        self.runner
            .run(
                directory.to_path_buf(),
                arguments.iter().map(|value| (*value).to_owned()).collect(),
            )
            .await
    }
}

trait PreviewCommandRunner: Send + Sync {
    fn run(
        &self,
        directory: PathBuf,
        arguments: Vec<String>,
    ) -> Pin<Box<dyn Future<Output = Result<Value, String>> + Send>>;
}

struct CliPreviewCommandRunner {
    cli: Arc<PathBuf>,
    hyperframes_home: Arc<PathBuf>,
}

impl PreviewCommandRunner for CliPreviewCommandRunner {
    fn run(
        &self,
        directory: PathBuf,
        arguments: Vec<String>,
    ) -> Pin<Box<dyn Future<Output = Result<Value, String>> + Send>> {
        let cli = self.cli.clone();
        let hyperframes_home = self.hyperframes_home.clone();
        Box::pin(async move {
            let output = tokio::time::timeout(
                Duration::from_secs(30),
                Command::new(cli.as_ref())
                    .arg("preview")
                    .args(arguments)
                    .args(["--json", "--no-open"])
                    .current_dir(&directory)
                    .env("HOME", hyperframes_home.as_ref())
                    .env("HYPERFRAMES_PREVIEW_HOST", "0.0.0.0")
                    .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
                    .kill_on_drop(true)
                    .output(),
            )
            .await
            .map_err(|_| "HyperFrames preview 命令超时".to_owned())?
            .map_err(|error| error.to_string())?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
            }
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .rev()
                .find_map(|line| serde_json::from_str(line).ok())
                .ok_or_else(|| "HyperFrames preview 未返回 JSON".to_owned())
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListedSession {
    state: String,
    #[serde(default)]
    project_name: String,
    #[serde(default)]
    project_dir: Option<PathBuf>,
    host: String,
    port: u16,
    server_url: String,
    #[serde(default)]
    studio_url: Option<String>,
    #[serde(default)]
    ready: bool,
}

fn parse_listed_session(value: &Value) -> Result<ListedSession, String> {
    serde_json::from_value(value.clone()).map_err(|error| error.to_string())
}

fn parse_preview_result(value: &Value) -> Result<ListedSession, String> {
    let result = value
        .get("result")
        .ok_or_else(|| "HyperFrames preview 未返回结果".to_owned())?;
    parse_listed_session(result)
}

async fn available_studio_port(used_ports: &HashSet<u16>) -> Option<u16> {
    for port in STUDIO_PORT_START..=STUDIO_PORT_END {
        if used_ports.contains(&port) {
            continue;
        }
        if tokio::net::TcpListener::bind(("0.0.0.0", port))
            .await
            .is_ok()
        {
            return Some(port);
        }
    }
    None
}

fn expired_session_ids(
    sessions: &HashMap<String, StudioSession>,
    now: u64,
    idle_ms: u64,
) -> Vec<String> {
    sessions
        .values()
        .filter(|session| now.saturating_sub(session.last_seen_at) >= idle_ms)
        .map(|session| session.project_id.clone())
        .collect()
}

async fn studio_session_from_listed(
    project_id: String,
    project_dir: PathBuf,
    listed: ListedSession,
    now: u64,
) -> Result<StudioSession, String> {
    let project_name = if listed.project_name.trim().is_empty() {
        project_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&project_id)
            .to_owned()
    } else {
        listed.project_name
    };
    let preview_url = listed
        .studio_url
        .unwrap_or_else(|| format!("{}/#project/{project_name}", listed.server_url));
    Ok(StudioSession {
        state: listed.state,
        host: listed.host,
        port: listed.port,
        storyboard_url: format!(
            "{}/?view=storyboard#project/{project_name}",
            listed.server_url
        ),
        preview_url,
        server_url: listed.server_url,
        project_name,
        last_seen_at: now,
        project_id,
        source_fingerprint: source_fingerprint(&project_dir).await?,
        project_dir,
    })
}

async fn source_fingerprint(project_dir: &Path) -> Result<u64, String> {
    let mut entries = Vec::new();
    for name in [
        "index.html",
        "index.motion.json",
        "hyperframes.json",
        "meta.json",
        "DESIGN.md",
    ] {
        collect_file_fingerprint(project_dir, &project_dir.join(name), &mut entries).await?;
    }
    collect_directory_fingerprint(project_dir, &project_dir.join("compositions"), &mut entries)
        .await?;
    entries.sort();
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    entries.hash(&mut hasher);
    Ok(hasher.finish())
}

async fn collect_file_fingerprint(
    root: &Path,
    path: &Path,
    entries: &mut Vec<(String, u64, u64)>,
) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path).await {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.file_type().is_file() {
        return Ok(());
    }
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |value| value.as_nanos() as u64);
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string();
    entries.push((relative, metadata.len(), modified));
    Ok(())
}

fn collect_directory_fingerprint<'a>(
    root: &'a Path,
    directory: &'a Path,
    entries: &'a mut Vec<(String, u64, u64)>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let mut children = match fs::read_dir(directory).await {
            Ok(children) => children,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error.to_string()),
        };
        while let Some(child) = children
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            let metadata = fs::symlink_metadata(child.path())
                .await
                .map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                continue;
            }
            if metadata.is_dir() {
                collect_directory_fingerprint(root, &child.path(), entries).await?;
            } else if metadata.is_file() {
                collect_file_fingerprint(root, &child.path(), entries).await?;
            }
        }
        Ok(())
    })
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    type PreviewCall = (PathBuf, Vec<String>);

    #[derive(Default)]
    struct MockPreviewRunner {
        responses: Arc<Mutex<VecDeque<Result<Value, String>>>>,
        calls: Arc<Mutex<Vec<PreviewCall>>>,
    }

    impl MockPreviewRunner {
        fn with_responses(responses: Vec<Value>) -> Self {
            Self {
                responses: Arc::new(Mutex::new(
                    responses.into_iter().map(Ok).collect::<VecDeque<_>>(),
                )),
                calls: Arc::new(Mutex::new(Vec::new())),
            }
        }
    }

    impl PreviewCommandRunner for MockPreviewRunner {
        fn run(
            &self,
            directory: PathBuf,
            arguments: Vec<String>,
        ) -> Pin<Box<dyn Future<Output = Result<Value, String>> + Send>> {
            let responses = self.responses.clone();
            let calls = self.calls.clone();
            Box::pin(async move {
                calls.lock().await.push((directory, arguments));
                responses
                    .lock()
                    .await
                    .pop_front()
                    .unwrap_or_else(|| Err("unexpected preview command".to_owned()))
            })
        }
    }

    fn listed_session(project_dir: &Path, port: u16) -> Value {
        serde_json::json!({
            "state": "running",
            "projectName": project_dir.file_name().unwrap().to_string_lossy(),
            "projectDir": project_dir,
            "host": "0.0.0.0",
            "port": port,
            "serverUrl": format!("http://0.0.0.0:{port}"),
            "studioUrl": format!("http://0.0.0.0:{port}/#project/test"),
            "ready": true
        })
    }

    #[test]
    fn parses_managed_preview_session() {
        let value = serde_json::json!({
            "state": "running",
            "projectName": "project",
            "projectDir": "/tmp/project",
            "host": "0.0.0.0",
            "port": 8601,
            "serverUrl": "http://0.0.0.0:8601",
            "studioUrl": "http://0.0.0.0:8601/#project/project",
            "ready": true
        });
        let parsed = parse_listed_session(&value).unwrap();
        assert_eq!(parsed.port, 8601);
        assert!(parsed.ready);
    }

    #[tokio::test]
    async fn skips_ports_owned_by_other_projects() {
        let used = HashSet::from([8600, 8601, 8603]);
        let port = available_studio_port(&used).await.unwrap();
        assert!(!used.contains(&port));
    }

    #[tokio::test]
    async fn skips_ports_occupied_by_non_hyperframes_processes() {
        let mut bound = None;
        for port in STUDIO_PORT_START..=STUDIO_PORT_END {
            if let Ok(listener) = tokio::net::TcpListener::bind(("0.0.0.0", port)).await {
                bound = Some((port, listener));
                break;
            }
        }
        let (occupied_port, listener) = bound.expect("an available Studio port");
        let used = (STUDIO_PORT_START..=STUDIO_PORT_END)
            .filter(|port| *port != occupied_port)
            .collect();
        assert_eq!(available_studio_port(&used).await, None);
        drop(listener);
        assert_eq!(available_studio_port(&used).await, Some(occupied_port));
    }

    #[tokio::test]
    async fn reuses_the_exact_canonical_project_session() {
        let root = std::env::temp_dir().join(format!("yingya-studio-reuse-{}", Uuid::new_v4()));
        let project_id = Uuid::new_v4().to_string();
        let project = root.join(&project_id);
        fs::create_dir_all(&project).await.unwrap();
        fs::write(project.join("index.html"), "composition")
            .await
            .unwrap();
        let canonical = fs::canonicalize(&project).await.unwrap();
        let runner = Arc::new(MockPreviewRunner::with_responses(vec![
            serde_json::json!({ "result": { "sessions": [listed_session(&canonical, 8666)] } }),
        ]));
        let manager = StudioSessionManager::with_runner(root.clone(), runner.clone());

        let session = manager.start(&project_id, &project).await.unwrap();

        assert_eq!(session.port, 8666);
        let calls = runner.calls.lock().await;
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].1, vec!["--list"]);
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn stopping_a_project_cleans_up_its_managed_session() {
        let root = std::env::temp_dir().join(format!("yingya-studio-stop-{}", Uuid::new_v4()));
        let project_id = Uuid::new_v4().to_string();
        let project = root.join(&project_id);
        fs::create_dir_all(&project).await.unwrap();
        fs::write(project.join("index.html"), "composition")
            .await
            .unwrap();
        let canonical = fs::canonicalize(&project).await.unwrap();
        let runner = Arc::new(MockPreviewRunner::with_responses(vec![
            serde_json::json!({ "result": { "sessions": [] } }),
            serde_json::json!({ "result": listed_session(&canonical, 8667) }),
            serde_json::json!({ "result": { "stopped": true } }),
        ]));
        let manager = StudioSessionManager::with_runner(root.clone(), runner.clone());
        manager.start(&project_id, &project).await.unwrap();

        assert!(manager.stop(&project_id).await.unwrap());
        assert!(manager.heartbeat(&project_id).await.is_err());
        let calls = runner.calls.lock().await;
        assert_eq!(calls.last().unwrap().1, vec!["--stop"]);
        fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn heartbeat_timeout_only_expires_idle_sessions() {
        let session = |project_id: &str, last_seen_at| StudioSession {
            state: "running".to_owned(),
            host: "0.0.0.0".to_owned(),
            port: 8600,
            project_name: project_id.to_owned(),
            server_url: "http://0.0.0.0:8600".to_owned(),
            preview_url: "http://0.0.0.0:8600".to_owned(),
            storyboard_url: "http://0.0.0.0:8600/?view=storyboard".to_owned(),
            last_seen_at,
            project_id: project_id.to_owned(),
            project_dir: PathBuf::from("/tmp/project"),
            source_fingerprint: 0,
        };
        let sessions = HashMap::from([
            ("idle".to_owned(), session("idle", 1_000)),
            ("active".to_owned(), session("active", 7_500)),
        ]);

        let expired = expired_session_ids(&sessions, 10_000, 5_000);

        assert_eq!(expired, vec!["idle"]);
    }

    #[tokio::test]
    async fn fingerprint_ignores_versions_and_detects_composition_changes() {
        let root =
            std::env::temp_dir().join(format!("yingya-studio-fingerprint-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("compositions")).await.unwrap();
        fs::create_dir_all(root.join(".yingya/versions/draft-1"))
            .await
            .unwrap();
        fs::write(root.join("index.html"), "one").await.unwrap();
        let before = source_fingerprint(&root).await.unwrap();
        fs::write(root.join(".yingya/versions/draft-1/index.html"), "ignored")
            .await
            .unwrap();
        assert_eq!(before, source_fingerprint(&root).await.unwrap());
        fs::write(root.join("compositions/scene.html"), "two")
            .await
            .unwrap();
        assert_ne!(before, source_fingerprint(&root).await.unwrap());
        let _ = fs::remove_dir_all(root).await;
    }
}
