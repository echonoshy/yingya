use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncSeekExt, AsyncWriteExt, BufReader},
    sync::Mutex,
};
use uuid::Uuid;

use crate::render_jobs::RenderJob;

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
    #[serde(default = "default_voice")]
    pub voice_id: String,
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
    #[serde(default)]
    pub queue_paused: bool,
    pub model: String,
    pub reasoning_effort: String,
    pub aspect_ratio: String,
    #[serde(default = "default_voice")]
    pub voice_id: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub id: String,
    #[serde(default)]
    pub turn_id: Option<String>,
    pub role: String,
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<String>,
    #[serde(default)]
    pub context: Vec<String>,
    pub status: String,
    pub created_at: u64,
}

pub struct AppendAgentMessage {
    pub turn_id: Option<String>,
    pub role: String,
    pub text: String,
    pub attachments: Vec<String>,
    pub context: Vec<String>,
    pub status: String,
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventPage {
    pub items: Vec<AgentEvent>,
    pub next_before: Option<u64>,
    pub latest_seq: u64,
    pub has_more: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventIndex {
    latest_seq: u64,
    checkpoints: Vec<EventIndexEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct EventIndexEntry {
    seq: u64,
    offset: u64,
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

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaScene {
    pub id: String,
    #[serde(default)]
    pub order: usize,
    #[serde(default)]
    pub narrative_role: String,
    #[serde(default)]
    pub asset_ids: Vec<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    pub name: String,
    pub url: String,
    pub hyperframes_path: String,
    pub kind: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_seconds: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMedia {
    pub scenes: Vec<MediaScene>,
    pub assets: Vec<MediaAsset>,
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
    pub event_cursor: u64,
    #[serde(default)]
    pub render_jobs: Vec<RenderJob>,
}

impl AgentProjectStore {
    pub async fn new(root: PathBuf) -> Result<Self, std::io::Error> {
        fs::create_dir_all(&root).await?;
        let store = Self {
            root: Arc::new(root),
            locks: Arc::new(Mutex::new(HashMap::new())),
            sequences: Arc::new(Mutex::new(HashMap::new())),
        };
        store
            .migrate_legacy_titles()
            .await
            .map_err(std::io::Error::other)?;
        store
            .migrate_voice_settings()
            .await
            .map_err(std::io::Error::other)?;
        store
            .rebuild_event_indexes()
            .await
            .map_err(std::io::Error::other)?;
        Ok(store)
    }

    async fn migrate_legacy_titles(&self) -> Result<(), String> {
        for project in self.list().await? {
            let messages: Vec<AgentMessage> =
                read_json_or_default(&self.project_dir(&project.id)?.join("messages.json")).await?;
            let Some(prompt) = messages
                .iter()
                .find(|message| message.role == "user")
                .map(|message| message.text.as_str())
            else {
                continue;
            };
            let looks_like_generated_title = project.title == derive_legacy_title(prompt)
                || (["视频给我", "视频吧", "短片给我", "短片吧"]
                    .iter()
                    .any(|fragment| project.title.contains(fragment))
                    && project.title.ends_with("视频"));
            if !looks_like_generated_title {
                continue;
            }
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

    async fn migrate_voice_settings(&self) -> Result<(), String> {
        for project in self.list().await? {
            let path = self.project_dir(&project.id)?.join(".yingya/voice.json");
            if fs::try_exists(&path)
                .await
                .map_err(|error| error.to_string())?
            {
                continue;
            }
            write_json(
                &path,
                &serde_json::json!({
                    "provider": "voxcpm2",
                    "voiceId": project.voice_id,
                }),
            )
            .await?;
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
        Ok(locks
            .entry(id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    pub async fn create(
        &self,
        request: &CreateAgentProjectRequest,
    ) -> Result<AgentProjectRecord, String> {
        let prompt = request.prompt.trim();
        if prompt.is_empty() {
            return Err("prompt cannot be empty".to_owned());
        }
        if !matches!(request.aspect_ratio.as_str(), "9:16" | "16:9" | "1:1") {
            return Err("aspectRatio must be 9:16, 16:9, or 1:1".to_owned());
        }
        let id = Uuid::new_v4().to_string();
        let directory = self.project_dir(&id)?;
        for child in [
            "assets/inbox",
            "assets/generated",
            "artifacts",
            "compositions",
            ".yingya/versions",
            ".yingya/reports",
        ] {
            fs::create_dir_all(directory.join(child))
                .await
                .map_err(|error| error.to_string())?;
        }
        let created_at = now_millis();
        let project = AgentProjectRecord {
            id: id.clone(),
            title: request
                .title
                .as_ref()
                .filter(|value| !value.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| derive_title(prompt)),
            status: "starting".to_owned(),
            status_label: "正在启动 Codex".to_owned(),
            thread_id: None,
            active_turn_id: None,
            queue_depth: 0,
            queue_paused: false,
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
            aspect_ratio: request.aspect_ratio.clone(),
            voice_id: request.voice_id.clone(),
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
        write_json(
            &directory.join(".yingya/voice.json"),
            &serde_json::json!({
                "provider": "voxcpm2",
                "voiceId": request.voice_id,
            }),
        )
        .await?;
        write_json(&directory.join(".yingya/manifest.json"), &manifest).await?;
        write_json(
            &directory.join("messages.json"),
            &Vec::<AgentMessage>::new(),
        )
        .await?;
        write_json(&directory.join("queue.json"), &Vec::<QueuedTurn>::new()).await?;
        fs::write(directory.join("events.jsonl"), [])
            .await
            .map_err(|error| error.to_string())?;
        Ok(project)
    }

    pub async fn list(&self) -> Result<Vec<AgentProjectRecord>, String> {
        let mut directory = fs::read_dir(self.root.as_ref())
            .await
            .map_err(|error| error.to_string())?;
        let mut projects = Vec::new();
        while let Some(entry) = directory
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            if !entry
                .file_type()
                .await
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                continue;
            }
            if let Ok(project) =
                read_json::<AgentProjectRecord>(&entry.path().join("project.json")).await
            {
                projects.push(project);
            }
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
            event_cursor: self.event_cursor(id).await?,
            render_jobs: vec![],
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
        fs::remove_dir_all(&directory)
            .await
            .map_err(|error| error.to_string())?;
        drop(_guard);
        self.locks.lock().await.remove(id);
        self.sequences.lock().await.remove(id);
        Ok(())
    }

    pub async fn read_project(&self, id: &str) -> Result<AgentProjectRecord, String> {
        read_json(&self.project_dir(id)?.join("project.json")).await
    }

    pub async fn update_project<F>(&self, id: &str, update: F) -> Result<AgentProjectRecord, String>
    where
        F: FnOnce(&mut AgentProjectRecord),
    {
        let lock = self.project_lock(id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(id)?.join("project.json");
        let mut project: AgentProjectRecord = read_json(&path).await?;
        update(&mut project);
        project.updated_at = now_millis();
        write_json(&path, &project).await?;
        Ok(project)
    }

    pub async fn update_voice(
        &self,
        id: &str,
        voice_id: String,
    ) -> Result<AgentProjectRecord, String> {
        let lock = self.project_lock(id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(id)?;
        let project_path = directory.join("project.json");
        let mut project: AgentProjectRecord = read_json(&project_path).await?;
        project.voice_id = voice_id.clone();
        project.updated_at = now_millis();
        write_json(&project_path, &project).await?;
        write_json(
            &directory.join(".yingya/voice.json"),
            &serde_json::json!({ "provider": "voxcpm2", "voiceId": voice_id }),
        )
        .await?;
        Ok(project)
    }

    pub async fn manifest(&self, id: &str) -> Result<AgentManifest, String> {
        let mut manifest: AgentManifest =
            read_json_or_default(&self.project_dir(id)?.join(".yingya/manifest.json")).await?;
        for version in &mut manifest.versions {
            if version.label.trim().is_empty() {
                version.label = version.id.clone();
            }
            if version.source_path.trim().is_empty() {
                version.source_path = format!(".yingya/versions/{}", version.id);
            }
        }
        Ok(manifest)
    }

    pub async fn write_manifest(&self, id: &str, manifest: &AgentManifest) -> Result<(), String> {
        write_json(
            &self.project_dir(id)?.join(".yingya/manifest.json"),
            manifest,
        )
        .await
    }

    pub async fn append_message(
        &self,
        project_id: &str,
        input: AppendAgentMessage,
    ) -> Result<AgentMessage, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let path = directory.join("messages.json");
        let mut messages: Vec<AgentMessage> = read_json_or_default(&path).await?;
        let message = AgentMessage {
            id: Uuid::new_v4().to_string(),
            turn_id: input.turn_id,
            role: input.role,
            text: input.text.trim().to_owned(),
            attachments: input.attachments,
            context: input.context,
            status: input.status,
            created_at: now_millis(),
        };
        messages.push(message.clone());
        write_json(&path, &messages).await?;
        Ok(message)
    }

    pub async fn submit_turn(
        &self,
        project_id: &str,
        request: AgentTurnRequest,
        priority: bool,
    ) -> Result<QueuedTurn, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let queue_path = directory.join("queue.json");
        let message_path = directory.join("messages.json");
        let project_path = directory.join("project.json");
        let mut queue: Vec<QueuedTurn> = read_json_or_default(&queue_path).await?;
        let mut messages: Vec<AgentMessage> = read_json_or_default(&message_path).await?;
        let mut project: AgentProjectRecord = read_json(&project_path).await?;
        let turn = QueuedTurn {
            id: Uuid::new_v4().to_string(),
            text: request.text.trim().to_owned(),
            attachments: request.attachments,
            context: request.context,
            model: request.model,
            reasoning_effort: request.reasoning_effort,
            created_at: now_millis(),
        };
        let message = AgentMessage {
            id: Uuid::new_v4().to_string(),
            turn_id: Some(turn.id.clone()),
            role: "user".to_owned(),
            text: turn.text.clone(),
            attachments: turn.attachments.clone(),
            context: turn.context.clone(),
            status: "queued".to_owned(),
            created_at: turn.created_at,
        };
        if priority {
            queue.insert(0, turn.clone());
        } else {
            queue.push(turn.clone());
        }
        messages.push(message);
        project.queue_depth = queue.len();
        project.queue_paused = false;
        project.updated_at = now_millis();
        write_json(&queue_path, &queue).await?;
        write_json(&message_path, &messages).await?;
        write_json(&project_path, &project).await?;
        Ok(turn)
    }

    pub async fn claim_next(&self, project_id: &str) -> Result<Option<QueuedTurn>, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let queue_path = directory.join("queue.json");
        let message_path = directory.join("messages.json");
        let project_path = directory.join("project.json");
        let mut project: AgentProjectRecord = read_json(&project_path).await?;
        if project.queue_paused {
            return Ok(None);
        }
        let mut queue: Vec<QueuedTurn> = read_json_or_default(&queue_path).await?;
        let next = (!queue.is_empty()).then(|| queue.remove(0));
        let mut messages: Vec<AgentMessage> = read_json_or_default(&message_path).await?;
        if let Some(turn) = &next {
            if let Some(message) = messages
                .iter_mut()
                .find(|message| message.turn_id.as_deref() == Some(turn.id.as_str()))
            {
                message.status = "running".to_owned();
            }
            project.active_turn_id = Some(turn.id.clone());
            project.status = "running".to_owned();
            project.status_label = "Codex 正在执行".to_owned();
        }
        project.queue_depth = queue.len();
        project.updated_at = now_millis();
        write_json(&queue_path, &queue).await?;
        write_json(&message_path, &messages).await?;
        write_json(&project_path, &project).await?;
        Ok(next)
    }

    pub async fn remove_queued(&self, project_id: &str, turn_id: &str) -> Result<(), String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let path = directory.join("queue.json");
        let message_path = directory.join("messages.json");
        let mut queue: Vec<QueuedTurn> = read_json_or_default(&path).await?;
        queue.retain(|turn| turn.id != turn_id);
        let mut messages: Vec<AgentMessage> = read_json_or_default(&message_path).await?;
        if let Some(message) = messages
            .iter_mut()
            .find(|message| message.turn_id.as_deref() == Some(turn_id))
        {
            message.status = "cancelled".to_owned();
        }
        write_json(&path, &queue).await?;
        write_json(&message_path, &messages).await?;
        let project_path = directory.join("project.json");
        let mut project: AgentProjectRecord = read_json(&project_path).await?;
        project.queue_depth = queue.len();
        project.updated_at = now_millis();
        write_json(&project_path, &project).await
    }

    pub async fn set_queue_paused(
        &self,
        project_id: &str,
        paused: bool,
    ) -> Result<AgentProjectRecord, String> {
        self.update_project(project_id, |record| {
            record.queue_paused = paused;
            if paused {
                record.status = "interrupted".to_owned();
                record.status_label = "当前任务已停止，队列已暂停".to_owned();
            } else if record.active_turn_id.is_none() {
                record.status = "idle".to_owned();
                record.status_label = "等待处理队列".to_owned();
            }
        })
        .await
    }

    pub async fn requeue_front(
        &self,
        project_id: &str,
        turn: QueuedTurn,
        label: String,
    ) -> Result<(), String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let queue_path = directory.join("queue.json");
        let message_path = directory.join("messages.json");
        let project_path = directory.join("project.json");
        let mut queue: Vec<QueuedTurn> = read_json_or_default(&queue_path).await?;
        if !queue.iter().any(|queued| queued.id == turn.id) {
            queue.insert(0, turn.clone());
        }
        let mut messages: Vec<AgentMessage> = read_json_or_default(&message_path).await?;
        if let Some(message) = messages
            .iter_mut()
            .find(|message| message.turn_id.as_deref() == Some(turn.id.as_str()))
        {
            message.status = "queued".to_owned();
        }
        let mut project: AgentProjectRecord = read_json(&project_path).await?;
        project.active_turn_id = None;
        project.queue_depth = queue.len();
        project.queue_paused = true;
        project.status = "failed".to_owned();
        project.status_label = label;
        project.updated_at = now_millis();
        write_json(&queue_path, &queue).await?;
        write_json(&message_path, &messages).await?;
        write_json(&project_path, &project).await
    }

    pub async fn update_message_status(
        &self,
        project_id: &str,
        turn_id: &str,
        status: &str,
    ) -> Result<(), String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(project_id)?.join("messages.json");
        let mut messages: Vec<AgentMessage> = read_json_or_default(&path).await?;
        if let Some(message) = messages
            .iter_mut()
            .find(|message| message.turn_id.as_deref() == Some(turn_id))
        {
            message.status = status.to_owned();
        }
        write_json(&path, &messages).await
    }

    pub async fn media(&self, project_id: &str) -> Result<AgentMedia, String> {
        let directory = self.project_dir(project_id)?;
        let _: AgentProjectRecord = read_json(&directory.join("project.json")).await?;
        Ok(AgentMedia {
            scenes: read_json_or_default(&directory.join("scenes.json")).await?,
            assets: read_json_or_default(&directory.join("assets.json")).await?,
        })
    }

    pub async fn append_media_asset(
        &self,
        project_id: &str,
        asset: MediaAsset,
    ) -> Result<MediaAsset, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(project_id)?.join("assets.json");
        let mut assets: Vec<MediaAsset> = read_json_or_default(&path).await?;
        if let Some(provider_id) = asset.provider_id.as_deref()
            && let Some(existing) = assets
                .iter()
                .find(|item| item.provider_id.as_deref() == Some(provider_id))
        {
            return Ok(existing.clone());
        }
        assets.push(asset.clone());
        write_json(&path, &assets).await?;
        Ok(asset)
    }

    pub async fn patch_scene_assets(
        &self,
        project_id: &str,
        scene_id: &str,
        asset_ids: Vec<String>,
    ) -> Result<MediaScene, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let scene_path = directory.join("scenes.json");
        let assets: Vec<MediaAsset> = read_json_or_default(&directory.join("assets.json")).await?;
        if let Some(unknown) = asset_ids
            .iter()
            .find(|id| !assets.iter().any(|asset| &asset.id == *id))
        {
            return Err(format!("unknown asset id: {unknown}"));
        }
        let mut scenes: Vec<MediaScene> = read_json_or_default(&scene_path).await?;
        let scene = scenes
            .iter_mut()
            .find(|scene| scene.id == scene_id)
            .ok_or_else(|| format!("unknown scene id: {scene_id}"))?;
        scene.asset_ids = asset_ids;
        let updated = scene.clone();
        write_json(&scene_path, &scenes).await?;
        Ok(updated)
    }

    pub async fn append_event(
        &self,
        project_id: &str,
        turn_id: Option<String>,
        method: String,
        payload: Value,
    ) -> Result<AgentEvent, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let mut sequences = self.sequences.lock().await;
        let seq = if let Some(value) = sequences.get_mut(project_id) {
            *value += 1;
            *value
        } else {
            let count = self
                .read_events_unlocked(project_id, 0)
                .await?
                .last()
                .map_or(0, |event| event.seq)
                + 1;
            sequences.insert(project_id.to_owned(), count);
            count
        };
        drop(sequences);
        let event = AgentEvent {
            seq,
            project_id: project_id.to_owned(),
            turn_id,
            method,
            payload,
            created_at: now_millis(),
        };
        let directory = self.project_dir(project_id)?;
        let event_path = directory.join("events.jsonl");
        let offset = fs::metadata(&event_path)
            .await
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&event_path)
            .await
            .map_err(|error| error.to_string())?;
        let mut bytes = serde_json::to_vec(&event).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        file.write_all(&bytes)
            .await
            .map_err(|error| error.to_string())?;
        if seq == 1 || (seq - 1) % 256 == 0 {
            let index_path = directory.join(".yingya/events.idx");
            let mut index: EventIndex = read_json_or_default(&index_path).await?;
            index.latest_seq = seq;
            index.checkpoints.push(EventIndexEntry { seq, offset });
            write_json(&index_path, &index).await?;
        }
        Ok(event)
    }

    pub async fn event_cursor(&self, project_id: &str) -> Result<u64, String> {
        if let Some(value) = self.sequences.lock().await.get(project_id).copied() {
            return Ok(value);
        }
        self.rebuild_event_index(project_id).await
    }

    pub async fn read_event_page(
        &self,
        project_id: &str,
        before: Option<u64>,
        limit: usize,
    ) -> Result<AgentEventPage, String> {
        let limit = limit.clamp(1, 500);
        let latest_seq = self.event_cursor(project_id).await?;
        let before = before.unwrap_or(latest_seq.saturating_add(1));
        let target = before.saturating_sub(limit as u64 + 256);
        let directory = self.project_dir(project_id)?;
        let index: EventIndex = read_json_or_default(&directory.join(".yingya/events.idx")).await?;
        let offset = index
            .checkpoints
            .iter()
            .rev()
            .find(|entry| entry.seq <= target)
            .map_or(0, |entry| entry.offset);
        let mut file = match fs::File::open(directory.join("events.jsonl")).await {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(AgentEventPage {
                    items: vec![],
                    next_before: None,
                    latest_seq,
                    has_more: false,
                });
            }
            Err(error) => return Err(error.to_string()),
        };
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| error.to_string())?;
        let mut lines = BufReader::new(file).lines();
        let mut items = Vec::new();
        while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
            let Ok(event) = serde_json::from_str::<AgentEvent>(&line) else {
                continue;
            };
            if event.seq >= before {
                break;
            }
            items.push(event);
            if items.len() > limit {
                items.remove(0);
            }
        }
        let has_more = items.first().is_some_and(|event| event.seq > 1);
        let next_before = has_more.then(|| items[0].seq);
        Ok(AgentEventPage {
            items,
            next_before,
            latest_seq,
            has_more,
        })
    }

