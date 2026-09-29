use serde::Serialize;
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{fs, sync::Mutex};
use uuid::Uuid;

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

impl StudioSession {
    pub fn source_revision(&self) -> String {
        format!("{:016x}", self.source_fingerprint)
    }
}

#[derive(Clone)]
pub struct StudioSessionManager {
    projects_root: Arc<PathBuf>,
    sessions: Arc<Mutex<HashMap<String, StudioSession>>>,
    operation_lock: Arc<Mutex<()>>,
}

impl StudioSessionManager {
    pub fn new(projects_root: PathBuf) -> Self {
        Self {
            projects_root: Arc::new(projects_root),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            operation_lock: Arc::new(Mutex::new(())),
        }
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
        let root = fs::canonicalize(self.projects_root.as_ref())
            .await
            .map_err(|e| e.to_string())?;
        if canonical.parent() != Some(root.as_path())
            || canonical.file_name().and_then(|name| name.to_str()) != Some(project_id)
        {
            return Err("预览目录与项目不匹配".into());
        }
        let url = format!("/api/agent-projects/{project_id}/files/index.html");
        let session = StudioSession {
            state: "running".into(),
            host: String::new(),
            port: 0,
            project_name: project_id.into(),
            server_url: url.clone(),
            preview_url: url.clone(),
            storyboard_url: url,
            last_seen_at: now_millis(),
            project_id: project_id.into(),
            project_dir: canonical.clone(),
            source_fingerprint: source_fingerprint(&canonical).await?,
        };
        self.sessions
            .lock()
            .await
            .insert(project_id.into(), session.clone());
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
        let Some(_) = session else {
            return Ok(false);
        };

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

async fn source_fingerprint(project_dir: &Path) -> Result<u64, String> {
    let mut entries = Vec::new();
    for name in [
        "index.html",
        "remotion-build.json",
        "remotion.json",
        "meta.json",
        "DESIGN.md",
    ] {
        collect_file_fingerprint(project_dir, &project_dir.join(name), &mut entries).await?;
    }
    collect_directory_fingerprint(project_dir, &project_dir.join("compositions"), &mut entries)
        .await?;
    collect_directory_fingerprint(project_dir, &project_dir.join("src"), &mut entries).await?;
    collect_directory_fingerprint(project_dir, &project_dir.join("assets"), &mut entries).await?;
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
    #[tokio::test]
    async fn private_preview_revision_tracks_each_source_change() {
        let root = std::env::temp_dir().join(format!("yingya-studio-revision-{}", Uuid::new_v4()));
        let project_id = Uuid::new_v4().to_string();
        let project = root.join(&project_id);
        fs::create_dir_all(&project).await.unwrap();
        fs::write(project.join("index.html"), "first")
            .await
            .unwrap();
        let manager = StudioSessionManager::new(root.clone());
        let first = manager.start(&project_id, &project).await.unwrap();
        assert_eq!(
            first.source_revision(),
            manager
                .heartbeat(&project_id)
                .await
                .unwrap()
                .source_revision()
        );
        let mut previous = first.source_revision();
        for content in ["second frame", "third updated frame"] {
            fs::write(project.join("index.html"), content)
                .await
                .unwrap();
            assert_eq!(
                manager.detect_source_changes().await,
                vec![project_id.clone()]
            );
            let current = manager
                .heartbeat(&project_id)
                .await
                .unwrap()
                .source_revision();
            assert_ne!(previous, current);
            assert!(manager.detect_source_changes().await.is_empty());
            previous = current;
        }
        manager.stop(&project_id).await.unwrap();
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
