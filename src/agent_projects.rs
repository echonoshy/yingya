use std::{collections::HashMap, path::{Component, Path, PathBuf}, sync::Arc, time::{SystemTime, UNIX_EPOCH}};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tokio::{fs, io::AsyncWriteExt, sync::Mutex};
use uuid::Uuid;

#[derive(Clone)]
pub struct AgentProjectStore {
    root: Arc<PathBuf>,
    locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    sequences: Arc<Mutex<HashMap<String, u64>>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentProjectRequest {
    pub prompt: String,
    pub title: Option<String>,
    #[serde(default = "default_aspect")]
    pub aspect_ratio: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_effort")]
    pub reasoning_effort: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjectRecord {
    pub id: String,
    pub title: String,
    pub status: String,
    pub status_label: String,
    pub thread_id: Option<String>,
    pub active_turn_id: Option<String>,
    pub queue_depth: usize,
    pub model: String,
    pub reasoning_effort: String,
    pub aspect_ratio: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub context: Vec<String>,
    pub status: String,
    pub created_at: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnRequest {
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub context: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub interrupt: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedTurn {
    pub id: String,
    pub text: String,
    pub attachments: Vec<String>,
    pub context: Vec<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub seq: u64,
    pub project_id: String,
    pub turn_id: Option<String>,
    pub method: String,
    pub payload: Value,
    pub created_at: u64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCheckpoint {
    pub id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub artifact_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentArtifact {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftVersion {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub source_path: String,
    pub video_path: String,
    #[serde(default, alias = "qualityReportPath")]
    pub report_path: Option<String>,
    #[serde(default, deserialize_with = "deserialize_timestamp")]
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentManifest {
    pub schema_version: u32,
    pub phase: String,
    #[serde(default)]
    pub dirty: bool,
    #[serde(default)]
    pub checkpoint: Option<AgentCheckpoint>,
    #[serde(default)]
    pub output_spec: Value,
    #[serde(default)]
    pub artifacts: Vec<AgentArtifact>,
    #[serde(default)]
    pub versions: Vec<DraftVersion>,
    #[serde(default)]
    pub current_draft: Option<String>,
    #[serde(default = "default_studio_entry")]
    pub studio_entry: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjectDetail {
    #[serde(flatten)]
    pub project: AgentProjectRecord,
    pub manifest: AgentManifest,
    pub messages: Vec<AgentMessage>,
    pub queue: Vec<QueuedTurn>,
    pub events: Vec<AgentEvent>,
}

impl AgentProjectStore {
    pub async fn new(root: PathBuf) -> Result<Self, std::io::Error> {
        fs::create_dir_all(&root).await?;
        let store = Self {
            root: Arc::new(root),
            locks: Arc::new(Mutex::new(HashMap::new())),
            sequences: Arc::new(Mutex::new(HashMap::new())),
        };
        store.migrate_legacy_titles().await.map_err(std::io::Error::other)?;
        Ok(store)
    }

    async fn migrate_legacy_titles(&self) -> Result<(), String> {
        for project in self.list().await? {
            let messages: Vec<AgentMessage> = read_json_or_default(&self.project_dir(&project.id)?.join("messages.json")).await?;
            let Some(prompt) = messages.iter().find(|message| message.role == "user").map(|message| message.text.as_str()) else { continue; };
            if project.title != derive_legacy_title(prompt) { continue; }
            let next = derive_title(prompt);
            if next != project.title {
                let path = self.project_dir(&project.id)?.join("project.json");
                let mut migrated = project;
                migrated.title = next;
                write_json(&path, &migrated).await?;
            }
        }
        Ok(())
    }

    pub fn project_dir(&self, id: &str) -> Result<PathBuf, String> {
        Uuid::parse_str(id).map_err(|_| "invalid project id".to_owned())?;
        Ok(self.root.join(id))
    }

    async fn project_lock(&self, id: &str) -> Result<Arc<Mutex<()>>, String> {
        self.project_dir(id)?;
        let mut locks = self.locks.lock().await;
        Ok(locks.entry(id.to_owned()).or_insert_with(|| Arc::new(Mutex::new(()))).clone())
    }

    pub async fn create(&self, request: &CreateAgentProjectRequest) -> Result<AgentProjectRecord, String> {
        let prompt = request.prompt.trim();
        if prompt.is_empty() { return Err("prompt cannot be empty".to_owned()); }
        if !matches!(request.aspect_ratio.as_str(), "9:16" | "16:9" | "1:1") {
            return Err("aspectRatio must be 9:16, 16:9, or 1:1".to_owned());
        }
        let id = Uuid::new_v4().to_string();
        let directory = self.project_dir(&id)?;
        for child in ["assets/inbox", "assets/generated", "artifacts", "compositions", ".yingya/versions", ".yingya/reports"] {
            fs::create_dir_all(directory.join(child)).await.map_err(|error| error.to_string())?;
        }
        let created_at = now_millis();
        let project = AgentProjectRecord {
            id: id.clone(),
            title: request.title.as_ref().filter(|value| !value.trim().is_empty()).cloned().unwrap_or_else(|| derive_title(prompt)),
            status: "starting".to_owned(),
            status_label: "正在启动 Codex".to_owned(),
            thread_id: None,
            active_turn_id: None,
            queue_depth: 0,
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            aspect_ratio: request.aspect_ratio.clone(),
            created_at,
            updated_at: created_at,
        };
        let manifest = AgentManifest {
            schema_version: 1,
            phase: "briefing".to_owned(),
            dirty: false,
            checkpoint: None,
            output_spec: serde_json::json!({"aspectRatio": request.aspect_ratio}),
            artifacts: vec![],
            versions: vec![],
            current_draft: None,
            studio_entry: default_studio_entry(),
        };
        write_json(&directory.join("project.json"), &project).await?;
        write_json(&directory.join(".yingya/manifest.json"), &manifest).await?;
        write_json(&directory.join("messages.json"), &Vec::<AgentMessage>::new()).await?;
        write_json(&directory.join("queue.json"), &Vec::<QueuedTurn>::new()).await?;
        fs::write(directory.join("events.jsonl"), []).await.map_err(|error| error.to_string())?;
        Ok(project)
    }

    pub async fn list(&self) -> Result<Vec<AgentProjectRecord>, String> {
        let mut directory = fs::read_dir(self.root.as_ref()).await.map_err(|error| error.to_string())?;
        let mut projects = Vec::new();
        while let Some(entry) = directory.next_entry().await.map_err(|error| error.to_string())? {
            if !entry.file_type().await.map_err(|error| error.to_string())?.is_dir() { continue; }
            if let Ok(project) = read_json::<AgentProjectRecord>(&entry.path().join("project.json")).await { projects.push(project); }
        }
        projects.sort_by_key(|project| std::cmp::Reverse(project.updated_at));
        Ok(projects)
    }

    pub async fn get(&self, id: &str) -> Result<AgentProjectDetail, String> {
        let directory = self.project_dir(id)?;
        Ok(AgentProjectDetail {
            project: read_json(&directory.join("project.json")).await?,
            manifest: self.manifest(id).await?,
            messages: read_json_or_default(&directory.join("messages.json")).await?,
            queue: read_json_or_default(&directory.join("queue.json")).await?,
            events: self.read_events(id, 0).await?,
        })
    }

    pub async fn delete(&self, id: &str) -> Result<(), String> {
        let lock = self.project_lock(id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(id)?;
        let project: AgentProjectRecord = read_json(&directory.join("project.json")).await?;
        if project.active_turn_id.is_some() {
            return Err("项目仍在运行，请先停止任务再删除".to_owned());
        }
        fs::remove_dir_all(&directory).await.map_err(|error| error.to_string())?;
        drop(_guard);
        self.locks.lock().await.remove(id);
        self.sequences.lock().await.remove(id);
        Ok(())
    }

    pub async fn read_project(&self, id: &str) -> Result<AgentProjectRecord, String> {
        read_json(&self.project_dir(id)?.join("project.json")).await
    }

    pub async fn update_project<F>(&self, id: &str, update: F) -> Result<AgentProjectRecord, String>
    where F: FnOnce(&mut AgentProjectRecord) {
        let lock = self.project_lock(id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(id)?.join("project.json");
        let mut project: AgentProjectRecord = read_json(&path).await?;
        update(&mut project);
        project.updated_at = now_millis();
        write_json(&path, &project).await?;
        Ok(project)
    }

    pub async fn manifest(&self, id: &str) -> Result<AgentManifest, String> {
        let mut manifest: AgentManifest = read_json_or_default(&self.project_dir(id)?.join(".yingya/manifest.json")).await?;
        for version in &mut manifest.versions {
            if version.label.trim().is_empty() { version.label = version.id.clone(); }
            if version.source_path.trim().is_empty() { version.source_path = format!(".yingya/versions/{}", version.id); }
        }
        Ok(manifest)
    }

    pub async fn write_manifest(&self, id: &str, manifest: &AgentManifest) -> Result<(), String> {
        write_json(&self.project_dir(id)?.join(".yingya/manifest.json"), manifest).await
    }

    pub async fn append_message(&self, project_id: &str, role: &str, text: &str, attachments: Vec<String>, context: Vec<String>, status: &str) -> Result<AgentMessage, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let path = directory.join("messages.json");
        let mut messages: Vec<AgentMessage> = read_json_or_default(&path).await?;
        let message = AgentMessage { id: Uuid::new_v4().to_string(), role: role.to_owned(), text: text.trim().to_owned(), attachments, context, status: status.to_owned(), created_at: now_millis() };
        messages.push(message.clone());
        write_json(&path, &messages).await?;
        Ok(message)
    }

    pub async fn enqueue(&self, project_id: &str, request: AgentTurnRequest) -> Result<QueuedTurn, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let path = directory.join("queue.json");
        let mut queue: Vec<QueuedTurn> = read_json_or_default(&path).await?;
        let turn = QueuedTurn { id: Uuid::new_v4().to_string(), text: request.text.trim().to_owned(), attachments: request.attachments, context: request.context, model: request.model, reasoning_effort: request.reasoning_effort, created_at: now_millis() };
        queue.push(turn.clone());
        write_json(&path, &queue).await?;
        let project_path = directory.join("project.json");
        let mut project: AgentProjectRecord = read_json(&project_path).await?;
        project.queue_depth = queue.len(); project.updated_at = now_millis();
        write_json(&project_path, &project).await?;
        Ok(turn)
    }

    pub async fn dequeue(&self, project_id: &str) -> Result<Option<QueuedTurn>, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let path = directory.join("queue.json");
        let mut queue: Vec<QueuedTurn> = read_json_or_default(&path).await?;
        let next = (!queue.is_empty()).then(|| queue.remove(0));
        write_json(&path, &queue).await?;
        let project_path = directory.join("project.json");
        let mut project: AgentProjectRecord = read_json(&project_path).await?;
        project.queue_depth = queue.len(); project.updated_at = now_millis();
        write_json(&project_path, &project).await?;
        Ok(next)
    }

    pub async fn remove_queued(&self, project_id: &str, turn_id: &str) -> Result<(), String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let path = directory.join("queue.json");
        let mut queue: Vec<QueuedTurn> = read_json_or_default(&path).await?;
        queue.retain(|turn| turn.id != turn_id);
        write_json(&path, &queue).await?;
        let project_path = directory.join("project.json");
        let mut project: AgentProjectRecord = read_json(&project_path).await?;
        project.queue_depth = queue.len(); project.updated_at = now_millis();
        write_json(&project_path, &project).await
    }

    pub async fn append_event(&self, project_id: &str, turn_id: Option<String>, method: String, payload: Value) -> Result<AgentEvent, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let mut sequences = self.sequences.lock().await;
        let seq = if let Some(value) = sequences.get_mut(project_id) { *value += 1; *value } else {
            let count = self.read_events_unlocked(project_id, 0).await?.last().map_or(0, |event| event.seq) + 1;
            sequences.insert(project_id.to_owned(), count); count
        };
        drop(sequences);
        let event = AgentEvent { seq, project_id: project_id.to_owned(), turn_id, method, payload, created_at: now_millis() };
        let mut file = fs::OpenOptions::new().create(true).append(true).open(self.project_dir(project_id)?.join("events.jsonl")).await.map_err(|error| error.to_string())?;
        let mut bytes = serde_json::to_vec(&event).map_err(|error| error.to_string())?; bytes.push(b'\n');
        file.write_all(&bytes).await.map_err(|error| error.to_string())?;
        Ok(event)
    }

    pub async fn read_events(&self, project_id: &str, after: u64) -> Result<Vec<AgentEvent>, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        self.read_events_unlocked(project_id, after).await
    }

    async fn read_events_unlocked(&self, project_id: &str, after: u64) -> Result<Vec<AgentEvent>, String> {
        let path = self.project_dir(project_id)?.join("events.jsonl");
        let content = match fs::read_to_string(path).await { Ok(value) => value, Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(), Err(error) => return Err(error.to_string()) };
        Ok(content.lines().filter_map(|line| serde_json::from_str::<AgentEvent>(line).ok()).filter(|event| event.seq > after).collect())
    }

    pub async fn recover_interrupted(&self) -> Result<(), String> {
        for project in self.list().await? {
            if project.active_turn_id.is_some() || project.status == "running" {
                self.update_project(&project.id, |record| { record.active_turn_id = None; record.status = "interrupted".to_owned(); record.status_label = "上次运行被中断".to_owned(); }).await?;
                let mut manifest = self.manifest(&project.id).await?; manifest.dirty = true; self.write_manifest(&project.id, &manifest).await?;
            }
        }
        Ok(())
    }

    pub fn resolve_relative(&self, project_id: &str, relative: &str) -> Result<PathBuf, String> {
        let path = Path::new(relative);
        if path.is_absolute() || path.components().any(|part| !matches!(part, Component::Normal(_))) { return Err("invalid project path".to_owned()); }
        Ok(self.project_dir(project_id)?.join(path))
    }
}

impl Default for AgentManifest {
    fn default() -> Self {
        Self { schema_version: 1, phase: "briefing".to_owned(), dirty: false, checkpoint: None, output_spec: Value::Object(Default::default()), artifacts: vec![], versions: vec![], current_draft: None, studio_entry: default_studio_entry() }
    }
}

fn default_aspect() -> String { "9:16".to_owned() }
fn default_model() -> String { "gpt-5.6-terra".to_owned() }
fn default_effort() -> String { "high".to_owned() }
fn default_studio_entry() -> String { "index.html".to_owned() }
fn derive_legacy_title(prompt: &str) -> String {
    prompt.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(24).collect()
}

fn derive_title(prompt: &str) -> String {
    let compact = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    let video_type = if compact.contains("演示") { "演示视频" }
        else if compact.contains("宣传") { "宣传视频" }
        else if compact.contains("发布") { "发布视频" }
        else if compact.contains("教程") { "教程视频" }
        else if compact.contains("科普") || compact.contains("解释") { "科普视频" }
        else if compact.contains("介绍") { "介绍视频" }
        else { "视频" };

    let subject = ["来说明一下", "说明一下", "介绍一下", "关于"]
        .iter()
        .find_map(|marker| compact.rsplit_once(marker).map(|(_, value)| clean_subject(value)))
        .filter(|value| !value.is_empty())
        .or_else(|| {
            ["的宣传视频", "的演示视频", "的发布视频", "的教程视频", "的科普视频", "的介绍视频", "的视频"]
                .iter()
                .find_map(|marker| compact.find(marker).map(|index| clean_subject(&compact[..index])))
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| clean_subject(&compact));

    let title = if subject.is_empty() { video_type.to_owned() } else { format!("{} {}", title_case_ascii_words(&subject), video_type) };
    title.chars().take(24).collect()
}

fn clean_subject(value: &str) -> String {
    let value = value.split(['，', '。', '！', '？', ',', '.', '!', '?', '；', ';', '\n']).next().unwrap_or(value).trim();
    let mut subject = value;
    for prefix in ["请帮我做一个", "请帮我制作一个", "帮我做一个", "帮我制作一个", "做一个", "制作一个", "创建一个", "生成一个", "做一支", "制作一支", "创建一支", "生成一支", "一个", "一支"] {
        if let Some(rest) = subject.strip_prefix(prefix) { subject = rest.trim(); break; }
    }
    for prefix in ["简单的", "简单", "关于", "用于"] {
        if let Some(rest) = subject.strip_prefix(prefix) { subject = rest.trim(); }
    }
    for suffix in ["的宣传视频", "宣传视频", "的演示视频", "演示视频", "的发布视频", "发布视频", "的教程视频", "教程视频", "的科普短片", "科普短片", "的科普视频", "科普视频", "的介绍视频", "介绍视频", "的视频", "视频", "的短片", "短片"] {
        if let Some(rest) = subject.strip_suffix(suffix) { subject = rest.trim(); break; }
    }
    subject.trim_matches(|character: char| character.is_whitespace() || "的：:，。！？,.!?".contains(character)).chars().take(16).collect()
}

fn title_case_ascii_words(value: &str) -> String {
    value.split(' ').map(|word| {
        if !word.is_empty() && word.chars().all(|character| character.is_ascii_alphabetic()) {
            let mut characters = word.chars();
            characters.next().map(|first| first.to_ascii_uppercase().to_string() + characters.as_str()).unwrap_or_default()
        } else { word.to_owned() }
    }).collect::<Vec<_>>().join(" ")
}
pub fn now_millis() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64 }

fn deserialize_timestamp<'de, D>(deserializer: D) -> Result<u64, D::Error>
where D: Deserializer<'de> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Timestamp { Millis(u64), Text(String) }
    Ok(match Timestamp::deserialize(deserializer)? {
        Timestamp::Millis(value) => value,
        Timestamp::Text(value) => value.parse().unwrap_or_default(),
    })
}

async fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).await.map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

async fn read_json_or_default<T: for<'de> Deserialize<'de> + Default>(path: &Path) -> Result<T, String> {
    match fs::read(path).await { Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()), Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()), Err(error) => Err(error.to_string()) }
}

async fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, bytes).await.map_err(|error| error.to_string())?;
    fs::rename(&temporary, path).await.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> CreateAgentProjectRequest {
        CreateAgentProjectRequest {
            prompt: "测试删除项目".to_owned(),
            title: None,
            aspect_ratio: "16:9".to_owned(),
            model: "gpt-5.6-terra".to_owned(),
            reasoning_effort: "high".to_owned(),
        }
    }

    #[tokio::test]
    async fn deletes_idle_projects_and_preserves_running_projects() {
        let root = std::env::temp_dir().join(format!("yingya-delete-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone()).await.expect("create store");
        let idle = store.create(&request()).await.expect("create idle project");
        store.delete(&idle.id).await.expect("delete idle project");
        assert!(!store.project_dir(&idle.id).expect("idle path").exists());

        let running = store.create(&request()).await.expect("create running project");
        store.update_project(&running.id, |project| project.active_turn_id = Some("turn-1".to_owned())).await.expect("mark running");
        assert!(store.delete(&running.id).await.is_err());
        assert!(store.project_dir(&running.id).expect("running path").exists());
        fs::remove_dir_all(root).await.expect("clean test store");
    }

    #[test]
    fn summarizes_project_titles_by_subject_and_video_type() {
        assert_eq!(derive_title("做一个简单的演示视频， 来说明一下 viaim"), "Viaim 演示视频");
        assert_eq!(derive_title("做一个 claude code 的宣传视频，30 秒"), "Claude Code 宣传视频");
        assert_eq!(derive_title("请帮我制作一个关于量子纠缠的科普短片"), "量子纠缠 科普视频");
    }

    #[test]
    fn accepts_agent_generated_version_timestamps_and_defaults() {
        let manifest: AgentManifest = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "phase": "draft_review",
            "versions": [{
                "id": "draft-1",
                "createdAt": "2026-09-01T15:41:11+08:00",
                "videoPath": ".yingya/versions/draft-1/video.mp4",
                "qualityReportPath": ".yingya/quality/draft-1.json"
            }]
        })).expect("parse agent manifest");
        let version = &manifest.versions[0];
        assert_eq!(version.id, "draft-1");
        assert_eq!(version.created_at, 0);
        assert_eq!(version.report_path.as_deref(), Some(".yingya/quality/draft-1.json"));
    }

    #[tokio::test]
    async fn migrates_titles_created_by_the_legacy_truncation_rule() {
        let root = std::env::temp_dir().join(format!("yingya-title-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone()).await.expect("create store");
        let prompt = "做一个简单的演示视频， 来说明一下 viaim";
        let mut input = request(); input.prompt = prompt.to_owned();
        let project = store.create(&input).await.expect("create project");
        store.append_message(&project.id, "user", prompt, vec![], vec![], "completed").await.expect("append prompt");
        store.update_project(&project.id, |record| record.title = derive_legacy_title(prompt)).await.expect("seed legacy title");
        drop(store);

        let migrated = AgentProjectStore::new(root.clone()).await.expect("reopen store");
        assert_eq!(migrated.read_project(&project.id).await.expect("read migrated project").title, "Viaim 演示视频");
        fs::remove_dir_all(root).await.expect("clean test store");
    }
}