    pub async fn read_events_after_limited(
        &self,
        project_id: &str,
        after: u64,
        limit: usize,
    ) -> Result<(Vec<AgentEvent>, bool, u64), String> {
        let latest_seq = self.event_cursor(project_id).await?;
        let directory = self.project_dir(project_id)?;
        let index: EventIndex = read_json_or_default(&directory.join(".yingya/events.idx")).await?;
        let offset = index
            .checkpoints
            .iter()
            .rev()
            .find(|entry| entry.seq <= after.saturating_add(1))
            .map_or(0, |entry| entry.offset);
        let mut file = match fs::File::open(directory.join("events.jsonl")).await {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok((vec![], false, latest_seq));
            }
            Err(error) => return Err(error.to_string()),
        };
        file.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| error.to_string())?;
        let mut lines = BufReader::new(file).lines();
        let mut events = Vec::new();
        while let Some(line) = lines.next_line().await.map_err(|error| error.to_string())? {
            let Ok(event) = serde_json::from_str::<AgentEvent>(&line) else {
                continue;
            };
            if event.seq <= after {
                continue;
            }
            events.push(event);
            if events.len() > limit {
                break;
            }
        }
        let overflow = events.len() > limit;
        events.truncate(limit);
        Ok((events, overflow, latest_seq))
    }

    pub async fn read_events(
        &self,
        project_id: &str,
        after: u64,
    ) -> Result<Vec<AgentEvent>, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        self.read_events_unlocked(project_id, after).await
    }

    async fn read_events_unlocked(
        &self,
        project_id: &str,
        after: u64,
    ) -> Result<Vec<AgentEvent>, String> {
        let path = self.project_dir(project_id)?.join("events.jsonl");
        let content = match fs::read_to_string(path).await {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(error) => return Err(error.to_string()),
        };
        Ok(content
            .lines()
            .filter_map(|line| serde_json::from_str::<AgentEvent>(line).ok())
            .filter(|event| event.seq > after)
            .collect())
    }

    pub async fn recover_interrupted(&self) -> Result<(), String> {
        for project in self.list().await? {
            if project.active_turn_id.is_some() || project.status == "running" {
                if let Some(turn_id) = project.active_turn_id.as_deref() {
                    self.update_message_status(&project.id, turn_id, "interrupted")
                        .await?;
                }
                self.update_project(&project.id, |record| {
                    record.active_turn_id = None;
                    record.queue_paused = true;
                    record.status = "interrupted".to_owned();
                    record.status_label = "上次运行被中断，队列已暂停".to_owned();
                })
                .await?;
                let mut manifest = self.manifest(&project.id).await?;
                manifest.dirty = true;
                self.write_manifest(&project.id, &manifest).await?;
            }
        }
        Ok(())
    }

    async fn rebuild_event_indexes(&self) -> Result<(), String> {
        for project in self.list().await? {
            self.rebuild_event_index(&project.id).await?;
        }
        Ok(())
    }

    async fn rebuild_event_index(&self, project_id: &str) -> Result<u64, String> {
        let directory = self.project_dir(project_id)?;
        let path = directory.join("events.jsonl");
        let bytes = match fs::read(&path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.to_string()),
        };
        let mut index = EventIndex::default();
        let mut offset = 0_u64;
        for line in bytes.split_inclusive(|byte| *byte == b'\n') {
            if let Ok(event) =
                serde_json::from_slice::<AgentEvent>(line.strip_suffix(b"\n").unwrap_or(line))
            {
                index.latest_seq = index.latest_seq.max(event.seq);
                if event.seq == 1 || (event.seq - 1) % 256 == 0 {
                    index.checkpoints.push(EventIndexEntry {
                        seq: event.seq,
                        offset,
                    });
                }
            }
            offset += line.len() as u64;
        }
        write_json(&directory.join(".yingya/events.idx"), &index).await?;
        self.sequences
            .lock()
            .await
            .insert(project_id.to_owned(), index.latest_seq);
        Ok(index.latest_seq)
    }

    pub fn resolve_relative(&self, project_id: &str, relative: &str) -> Result<PathBuf, String> {
        let path = Path::new(relative);
        if path.is_absolute()
            || path
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err("invalid project path".to_owned());
        }
        Ok(self.project_dir(project_id)?.join(path))
    }
}

