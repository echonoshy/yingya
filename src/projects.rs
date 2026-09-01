use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt, sync::Mutex};
use uuid::Uuid;

#[derive(Clone)]
pub struct ProjectStore {
    root: Arc<PathBuf>,
    locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub title: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub source_text: String,
    #[serde(default = "default_aspect")]
    pub aspect_ratio: String,
    #[serde(default = "default_duration")]
    pub duration_seconds: u32,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchSceneRequest {
    pub narrative_role: Option<String>,
    pub narration: Option<String>,
    pub visual_direction: Option<String>,
    pub duration_seconds: Option<f32>,
    pub asset_strategy: Option<String>,
    pub motion_blueprint: Option<String>,
    pub transition: Option<String>,
    pub asset_ids: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActionRequest {
    pub action: String,
    #[serde(default)]
    pub instruction: String,
    #[serde(default)]
    pub scene_ids: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRequest {
    pub text: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub source_text: String,
    pub workflow: String,
    pub status: String,
    pub status_label: String,
    pub aspect_ratio: String,
    pub duration_seconds: u32,
    pub language: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: String,
    pub thread_id: Option<String>,
    pub active_job_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub job_step: Option<String>,
    pub current_view: String,
    pub progress: u8,
    pub last_error: Option<String>,
    pub draft_url: Option<String>,
    pub final_url: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneRecord {
    pub id: String,
    pub order: usize,
    pub narrative_role: String,
    pub narration: String,
    pub visual_direction: String,
    pub duration_seconds: f32,
    pub asset_strategy: String,
    pub motion_blueprint: String,
    pub caption_mode: String,
    pub transition: String,
    pub status: String,
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub asset_ids: Vec<String>,
    pub version: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub id: String,
    pub role: String,
    pub text: String,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRecord {
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
pub struct ProjectDetail {
    #[serde(flatten)]
    pub project: ProjectRecord,
    pub scenes: Vec<SceneRecord>,
    pub messages: Vec<MessageRecord>,
    pub assets: Vec<AssetRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub id: String,
    pub project_id: String,
    pub action: String,
    pub status: String,
    pub message: String,
    pub scene_ids: Vec<String>,
    pub created_at: u64,
    pub finished_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEvent {
    pub project_id: String,
    pub job_id: Option<String>,
    pub kind: String,
    pub message: String,
    pub progress: u8,
    pub timestamp: u64,
}

fn default_aspect() -> String {
    "9:16".to_owned()
}

fn default_duration() -> u32 {
    55
}

fn default_model() -> String {
    "gpt-5.6-terra".to_owned()
}

fn default_reasoning_effort() -> String {
    "high".to_owned()
}

pub fn validate_model_settings(model: &str, reasoning_effort: &str) -> Result<(), String> {
    let model = model.trim();
    if model.is_empty() || model.len() > 100 {
        return Err("model must be between 1 and 100 characters".to_owned());
    }
    if !matches!(
        reasoning_effort,
        "auto" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
    ) {
        return Err("unsupported reasoning effort".to_owned());
    }
    Ok(())
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl ProjectStore {
    pub async fn new(root: PathBuf) -> Result<Self, std::io::Error> {
        fs::create_dir_all(&root).await?;
        Ok(Self {
            root: Arc::new(root),
            locks: Arc::new(Mutex::new(HashMap::new())),
        })
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

    pub async fn update_model_settings(
        &self,
        id: &str,
        model: Option<&str>,
        reasoning_effort: Option<&str>,
    ) -> Result<ProjectRecord, String> {
        if model.is_none() && reasoning_effort.is_none() {
            return self.read_project(id).await;
        }
        let lock = self.project_lock(id).await?;
        let _guard = lock.lock().await;
        let mut project = self.read_project(id).await?;
        let next_model = model.unwrap_or(&project.model);
        let next_effort = reasoning_effort.unwrap_or(&project.reasoning_effort);
        validate_model_settings(next_model, next_effort)?;
        project.model = next_model.to_owned();
        project.reasoning_effort = next_effort.to_owned();
        project.updated_at = now();
        write_json(&self.project_dir(id)?.join("project.json"), &project).await?;
        Ok(project)
    }

    pub async fn create(&self, request: CreateProjectRequest) -> Result<ProjectDetail, String> {
        let prompt = request.prompt.trim();
        if prompt.is_empty() {
            return Err("prompt cannot be empty".to_owned());
        }
        if !(10..=180).contains(&request.duration_seconds) {
            return Err("durationSeconds must be between 10 and 180".to_owned());
        }
        if !matches!(request.aspect_ratio.as_str(), "9:16" | "16:9" | "1:1") {
            return Err("aspectRatio must be 9:16, 16:9, or 1:1".to_owned());
        }
        validate_model_settings(&request.model, &request.reasoning_effort)?;

        let id = Uuid::new_v4().to_string();
        let directory = self.project_dir(&id)?;
        fs::create_dir_all(directory.join("assets/uploads"))
            .await
            .map_err(|error| error.to_string())?;
        fs::create_dir_all(directory.join("assets/generated"))
            .await
            .map_err(|error| error.to_string())?;
        fs::create_dir_all(directory.join("artifacts"))
            .await
            .map_err(|error| error.to_string())?;
        fs::create_dir_all(directory.join("compositions"))
            .await
            .map_err(|error| error.to_string())?;

        let timestamp = now();
        let title = request
            .title
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| derive_title(prompt));
        let project = ProjectRecord {
            id: id.clone(),
            title,
            prompt: prompt.to_owned(),
            source_text: request.source_text,
            workflow: "faceless-explainer".to_owned(),
            status: "discovery".to_owned(),
            status_label: "正在和导演讨论".to_owned(),
            aspect_ratio: request.aspect_ratio,
            duration_seconds: request.duration_seconds,
            language: "中文（普通话）".to_owned(),
            model: request.model,
            reasoning_effort: request.reasoning_effort,
            thread_id: None,
            active_job_id: None,
            job_step: None,
            current_view: "conversation".to_owned(),
            progress: 4,
            last_error: None,
            draft_url: None,
            final_url: None,
            created_at: timestamp,
            updated_at: timestamp,
        };
        let scenes = Vec::new();
        let messages = vec![MessageRecord {
            id: Uuid::new_v4().to_string(),
            role: "user".to_owned(),
            text: prompt.to_owned(),
            created_at: timestamp,
        }];
        let assets = Vec::new();
        self.write_project(&project).await?;
        self.write_scenes(&id, &scenes).await?;
        write_json(&directory.join("messages.json"), &messages).await?;
        write_json(&directory.join("assets.json"), &assets).await?;
        Ok(ProjectDetail {
            project,
            scenes,
            messages,
            assets,
        })
    }

    pub async fn list(&self) -> Result<Vec<ProjectRecord>, String> {
        let mut entries = fs::read_dir(self.root.as_ref())
            .await
            .map_err(|error| error.to_string())?;
        let mut projects = Vec::new();
        while let Some(entry) = entries
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
            let path = entry.path().join("project.json");
            if let Ok(bytes) = fs::read(&path).await
                && let Ok(project) = serde_json::from_slice::<ProjectRecord>(&bytes)
            {
                projects.push(project);
            }
        }
        projects.sort_by_key(|project| std::cmp::Reverse(project.updated_at));
        Ok(projects)
    }

    pub async fn recover_interrupted(&self) -> Result<(), String> {
        for project in self.list().await? {
            if matches!(
                project.status.as_str(),
                "planning" | "drafting" | "building" | "revising" | "retrying" | "finalizing"
            ) {
                self.update_project(&project.id, |record| {
                    record.status = "failed".to_owned();
                    record.status_label = "上次任务被中断，可安全重试".to_owned();
                    record.last_error = Some("本地服务重启时任务仍在运行".to_owned());
                    record.active_job_id = None;
                    record.job_step = None;
                })
                .await?;
            } else if project.active_job_id.is_some() || project.job_step.is_some() {
                self.update_project(&project.id, |record| {
                    record.active_job_id = None;
                    record.job_step = None;
                })
                .await?;
            }
        }
        Ok(())
    }

    pub async fn get(&self, id: &str) -> Result<ProjectDetail, String> {
        let project = self.read_project(id).await?;
        let scenes = self.read_scenes(id).await?;
        let messages = self.read_messages(id).await?;
        let assets = self.read_assets(id).await?;
        Ok(ProjectDetail {
            project,
            scenes,
            messages,
            assets,
        })
    }

    pub async fn read_messages(&self, id: &str) -> Result<Vec<MessageRecord>, String> {
        let path = self.project_dir(id)?.join("messages.json");
        read_json_or_default(&path).await
    }

    pub async fn read_assets(&self, id: &str) -> Result<Vec<AssetRecord>, String> {
        let path = self.project_dir(id)?.join("assets.json");
        read_json_or_default(&path).await
    }

    pub async fn append_message(
        &self,
        project_id: &str,
        role: &str,
        text: &str,
    ) -> Result<MessageRecord, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("message cannot be empty".to_owned());
        }
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let mut messages: Vec<MessageRecord> =
            read_json_or_default(&directory.join("messages.json")).await?;
        let message = MessageRecord {
            id: Uuid::new_v4().to_string(),
            role: role.to_owned(),
            text: text.to_owned(),
            created_at: now(),
        };
        messages.push(message.clone());
        write_json(&directory.join("messages.json"), &messages).await?;
        let mut project: ProjectRecord = read_json(&directory.join("project.json")).await?;
        project.updated_at = now();
        write_json(&directory.join("project.json"), &project).await?;
        Ok(message)
    }

    pub async fn append_asset(&self, project_id: &str, asset: AssetRecord) -> Result<(), String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(project_id)?.join("assets.json");
        let mut assets: Vec<AssetRecord> = read_json_or_default(&path).await?;
        assets.push(asset);
        write_json(&path, &assets).await
    }

    #[cfg(test)]
    pub async fn prepare_script_draft(&self, project_id: &str) -> Result<(), String> {
        let project = self.read_project(project_id).await?;
        let mut scenes = self.read_scenes(project_id).await?;
        if scenes.is_empty() {
            scenes = seed_scenes(&project.prompt, project.duration_seconds);
            self.write_scenes(project_id, &scenes).await?;
        }
        self.write_source_files(&project, &scenes).await
    }

    pub async fn read_project(&self, id: &str) -> Result<ProjectRecord, String> {
        let path = self.project_dir(id)?.join("project.json");
        read_json(&path).await
    }

    pub async fn read_scenes(&self, id: &str) -> Result<Vec<SceneRecord>, String> {
        let path = self.project_dir(id)?.join("scenes.json");
        read_json_or_default(&path).await
    }

    pub async fn write_project(&self, project: &ProjectRecord) -> Result<(), String> {
        let lock = self.project_lock(&project.id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(&project.id)?.join("project.json");
        write_json(&path, project).await
    }

    pub async fn write_scenes(&self, id: &str, scenes: &[SceneRecord]) -> Result<(), String> {
        let lock = self.project_lock(id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(id)?.join("scenes.json");
        write_json(&path, scenes).await
    }

    pub async fn update_project<F>(&self, id: &str, update: F) -> Result<ProjectRecord, String>
    where
        F: FnOnce(&mut ProjectRecord),
    {
        let lock = self.project_lock(id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(id)?.join("project.json");
        let mut project = read_json(&path).await?;
        update(&mut project);
        project.updated_at = now();
        write_json(&path, &project).await?;
        Ok(project)
    }

    pub async fn patch_scene(
        &self,
        project_id: &str,
        scene_id: &str,
        patch: PatchSceneRequest,
    ) -> Result<ProjectDetail, String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let directory = self.project_dir(project_id)?;
        let only_asset_update = patch.asset_ids.is_some()
            && patch.narrative_role.is_none()
            && patch.narration.is_none()
            && patch.visual_direction.is_none()
            && patch.duration_seconds.is_none()
            && patch.asset_strategy.is_none()
            && patch.motion_blueprint.is_none()
            && patch.transition.is_none();
        if let Some(asset_ids) = &patch.asset_ids {
            let assets: Vec<AssetRecord> =
                read_json_or_default(&directory.join("assets.json")).await?;
            if asset_ids
                .iter()
                .any(|asset_id| !assets.iter().any(|asset| asset.id == *asset_id))
            {
                return Err("scene assetIds contains an unknown project asset".to_owned());
            }
        }
        let mut scenes: Vec<SceneRecord> =
            read_json_or_default(&directory.join("scenes.json")).await?;
        let scene = scenes
            .iter_mut()
            .find(|scene| scene.id == scene_id)
            .ok_or_else(|| "scene not found".to_owned())?;

        if let Some(value) = patch.narrative_role {
            scene.narrative_role = value;
        }
        if let Some(value) = patch.narration {
            scene.narration = value;
        }
        if let Some(value) = patch.visual_direction {
            scene.visual_direction = value;
        }
        if let Some(value) = patch.duration_seconds {
            if !(1.0..=30.0).contains(&value) {
                return Err("scene duration must be between 1 and 30 seconds".to_owned());
            }
            scene.duration_seconds = value;
        }
        if let Some(value) = patch.asset_strategy {
            scene.asset_strategy = value;
        }
        if let Some(value) = patch.motion_blueprint {
            scene.motion_blueprint = value;
        }
        if let Some(value) = patch.transition {
            scene.transition = value;
        }
        if let Some(value) = patch.asset_ids {
            scene.asset_ids = value;
        }
        scene.status = if only_asset_update {
            "approved".to_owned()
        } else {
            "dirty".to_owned()
        };
        scene.version += 1;
        write_json(&directory.join("scenes.json"), &scenes).await?;
        let mut project: ProjectRecord = read_json(&directory.join("project.json")).await?;
        if only_asset_update {
            project.status = "asset_review".to_owned();
            project.status_label = "素材匹配等待确认".to_owned();
            project.current_view = "assets".to_owned();
        } else {
            project.status = "script_review".to_owned();
            project.status_label = "剧本已修改，等待确认".to_owned();
            project.current_view = "script".to_owned();
        }
        project.draft_url = None;
        project.final_url = None;
        project.updated_at = now();
        write_json(&directory.join("project.json"), &project).await?;
        write_source_files(&directory, &project, &scenes).await?;
        let messages = read_json_or_default(&directory.join("messages.json")).await?;
        let assets = read_json_or_default(&directory.join("assets.json")).await?;
        Ok(ProjectDetail {
            project,
            scenes,
            messages,
            assets,
        })
    }

    pub async fn append_run(&self, run: &RunRecord) -> Result<(), String> {
        let lock = self.project_lock(&run.project_id).await?;
        let _guard = lock.lock().await;
        let path = self.project_dir(&run.project_id)?.join("runs.jsonl");
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .await
            .map_err(|error| error.to_string())?;
        let mut bytes = serde_json::to_vec(run).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        file.write_all(&bytes)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn write_source_files(
        &self,
        project: &ProjectRecord,
        scenes: &[SceneRecord],
    ) -> Result<(), String> {
        let directory = self.project_dir(&project.id)?;
        let lock = self.project_lock(&project.id).await?;
        let _guard = lock.lock().await;
        write_source_files(&directory, project, scenes).await
    }
}

async fn write_source_files(
    directory: &Path,
    project: &ProjectRecord,
    scenes: &[SceneRecord],
) -> Result<(), String> {
    let brief = format!(
        "# {}\n\n- Workflow: faceless-explainer\n- Message: {}\n- Aspect: {}\n- Target duration: {} seconds\n- Language: {}\n",
        project.title,
        project.prompt,
        project.aspect_ratio,
        project.duration_seconds,
        project.language
    );
    let script = scenes
        .iter()
        .map(|scene| format!("## {}\n\n{}\n", scene.narrative_role, scene.narration))
        .collect::<Vec<_>>()
        .join("\n");
    let storyboard_frames = scenes
            .iter()
            .map(|scene| {
                format!(
                    "## Scene {} — {}\n\n- Status: outline\n- Duration: {:.1}s\n- Voiceover: {}\n- Scene: {}\n- Asset: {}\n- Motion: {}\n- Transition: {}\n",
                    scene.order,
                    scene.narrative_role,
                    scene.duration_seconds,
                    scene.narration,
                    scene.visual_direction,
                    scene.asset_strategy,
                    scene.motion_blueprint,
                    scene.transition
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
    let storyboard = format!(
        "---\nformat: {}\nmessage: {}\naudience: general\n---\n\n{}",
        project.aspect_ratio, project.prompt, storyboard_frames
    );
    let frame = "# Frame\n\nDark editorial motion system. Use warm off-white typography, restrained orange accents, diagrams, kinetic type, and source-appropriate imagery. Keep every frame readable at mobile-video size.\n";
    fs::write(directory.join("BRIEF.md"), brief)
        .await
        .map_err(|error| error.to_string())?;
    fs::write(directory.join("SCRIPT.md"), script)
        .await
        .map_err(|error| error.to_string())?;
    fs::write(directory.join("STORYBOARD.md"), storyboard)
        .await
        .map_err(|error| error.to_string())?;
    fs::write(directory.join("frame.md"), frame)
        .await
        .map_err(|error| error.to_string())
}

async fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).await.map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

async fn read_json_or_default<T>(path: &Path) -> Result<T, String>
where
    T: for<'de> Deserialize<'de> + Default,
{
    match fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.to_string()),
    }
}

async fn write_json<T: Serialize + ?Sized>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "invalid JSON file path".to_owned())?;
    let temporary = path.with_file_name(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, bytes)
        .await
        .map_err(|error| error.to_string())?;
    if let Err(error) = fs::rename(&temporary, path).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(error.to_string());
    }
    Ok(())
}

fn derive_title(prompt: &str) -> String {
    let compact = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(18).collect::<String>()
}

#[cfg(test)]
fn seed_scenes(prompt: &str, target: u32) -> Vec<SceneRecord> {
    let durations = [0.12, 0.18, 0.18, 0.17, 0.18, 0.17];
    let templates = [
        (
            "问题出现",
            format!("为什么值得理解：{}？", prompt),
            "从一个具体困惑切入，使用高对比动态排版与一个明确视觉焦点。",
            "动态排版",
            "kinetic-type-beats",
        ),
        (
            "核心机制",
            "先看清组成部分，再理解它们如何彼此协作。".to_owned(),
            "中央核心与周边模块逐层建立连接，关系随旁白展开。",
            "程序化图解",
            "constellation-hub",
        ),
        (
            "工作过程",
            "目标被拆成步骤，每一步都留下可以检查的结果。".to_owned(),
            "流程节点按顺序推进，已完成与待处理状态清晰可见。",
            "流程图",
            "agent-progress-theater",
        ),
        (
            "工具调用",
            "需要信息、图像或计算时，系统会选择合适的工具。".to_owned(),
            "界面片段、工具符号与结果面板进行空间切换。",
            "界面模拟",
            "cursor-ui-demo",
        ),
        (
            "反馈循环",
            "结果会被重新检查和调整，直到满足目标。".to_owned(),
            "反馈环逐段点亮，前后结果形成清楚对照。",
            "数据图解",
            "fixed-anchor-cycle",
        ),
        (
            "价值落地",
            "复杂过程因此变得更清楚，也更容易持续改进。".to_owned(),
            "收束为一个安静有力的结论画面，可使用一张生成图像营造情绪。",
            "生成图像",
            "titlecard-reveal",
        ),
    ];

    templates
        .into_iter()
        .enumerate()
        .map(
            |(index, (role, narration, visual, asset, motion))| SceneRecord {
                id: format!("scene-{:02}", index + 1),
                order: index + 1,
                narrative_role: role.to_owned(),
                narration,
                visual_direction: visual.to_owned(),
                duration_seconds: (target as f32 * durations[index] * 10.0).round() / 10.0,
                asset_strategy: asset.to_owned(),
                motion_blueprint: motion.to_owned(),
                caption_mode: "智能匹配".to_owned(),
                transition: if index == 5 { "淡出" } else { "速度匹配" }.to_owned(),
                status: "draft".to_owned(),
                thumbnail_url: None,
                asset_ids: Vec::new(),
                version: 1,
            },
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> CreateProjectRequest {
        CreateProjectRequest {
            title: Some("测试影片".to_owned()),
            prompt: "解释 Agent 如何完成复杂任务".to_owned(),
            source_text: String::new(),
            aspect_ratio: "9:16".to_owned(),
            duration_seconds: 55,
            model: "gpt-5.6-terra".to_owned(),
            reasoning_effort: "high".to_owned(),
        }
    }

    #[tokio::test]
    async fn isolates_projects_and_propagates_scene_dirty_state() {
        let root = std::env::temp_dir().join(format!("yingya-test-{}", Uuid::new_v4()));
        let store = ProjectStore::new(root.clone()).await.unwrap();
        let project = store.create(request()).await.unwrap();
        store
            .prepare_script_draft(&project.project.id)
            .await
            .unwrap();
        let project = store.get(&project.project.id).await.unwrap();
        assert!(
            store
                .project_dir(&project.project.id)
                .unwrap()
                .join("assets/generated")
                .is_dir()
        );
        let storyboard = fs::read_to_string(
            store
                .project_dir(&project.project.id)
                .unwrap()
                .join("STORYBOARD.md"),
        )
        .await
        .unwrap();
        assert!(storyboard.starts_with("---\nformat: 9:16"));
        assert!(storyboard.contains("## Scene 1 —"));
        assert!(storyboard.contains("- Status: outline"));
        assert!(storyboard.contains("- Voiceover:"));
        let scene_id = project.scenes[0].id.clone();
        let detail = store
            .patch_scene(
                &project.project.id,
                &scene_id,
                PatchSceneRequest {
                    narrative_role: None,
                    narration: Some("新的旁白".to_owned()),
                    visual_direction: None,
                    duration_seconds: None,
                    asset_strategy: None,
                    motion_blueprint: None,
                    transition: None,
                    asset_ids: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(detail.scenes[0].status, "dirty");
        assert!(detail.project.draft_url.is_none());
        store
            .append_asset(
                &project.project.id,
                AssetRecord {
                    id: "asset-1".to_owned(),
                    name: "参考图.png".to_owned(),
                    url: "/reference.png".to_owned(),
                    hyperframes_path: "assets/generated/reference.png".to_owned(),
                    kind: "png".to_owned(),
                    source: "imagegen".to_owned(),
                    media_type: None,
                    duration_seconds: None,
                    provider_id: None,
                    description: None,
                    created_at: now(),
                },
            )
            .await
            .unwrap();
        let detail = store
            .patch_scene(
                &project.project.id,
                &scene_id,
                PatchSceneRequest {
                    narrative_role: None,
                    narration: None,
                    visual_direction: None,
                    duration_seconds: None,
                    asset_strategy: None,
                    motion_blueprint: None,
                    transition: None,
                    asset_ids: Some(vec!["asset-1".to_owned()]),
                },
            )
            .await
            .unwrap();
        assert_eq!(detail.scenes[0].asset_ids, vec!["asset-1"]);
        assert_eq!(detail.project.status, "asset_review");
        assert!(store.project_dir("../outside").is_err());
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn serializes_concurrent_project_updates() {
        let root = std::env::temp_dir().join(format!("yingya-lock-test-{}", Uuid::new_v4()));
        let store = ProjectStore::new(root.clone()).await.unwrap();
        let project = store.create(request()).await.unwrap();
        let project_id = project.project.id;
        let mut tasks = Vec::new();

        for index in 0..20 {
            let store = store.clone();
            let project_id = project_id.clone();
            tasks.push(tokio::spawn(async move {
                store
                    .append_message(&project_id, "assistant", &format!("message-{index}"))
                    .await
                    .map(|_| ())
            }));
        }
        for index in 0..20 {
            let store = store.clone();
            let project_id = project_id.clone();
            tasks.push(tokio::spawn(async move {
                store
                    .append_asset(
                        &project_id,
                        AssetRecord {
                            id: format!("asset-{index}"),
                            name: format!("asset-{index}.png"),
                            url: format!("/asset-{index}.png"),
                            hyperframes_path: format!("assets/asset-{index}.png"),
                            kind: "png".to_owned(),
                            source: "test".to_owned(),
                            media_type: None,
                            duration_seconds: None,
                            provider_id: None,
                            description: None,
                            created_at: now(),
                        },
                    )
                    .await
            }));
        }

        for task in tasks {
            task.await.unwrap().unwrap();
        }

        let detail = store.get(&project_id).await.unwrap();
        assert_eq!(detail.messages.len(), 21);
        assert_eq!(detail.assets.len(), 20);
        fs::remove_dir_all(root).await.unwrap();
    }
}