impl Default for AgentManifest {
    fn default() -> Self {
        Self {
            schema_version: 1,
            phase: "briefing".to_owned(),
            dirty: false,
            checkpoint: None,
            output_spec: Value::Object(Default::default()),
            artifacts: vec![],
            versions: vec![],
            current_draft: None,
            studio_entry: default_studio_entry(),
        }
    }
}

fn default_aspect() -> String {
    "9:16".to_owned()
}
fn default_model() -> String {
    "gpt-5.6-terra".to_owned()
}
fn default_effort() -> String {
    "high".to_owned()
}
fn default_voice() -> String {
    "default".to_owned()
}
fn default_studio_entry() -> String {
    "index.html".to_owned()
}
fn derive_legacy_title(prompt: &str) -> String {
    prompt
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(24)
        .collect()
}

fn derive_title(prompt: &str) -> String {
    let compact = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    let video_type = if compact.contains("演示") {
        "演示视频"
    } else if compact.contains("宣传") {
        "宣传视频"
    } else if compact.contains("发布") {
        "发布视频"
    } else if compact.contains("教程") {
        "教程视频"
    } else if compact.contains("科普") || compact.contains("解释") {
        "科普视频"
    } else if compact.contains("介绍") {
        "介绍视频"
    } else {
        "视频"
    };

    let subject = ["来说明一下", "说明一下", "介绍一下", "关于"]
        .iter()
        .find_map(|marker| {
            compact
                .rsplit_once(marker)
                .map(|(_, value)| clean_subject(value))
        })
        .filter(|value| !value.is_empty())
        .or_else(|| {
            [
                "的宣传视频",
                "的演示视频",
                "的发布视频",
                "的教程视频",
                "的科普视频",
                "的介绍视频",
                "的视频",
            ]
            .iter()
            .find_map(|marker| {
                compact
                    .find(marker)
                    .map(|index| clean_subject(&compact[..index]))
            })
            .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| clean_subject(&compact));

    let subject = title_case_ascii_words(&subject);
    let title = if subject.is_empty() {
        video_type.to_owned()
    } else if subject
        .chars()
        .last()
        .is_some_and(|character| character.is_ascii_alphanumeric())
    {
        format!("{subject} {video_type}")
    } else {
        format!("{subject}{video_type}")
    };
    title.chars().take(24).collect()
}

fn clean_subject(value: &str) -> String {
    let value = value
        .split(['，', '。', '！', '？', ',', '.', '!', '?', '；', ';', '\n'])
        .next()
        .unwrap_or(value)
        .trim();
    let mut subject = value;
    for prefix in [
        "请帮我做一个",
        "请帮我制作一个",
        "帮我做一个",
        "帮我制作一个",
        "做一个",
        "制作一个",
        "创建一个",
        "生成一个",
        "做一支",
        "制作一支",
        "创建一支",
        "生成一支",
        "一个",
        "一支",
    ] {
        if let Some(rest) = subject.strip_prefix(prefix) {
            subject = rest.trim();
            break;
        }
    }
    for prefix in ["简单的", "简单", "关于", "用于"] {
        if let Some(rest) = subject.strip_prefix(prefix) {
            subject = rest.trim();
        }
    }
    for suffix in [
        "给我看一下",
        "给我看看",
        "给我看",
        "给我",
        "吧",
        "好吗",
        "可以吗",
    ] {
        if let Some(rest) = subject.strip_suffix(suffix) {
            subject = rest.trim();
            break;
        }
    }
    for suffix in [
        "的宣传视频",
        "宣传视频",
        "的演示视频",
        "演示视频",
        "的发布视频",
        "发布视频",
        "的教程视频",
        "教程视频",
        "的科普短片",
        "科普短片",
        "的科普视频",
        "科普视频",
        "的介绍视频",
        "介绍视频",
        "的视频",
        "视频",
        "的短片",
        "短片",
    ] {
        if let Some(rest) = subject.strip_suffix(suffix) {
            subject = rest.trim();
            break;
        }
    }
    subject
        .trim_matches(|character: char| {
            character.is_whitespace() || "的：:，。！？,.!?".contains(character)
        })
        .chars()
        .take(16)
        .collect()
}

fn title_case_ascii_words(value: &str) -> String {
    value
        .split(' ')
        .map(|word| {
            if !word.is_empty()
                && word
                    .chars()
                    .all(|character| character.is_ascii_alphabetic())
            {
                let mut characters = word.chars();
                characters
                    .next()
                    .map(|first| first.to_ascii_uppercase().to_string() + characters.as_str())
                    .unwrap_or_default()
            } else {
                word.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn deserialize_timestamp<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Timestamp {
        Millis(u64),
        Text(String),
    }
    Ok(match Timestamp::deserialize(deserializer)? {
        Timestamp::Millis(value) => value,
        Timestamp::Text(value) => value.parse().unwrap_or_default(),
    })
}

async fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).await.map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

async fn read_json_or_default<T: for<'de> Deserialize<'de> + Default>(
    path: &Path,
) -> Result<T, String> {
    match fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.to_string()),
    }
}

async fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, bytes)
        .await
        .map_err(|error| error.to_string())?;
    fs::rename(&temporary, path)
        .await
        .map_err(|error| error.to_string())
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
            voice_id: "default".to_owned(),
        }
    }

    fn turn(text: &str) -> AgentTurnRequest {
        AgentTurnRequest {
            text: text.to_owned(),
            attachments: vec![],
            context: vec![],
            model: None,
            reasoning_effort: None,
            interrupt: false,
        }
    }

    #[tokio::test]
    async fn concurrent_submissions_are_not_lost_and_priority_goes_first() {
        let root = std::env::temp_dir().join(format!("yingya-queue-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let project = store.create(&request()).await.expect("create project");
        let mut tasks = Vec::new();
        for index in 0..100 {
            let store = store.clone();
            let project_id = project.id.clone();
            tasks.push(tokio::spawn(async move {
                store
                    .submit_turn(&project_id, turn(&format!("message-{index}")), false)
                    .await
            }));
        }
        for task in tasks {
            task.await.expect("submit task").expect("submit turn");
        }
        let priority = store
            .submit_turn(&project.id, turn("priority"), true)
            .await
            .expect("priority turn");
        let detail = store.get(&project.id).await.expect("project detail");
        assert_eq!(detail.queue.len(), 101);
        assert_eq!(detail.messages.len(), 101);
        assert_eq!(
            store
                .claim_next(&project.id)
                .await
                .expect("claim")
                .expect("turn")
                .id,
            priority.id
        );
        fs::remove_dir_all(root).await.expect("clean queue store");
    }

    #[tokio::test]
    async fn event_pages_use_cursor_without_embedding_events_in_project_detail() {
        let root = std::env::temp_dir().join(format!("yingya-event-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let project = store.create(&request()).await.expect("create project");
        for index in 0..1_025_u64 {
            store
                .append_event(
                    &project.id,
                    None,
                    "test/event".to_owned(),
                    serde_json::json!({ "index": index }),
                )
                .await
                .expect("append event");
        }
        let detail = store.get(&project.id).await.expect("detail");
        assert_eq!(detail.event_cursor, 1_025);
        let serialized = serde_json::to_value(&detail).expect("serialize detail");
        assert!(serialized.get("events").is_none());
        let page = store
            .read_event_page(&project.id, None, 200)
            .await
            .expect("event page");
        assert_eq!(page.items.len(), 200);
        assert_eq!(page.items.first().map(|event| event.seq), Some(826));
        assert_eq!(page.latest_seq, 1_025);
        assert!(page.has_more);
        fs::remove_dir_all(root).await.expect("clean event store");
    }

    #[tokio::test]
    async fn fresh_projects_have_an_empty_event_page_and_can_start_sse() {
        let root = std::env::temp_dir().join(format!("yingya-empty-event-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let project = store.create(&request()).await.expect("create project");
        let page = store
            .read_event_page(&project.id, None, 500)
            .await
            .expect("empty page");
        assert!(page.items.is_empty());
        assert_eq!(page.latest_seq, 0);
        let (events, overflow, latest) = store
            .read_events_after_limited(&project.id, 0, 1_000)
            .await
            .expect("empty SSE history");
        assert!(events.is_empty());
        assert!(!overflow);
        assert_eq!(latest, 0);
        fs::remove_dir_all(root)
            .await
            .expect("clean empty event store");
    }

    #[tokio::test]
    async fn project_paths_reject_absolute_and_parent_components() {
        let root = std::env::temp_dir().join(format!("yingya-path-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let project = store.create(&request()).await.expect("create project");

        assert!(
            store
                .resolve_relative(&project.id, "../outside.mp4")
                .is_err()
        );
        assert!(
            store
                .resolve_relative(&project.id, "/tmp/outside.mp4")
                .is_err()
        );
        assert_eq!(
            store
                .resolve_relative(&project.id, ".yingya/exports/video.mp4")
                .expect("safe project path"),
            store
                .project_dir(&project.id)
                .expect("project directory")
                .join(".yingya/exports/video.mp4")
        );
        fs::remove_dir_all(root).await.expect("clean path store");
    }

    #[tokio::test]
    async fn paused_queue_requires_resume_and_preserves_fifo_order() {
        let root = std::env::temp_dir().join(format!("yingya-pause-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let project = store.create(&request()).await.expect("create project");
        let first = store
            .submit_turn(&project.id, turn("first"), false)
            .await
            .expect("first turn");
        let second = store
            .submit_turn(&project.id, turn("second"), false)
            .await
            .expect("second turn");
        store
            .set_queue_paused(&project.id, true)
            .await
            .expect("pause queue");
        assert!(
            store
                .claim_next(&project.id)
                .await
                .expect("paused claim")
                .is_none()
        );
        store
            .set_queue_paused(&project.id, false)
            .await
            .expect("resume queue");
        assert_eq!(
            store
                .claim_next(&project.id)
                .await
                .expect("first claim")
                .expect("first item")
                .id,
            first.id
        );
        store
            .update_project(&project.id, |record| record.active_turn_id = None)
            .await
            .expect("clear first");
        assert_eq!(
            store
                .claim_next(&project.id)
                .await
                .expect("second claim")
                .expect("second item")
                .id,
            second.id
        );
        fs::remove_dir_all(root)
            .await
            .expect("clean paused queue store");
    }

    #[tokio::test]
    async fn media_import_is_idempotent_and_scene_assets_are_validated() {
        let root = std::env::temp_dir().join(format!("yingya-media-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let project = store.create(&request()).await.expect("create project");
        let directory = store.project_dir(&project.id).expect("project directory");
        write_json(
            &directory.join("scenes.json"),
            &[MediaScene {
                id: "scene-1".to_owned(),
                order: 1,
                narrative_role: "opening".to_owned(),
                asset_ids: vec![],
                extra: serde_json::Map::new(),
            }],
        )
        .await
        .expect("write scenes");
        let asset = MediaAsset {
            id: "asset-1".to_owned(),
            name: "soft pulse".to_owned(),
            url: format!(
                "/api/agent-projects/{}/files/assets/audio/pulse.mp3",
                project.id
            ),
            hyperframes_path: "assets/audio/pulse.mp3".to_owned(),
            kind: "audio".to_owned(),
            source: "heygen".to_owned(),
            media_type: Some("music".to_owned()),
            duration_seconds: Some(12.0),
            provider_id: Some("provider-1".to_owned()),
            description: Some("background".to_owned()),
            created_at: now_millis(),
        };
        let first = store
            .append_media_asset(&project.id, asset.clone())
            .await
            .expect("first import");
        let mut duplicate = asset;
        duplicate.id = "asset-duplicate".to_owned();
        let imported = store
            .append_media_asset(&project.id, duplicate)
            .await
            .expect("duplicate import");
        assert_eq!(imported.id, first.id);
        assert_eq!(
            store.media(&project.id).await.expect("media").assets.len(),
            1
        );
        assert!(
            store
                .patch_scene_assets(&project.id, "scene-1", vec!["unknown".to_owned()])
                .await
                .is_err()
        );
        let scene = store
            .patch_scene_assets(&project.id, "scene-1", vec![first.id.clone()])
            .await
            .expect("bind scene");
        assert_eq!(scene.asset_ids, vec![first.id]);
        fs::remove_dir_all(root).await.expect("clean media store");
    }

    #[tokio::test]
    async fn deletes_idle_projects_and_preserves_running_projects() {
        let root = std::env::temp_dir().join(format!("yingya-delete-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let idle = store.create(&request()).await.expect("create idle project");
        store.delete(&idle.id).await.expect("delete idle project");
        assert!(!store.project_dir(&idle.id).expect("idle path").exists());

        let running = store
            .create(&request())
            .await
            .expect("create running project");
        store
            .update_project(&running.id, |project| {
                project.active_turn_id = Some("turn-1".to_owned())
            })
            .await
            .expect("mark running");
        assert!(store.delete(&running.id).await.is_err());
        assert!(
            store
                .project_dir(&running.id)
                .expect("running path")
                .exists()
        );
        fs::remove_dir_all(root).await.expect("clean test store");
    }

    #[test]
    fn summarizes_project_titles_by_subject_and_video_type() {
        assert_eq!(
            derive_title("做一个简单的演示视频， 来说明一下 viaim"),
            "Viaim 演示视频"
        );
        assert_eq!(
            derive_title("做一个 claude code 的宣传视频，30 秒"),
            "Claude Code 宣传视频"
        );
        assert_eq!(
            derive_title("请帮我制作一个关于量子纠缠的科普短片"),
            "量子纠缠科普视频"
        );
        assert_eq!(
            derive_title("生成一个关于斜面摩擦受力分析的视频给我"),
            "斜面摩擦受力分析视频"
        );
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
        }))
        .expect("parse agent manifest");
        let version = &manifest.versions[0];
        assert_eq!(version.id, "draft-1");
        assert_eq!(version.created_at, 0);
        assert_eq!(
            version.report_path.as_deref(),
            Some(".yingya/quality/draft-1.json")
        );
    }

    #[tokio::test]
    async fn project_voice_is_persisted_for_the_video_agent() {
        let root = std::env::temp_dir().join(format!("yingya-voice-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let project = store.create(&request()).await.expect("create project");
        let updated = store
            .update_voice(&project.id, "warm-narrator".to_owned())
            .await
            .expect("update voice");
        assert_eq!(updated.voice_id, "warm-narrator");
        let config: Value = read_json(
            &store
                .project_dir(&project.id)
                .expect("project path")
                .join(".yingya/voice.json"),
        )
        .await
        .expect("read voice config");
        assert_eq!(config["provider"], "voxcpm2");
        assert_eq!(config["voiceId"], "warm-narrator");
        fs::remove_dir_all(root).await.expect("clean voice store");
    }

    #[tokio::test]
    async fn migrates_titles_created_by_the_legacy_truncation_rule() {
        let root = std::env::temp_dir().join(format!("yingya-title-test-{}", Uuid::new_v4()));
        let store = AgentProjectStore::new(root.clone())
            .await
            .expect("create store");
        let prompt = "做一个简单的演示视频， 来说明一下 viaim";
        let mut input = request();
        input.prompt = prompt.to_owned();
        let project = store.create(&input).await.expect("create project");
        store
            .append_message(
                &project.id,
                AppendAgentMessage {
                    turn_id: None,
                    role: "user".to_owned(),
                    text: prompt.to_owned(),
                    attachments: vec![],
                    context: vec![],
                    status: "completed".to_owned(),
                },
            )
            .await
            .expect("append prompt");
        store
            .update_project(&project.id, |record| {
                record.title = derive_legacy_title(prompt)
            })
            .await
            .expect("seed legacy title");

        let awkward_prompt = "生成一个关于斜面摩擦受力分析的视频给我";
        let mut awkward_input = request();
        awkward_input.prompt = awkward_prompt.to_owned();
        let awkward_project = store
            .create(&awkward_input)
            .await
            .expect("create awkward-title project");
        store
            .append_message(
                &awkward_project.id,
                AppendAgentMessage {
                    turn_id: None,
                    role: "user".to_owned(),
                    text: awkward_prompt.to_owned(),
                    attachments: vec![],
                    context: vec![],
                    status: "completed".to_owned(),
                },
            )
            .await
            .expect("append awkward prompt");
        store
            .update_project(&awkward_project.id, |record| {
                record.title = "斜面摩擦受力分析的视频给我 视频".to_owned()
            })
            .await
            .expect("seed awkward generated title");
        drop(store);

        let migrated = AgentProjectStore::new(root.clone())
            .await
            .expect("reopen store");
        assert_eq!(
            migrated
                .read_project(&project.id)
                .await
                .expect("read migrated project")
                .title,
            "Viaim 演示视频"
        );
        assert_eq!(
            migrated
                .read_project(&awkward_project.id)
                .await
                .expect("read migrated awkward title")
                .title,
            "斜面摩擦受力分析视频"
        );
        fs::remove_dir_all(root).await.expect("clean test store");
    }
}
