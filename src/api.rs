use std::{
    env,
    net::SocketAddr,
    path::{Path as FilePath, PathBuf},
    sync::Arc,
    time::Duration,
};

use crate::agent_jobs::{ActiveAgentTurn, AgentJobCoordinator};
use crate::agent_projects::{
    self, AgentArtifact, AgentEvent, AgentMedia, AgentProjectDetail, AgentProjectRecord,
    AgentProjectStore, AgentTurnRequest, AppendAgentMessage, CreateAgentProjectRequest, MediaAsset,
    MediaScene, QueuedTurn,
};
use crate::codex::{
    CodexClient, CodexConfig, CodexError, GeneratedImageEvent, ThreadStarted, TurnCancellation,
    TurnOptions,
};
use crate::config::AppPaths;
use crate::heygen::{HeyGenAudioSearchResponse, HeyGenClient, HeyGenError};
use crate::model_settings::validate_model_settings;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{
        HeaderMap, StatusCode,
        header::{
            ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_NONE_MATCH, RANGE,
        },
    },
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{any, get, patch, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
    net::TcpListener,
    process::Command,
    sync::{Mutex, broadcast, mpsc},
};
use tokio_stream::{StreamExt, wrappers::BroadcastStream};
use tower_http::services::{ServeDir, ServeFile};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    codex: Arc<CodexClient>,
    heygen: HeyGenClient,
    assets: AssetStore,
    studio_lock: Arc<Mutex<()>>,
    root: Arc<PathBuf>,
    hyperframes_home: Arc<PathBuf>,
    agent_projects: AgentProjectStore,
    agent_events: broadcast::Sender<AgentEvent>,
    agent_jobs: AgentJobCoordinator,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HeyGenAudioSearchQuery {
    query: String,
    #[serde(rename = "type", default = "default_audio_type")]
    audio_type: String,
    #[serde(default = "default_audio_limit")]
    limit: u8,
    #[serde(default)]
    min_score: Option<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportHeyGenAudioRequest {
    id: String,
    query: String,
    #[serde(rename = "type")]
    audio_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PatchAgentSceneRequest {
    asset_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnRequest {
    prompt: String,
    #[serde(default)]
    reference_images: Vec<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning_effort: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RenameAgentProjectRequest {
    title: String,
}

#[derive(Clone)]
struct AssetStore {
    root: Arc<PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageAsset {
    id: String,
    url: String,
    hyperframes_path: String,
    mime_type: String,
    revised_prompt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TurnResponse {
    thread_id: String,
    turn_id: String,
    status: String,
    text: String,
    images: Vec<ImageAsset>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadResponse {
    url: String,
    hyperframes_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    backend: &'static str,
    codex_model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StudioResponse {
    storyboard_url: String,
    preview_url: String,
}

#[derive(Debug, Deserialize)]
struct AgentEventQuery {
    #[serde(default)]
    after: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentEventLogQuery {
    before: Option<u64>,
    #[serde(default = "default_event_page_limit")]
    limit: usize,
}

fn default_event_page_limit() -> usize {
    200
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTurnAccepted {
    turn_id: String,
    status: String,
    queue_depth: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenderAgentVideoRequest {
    version_id: String,
    resolution: String,
    fps: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RenderAgentVideoResponse {
    path: String,
    label: String,
    resolution: String,
    fps: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentUploadResponse {
    path: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct AgentServerResponse {
    id: Value,
    result: Value,
}

pub async fn run() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("yingya_server=info")),
        )
        .init();

    let paths = AppPaths::from_env().map_err(std::io::Error::other)?;
    for directory in [&paths.app_data, &paths.cache, &paths.runtime] {
        fs::create_dir_all(directory).await?;
    }
    let root = paths.resources.clone();
    let video_agent_skill = install_bundled_video_agent_skill(&root, &paths.codex_home).await?;
    let hyperframes_browser = discover_hyperframes_browser(&root, &paths.hyperframes_home).await;
    let config = CodexConfig {
        binary: env_path("YINGYA_CODEX_BIN", root.join("node_modules/.bin/codex")),
        home: paths.codex_home.clone(),
        workspace: env_path("YINGYA_WORKSPACE", root.clone()),
        model: env::var("YINGYA_CODEX_MODEL").unwrap_or_else(|_| "gpt-5.6-terra".to_owned()),
        network_access: env_bool("YINGYA_CODEX_NETWORK_ACCESS", true),
        hyperframes_browser,
        video_agent_skill: Some(video_agent_skill),
        // This is an inactivity timeout, not a cap on the total production time.
        turn_timeout: Duration::from_secs(env_u64("YINGYA_CODEX_TURN_TIMEOUT_SECS", 3600)),
    };

    let codex = CodexClient::spawn(config).await?;
    let heygen = HeyGenClient::new()?;
    let assets = AssetStore::new(paths.assets.clone()).await?;
    let agent_projects = AgentProjectStore::new(paths.projects.clone()).await?;
    agent_projects
        .recover_interrupted()
        .await
        .map_err(std::io::Error::other)?;
    let (agent_events, _) = broadcast::channel(2_048);
    let static_assets = assets.root.as_ref().clone();
    let web_dist = root.join("web-dist");
    let web_index = web_dist.join("index.html");
    let state = AppState {
        codex,
        heygen,
        assets,
        studio_lock: Arc::new(Mutex::new(())),
        root: Arc::new(root.clone()),
        hyperframes_home: Arc::new(paths.hyperframes_home.clone()),
        agent_projects,
        agent_events,
        agent_jobs: AgentJobCoordinator::default(),
    };
    audit_existing_project_workflows(&state).await;
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/codex/skills", get(list_skills))
        .route("/api/codex/models", get(list_models))
        .route("/api/codex/threads", post(start_thread))
        .route("/api/codex/threads/{thread_id}/turns", post(run_turn))
        .route(
            "/api/codex/threads/{thread_id}/images",
            post(generate_image),
        )
        .route("/api/assets/images", post(upload_image))
        .route("/api/heygen/audio", get(search_heygen_audio))
        .route(
            "/api/agent-projects",
            get(list_agent_projects).post(create_agent_project),
        )
        .route(
            "/api/agent-projects/{project_id}",
            get(get_agent_project)
                .patch(rename_agent_project)
                .delete(delete_agent_project),
        )
        .route(
            "/api/agent-projects/{project_id}/turns",
            post(post_agent_turn),
        )
        .route(
            "/api/agent-projects/{project_id}/interrupt",
            post(interrupt_agent_turn),
        )
        .route(
            "/api/agent-projects/{project_id}/resume",
            post(resume_agent_queue),
        )
        .route(
            "/api/agent-projects/{project_id}/queue/{turn_id}",
            axum::routing::delete(remove_queued_turn),
        )
        .route(
            "/api/agent-projects/{project_id}/events",
            get(agent_event_stream),
        )
        .route(
            "/api/agent-projects/{project_id}/event-log",
            get(agent_event_log),
        )
        .route(
            "/api/agent-projects/{project_id}/checkpoint",
            post(confirm_agent_checkpoint),
        )
        .route(
            "/api/agent-projects/{project_id}/render",
            post(render_agent_video),
        )
        .route(
            "/api/agent-projects/{project_id}/requests/respond",
            post(respond_agent_request),
        )
        .route(
            "/api/agent-projects/{project_id}/versions/{version_id}/rollback",
            post(rollback_agent_version),
        )
        .route(
            "/api/agent-projects/{project_id}/studio",
            post(start_agent_studio),
        )
        .route(
            "/api/agent-projects/{project_id}/studio/dirty",
            post(mark_agent_studio_dirty),
        )
        .route(
            "/api/agent-projects/{project_id}/assets",
            post(upload_agent_asset),
        )
        .route(
            "/api/agent-projects/{project_id}/media",
            get(get_agent_media),
        )
        .route(
            "/api/agent-projects/{project_id}/heygen/audio",
            post(import_agent_heygen_audio),
        )
        .route(
            "/api/agent-projects/{project_id}/scenes/{scene_id}",
            patch(patch_agent_scene),
        )
        .route(
            "/api/agent-projects/{project_id}/files/{*path}",
            get(agent_project_file),
        )
        .route("/api/{*path}", any(api_not_found))
        .nest_service("/assets", ServeDir::new(static_assets))
        .fallback_service(ServeDir::new(web_dist).not_found_service(ServeFile::new(web_index)))
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .with_state(state);

    let address: SocketAddr = env::var("YINGYA_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8797".to_owned())
        .parse()?;
    let listener = TcpListener::bind(address).await?;
    info!(%address, "Yingya Rust backend is listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn install_bundled_video_agent_skill(
    resources: &FilePath,
    codex_home: &FilePath,
) -> Result<PathBuf, std::io::Error> {
    let source = resources.join("skills/yingya-video-agent");
    let destination = codex_home.join("skills/yingya-video-agent");
    fs::create_dir_all(destination.join("agents")).await?;
    fs::copy(source.join("SKILL.md"), destination.join("SKILL.md")).await?;
    fs::copy(
        source.join("agents/openai.yaml"),
        destination.join("agents/openai.yaml"),
    )
    .await?;
    Ok(destination.join("SKILL.md"))
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        backend: "rust",
        codex_model: state.codex.model().to_owned(),
    })
}

async fn api_not_found() -> ApiError {
    ApiError::NotFound("API route not found".to_owned())
}

async fn start_thread(State(state): State<AppState>) -> Result<Json<ThreadStarted>, ApiError> {
    Ok(Json(state.codex.start_thread().await?))
}

async fn list_skills(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.codex.list_skills().await?))
}

async fn list_models(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.codex.list_models().await?))
}

async fn list_agent_projects(
    State(state): State<AppState>,
) -> Result<Json<Vec<AgentProjectRecord>>, ApiError> {
    Ok(Json(
        state
            .agent_projects
            .list()
            .await
            .map_err(ApiError::Project)?,
    ))
}

async fn delete_agent_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let gate = state.agent_jobs.lock(&project_id).await;
    if state.agent_jobs.contains(&project_id).await {
        return Err(ApiError::Conflict(
            "项目仍在运行，请先停止任务再删除".to_owned(),
        ));
    }
    state
        .agent_projects
        .delete(&project_id)
        .await
        .map_err(ApiError::Project)?;
    drop(gate);
    state.agent_jobs.remove_project(&project_id).await;
    Ok(StatusCode::NO_CONTENT)
}

async fn rename_agent_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<RenameAgentProjectRequest>,
) -> Result<Json<AgentProjectRecord>, ApiError> {
    let title = request.title.trim();
    if title.is_empty() {
        return Err(ApiError::BadRequest("项目标题不能为空".to_owned()));
    }
    if title.chars().count() > 48 {
        return Err(ApiError::BadRequest(
            "项目标题不能超过 48 个字符".to_owned(),
        ));
    }
    let title = title.to_owned();
    let project = state
        .agent_projects
        .update_project(&project_id, |record| record.title = title)
        .await
        .map_err(ApiError::Project)?;
    emit_agent_state_event(&state, &project_id, None, "project/updated").await;
    Ok(Json(project))
}

async fn get_agent_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<AgentProjectDetail>, ApiError> {
    Ok(Json(
        state
            .agent_projects
            .get(&project_id)
            .await
            .map_err(ApiError::Project)?,
    ))
}

async fn create_agent_project(
    State(state): State<AppState>,
    Json(request): Json<CreateAgentProjectRequest>,
) -> Result<Json<AgentProjectDetail>, ApiError> {
    validate_model_settings(&request.model, &request.reasoning_effort)
        .map_err(ApiError::Validation)?;
    let project = state
        .agent_projects
        .create(&request)
        .await
        .map_err(ApiError::Project)?;
    state
        .agent_projects
        .update_project(&project.id, |record| {
            record.status = "idle".to_owned();
            record.status_label = "等待发送需求".to_owned();
        })
        .await
        .map_err(ApiError::Project)?;
    Ok(Json(
        state
            .agent_projects
            .get(&project.id)
            .await
            .map_err(ApiError::Project)?,
    ))
}

async fn post_agent_turn(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<AgentTurnRequest>,
) -> Result<Json<AgentTurnAccepted>, ApiError> {
    if request.text.trim().is_empty() {
        return Err(ApiError::BadRequest("message cannot be empty".to_owned()));
    }
    if let Some(model) = request.model.as_deref() {
        validate_model_settings(model, request.reasoning_effort.as_deref().unwrap_or("auto"))
            .map_err(ApiError::Validation)?;
    }
    let gate = state.agent_jobs.lock(&project_id).await;
    if request.interrupt
        && let Some(active) = state.agent_jobs.active(&project_id).await
    {
        active.cancellation.cancel();
    }
    let priority = request.interrupt;
    let queued = state
        .agent_projects
        .submit_turn(&project_id, request, priority)
        .await
        .map_err(ApiError::Project)?;
    start_next_agent_turn_locked(state.clone(), project_id.clone()).await?;
    drop(gate);
    emit_agent_state_event(
        &state,
        &project_id,
        Some(queued.id.clone()),
        "queue/updated",
    )
    .await;
    let detail = state
        .agent_projects
        .get(&project_id)
        .await
        .map_err(ApiError::Project)?;
    let status = if detail.project.active_turn_id.as_deref() == Some(queued.id.as_str()) {
        "running"
    } else {
        "queued"
    };
    Ok(Json(AgentTurnAccepted {
        turn_id: queued.id,
        status: status.to_owned(),
        queue_depth: detail.queue.len(),
    }))
}

async fn interrupt_agent_turn(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let _gate = state.agent_jobs.lock(&project_id).await;
    let active = state.agent_jobs.active(&project_id).await;
    state
        .agent_projects
        .set_queue_paused(&project_id, true)
        .await
        .map_err(ApiError::Project)?;
    if active.is_some() {
        state
            .agent_projects
            .update_project(&project_id, |record| {
                record.status = "stopping".to_owned();
                record.status_label = "正在停止当前任务".to_owned();
            })
            .await
            .map_err(ApiError::Project)?;
    }
    if let Some(active) = active {
        active.cancellation.cancel();
    }
    emit_agent_state_event(&state, &project_id, None, "project/updated").await;
    Ok(if state.agent_jobs.contains(&project_id).await {
        StatusCode::ACCEPTED
    } else {
        StatusCode::NO_CONTENT
    })
}

async fn resume_agent_queue(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let _gate = state.agent_jobs.lock(&project_id).await;
    state
        .agent_projects
        .set_queue_paused(&project_id, false)
        .await
        .map_err(ApiError::Project)?;
    start_next_agent_turn_locked(state.clone(), project_id.clone()).await?;
    emit_agent_state_event(&state, &project_id, None, "queue/resumed").await;
    Ok(StatusCode::ACCEPTED)
}

async fn remove_queued_turn(
    State(state): State<AppState>,
    Path((project_id, turn_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    state
        .agent_projects
        .remove_queued(&project_id, &turn_id)
        .await
        .map_err(ApiError::Project)?;
    emit_agent_state_event(&state, &project_id, Some(turn_id), "queue/updated").await;
    Ok(StatusCode::NO_CONTENT)
}

async fn confirm_agent_checkpoint(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<AgentTurnAccepted>, ApiError> {
    let detail = state
        .agent_projects
        .get(&project_id)
        .await
        .map_err(ApiError::Project)?;
    let checkpoint =
        detail.manifest.checkpoint.clone().ok_or_else(|| {
            ApiError::Conflict("project is not waiting for confirmation".to_owned())
        })?;
    if checkpoint.kind != "plan" && checkpoint.kind != "draft" {
        return Err(ApiError::Conflict("unsupported checkpoint kind".to_owned()));
    }
    let checkpoint_context = format!("checkpoint:{}", checkpoint.id);
    let active = state.agent_jobs.active(&project_id).await;
    let mut manifest = state
        .agent_projects
        .manifest(&project_id)
        .await
        .map_err(ApiError::Project)?;
    let previous_manifest = manifest.clone();
    let transitioned = manifest
        .checkpoint
        .as_ref()
        .is_some_and(|current| current.id == checkpoint.id);
    if transitioned {
        manifest.checkpoint = None;
        manifest.phase = if checkpoint.kind == "plan" {
            "production".to_owned()
        } else {
            "final_render".to_owned()
        };
        state
            .agent_projects
            .write_manifest(&project_id, &manifest)
            .await
            .map_err(ApiError::Project)?;
    }
    let accepted = if let Some(active) = active.filter(|active| {
        active
            .context
            .iter()
            .any(|value| value == &checkpoint_context)
    }) {
        Ok(Json(AgentTurnAccepted {
            turn_id: active.request_id,
            status: "running".to_owned(),
            queue_depth: detail.queue.len(),
        }))
    } else if let Some(existing) = detail.queue.iter().find(|turn| {
        turn.context
            .iter()
            .any(|value| value == &checkpoint_context)
    }) {
        Ok(Json(AgentTurnAccepted {
            turn_id: existing.id.clone(),
            status: "queued".to_owned(),
            queue_depth: detail.queue.len(),
        }))
    } else {
        let text = if checkpoint.kind == "plan" {
            "当前制作方案已经确认。请按方案继续制作完整草稿；完成 HyperFrames lint、validate、inspect 和必要的动画检查后，写入 draft checkpoint 并返回可审阅视频。"
        } else {
            "当前草稿已经明确确认。请执行最终质量检查并渲染高质量 MP4；成功后把最终视频写入 manifest artifacts，清除 checkpoint 和 dirty，并将 phase 设置为 completed。"
        };
        post_agent_turn(
            State(state.clone()),
            Path(project_id.clone()),
            Json(AgentTurnRequest {
                text: text.to_owned(),
                attachments: vec![],
                context: vec![checkpoint_context],
                model: None,
                reasoning_effort: None,
                interrupt: false,
            }),
        )
        .await
    };
    if accepted.is_err() && transitioned {
        let _ = state
            .agent_projects
            .write_manifest(&project_id, &previous_manifest)
            .await;
    }
    accepted
}

async fn render_agent_video(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<RenderAgentVideoRequest>,
) -> Result<Json<RenderAgentVideoResponse>, ApiError> {
    let (resolution, resolution_pixels, resolution_label) = match request.resolution.as_str() {
        "landscape" => ("landscape", "1920x1080", "1920 × 1080 p"),
        "landscape-4k" => ("landscape-4k", "3840x2160", "3840 × 2160 p"),
        "portrait" => ("portrait", "1080x1920", "1080 × 1920 p"),
        "portrait-4k" => ("portrait-4k", "2160x3840", "2160 × 3840 p"),
        "square" => ("square", "1080x1080", "1080 × 1080 p"),
        "square-4k" => ("square-4k", "2160x2160", "2160 × 2160 p"),
        _ => {
            return Err(ApiError::Validation("请选择支持的渲染分辨率".to_owned()));
        }
    };
    if !matches!(request.fps, 30 | 60) {
        return Err(ApiError::Validation("帧率必须是 30 或 60 FPS".to_owned()));
    }

    let _gate = state.agent_jobs.lock(&project_id).await;
    if state.agent_jobs.contains(&project_id).await {
        return Err(ApiError::Conflict(
            "项目仍在制作中，请等待当前任务结束后再渲染成片".to_owned(),
        ));
    }

    let mut manifest = state
        .agent_projects
        .manifest(&project_id)
        .await
        .map_err(ApiError::Project)?;
    if let Some(aspect_ratio) = manifest
        .output_spec
        .get("aspectRatio")
        .and_then(Value::as_str)
    {
        let compatible = match aspect_ratio {
            "16:9" => resolution.starts_with("landscape"),
            "9:16" => resolution.starts_with("portrait"),
            "1:1" => resolution.starts_with("square"),
            _ => true,
        };
        if !compatible {
            return Err(ApiError::Validation(format!(
                "所选分辨率与项目画幅 {} 不匹配",
                aspect_ratio
            )));
        }
    }
    let version = manifest
        .versions
        .iter()
        .find(|version| version.id == request.version_id)
        .cloned()
        .ok_or_else(|| ApiError::NotFound("找不到要渲染的草稿版本".to_owned()))?;
    let source = state
        .agent_projects
        .resolve_relative(&project_id, &version.source_path)
        .map_err(ApiError::Project)?;
    if fs::metadata(&source)
        .await
        .map(|value| !value.is_file())
        .unwrap_or(true)
    {
        return Err(ApiError::NotFound("草稿源文件不存在，无法渲染".to_owned()));
    }
    let source_dir = source
        .parent()
        .ok_or_else(|| ApiError::Validation("草稿源文件路径无效".to_owned()))?;
    let relative_output = format!(
        ".yingya/exports/{}-{}-{}fps.mp4",
        version.id, resolution, request.fps
    );
    let output_path = state
        .agent_projects
        .resolve_relative(&project_id, &relative_output)
        .map_err(ApiError::Project)?;
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let output = tokio::time::timeout(
        Duration::from_secs(7_200),
        Command::new(state.root.join("node_modules/.bin/hyperframes"))
            .arg("render")
            .args(["--output", output_path.to_string_lossy().as_ref()])
            .args(["--quality", "high"])
            .args(["--resolution", resolution])
            .args(["--fps", &request.fps.to_string()])
            .current_dir(source_dir)
            .env("HOME", state.hyperframes_home.as_ref())
            .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| ApiError::External("视频渲染超时".to_owned()))??;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        return Err(ApiError::External(if stderr.is_empty() {
            stdout
        } else {
            stderr
        }));
    }
    if fs::metadata(&output_path)
        .await
        .map(|value| !value.is_file())
        .unwrap_or(true)
    {
        return Err(ApiError::External(
            "HyperFrames 未生成预期的视频文件".to_owned(),
        ));
    }

    let label = format!(
        "{} · {} · {} FPS 成片",
        version.label, resolution_label, request.fps
    );
    let artifact_id = format!("final-{}-{}-{}fps", version.id, resolution, request.fps);
    manifest
        .artifacts
        .retain(|artifact| artifact.id != artifact_id);
    manifest.artifacts.push(AgentArtifact {
        id: artifact_id,
        kind: "final-video".to_owned(),
        label: label.clone(),
        path: relative_output.clone(),
        version: Some(version.id.clone()),
        metadata: json!({
            "quality": "high",
            "frameRate": request.fps,
            "resolution": resolution_pixels,
        }),
    });
    if let Some(output_spec) = manifest.output_spec.as_object_mut() {
        output_spec.insert("finalQuality".to_owned(), Value::String("high".to_owned()));
        output_spec.insert("frameRate".to_owned(), Value::from(request.fps));
        output_spec.insert(
            "resolution".to_owned(),
            Value::String(resolution_pixels.to_owned()),
        );
    }
    manifest.checkpoint = None;
    manifest.phase = "completed".to_owned();
    manifest.dirty = false;
    state
        .agent_projects
        .write_manifest(&project_id, &manifest)
        .await
        .map_err(ApiError::Project)?;
    state
        .agent_projects
        .update_project(&project_id, |record| {
            record.status = "completed".to_owned();
            record.status_label = format!("{} 成片已完成", resolution_label);
        })
        .await
        .map_err(ApiError::Project)?;
    emit_agent_state_event(&state, &project_id, None, "project/updated").await;

    Ok(Json(RenderAgentVideoResponse {
        path: relative_output,
        label,
        resolution: resolution_pixels.to_owned(),
        fps: request.fps,
    }))
}

async fn respond_agent_request(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(response): Json<AgentServerResponse>,
) -> Result<StatusCode, ApiError> {
    let known = state
        .agent_projects
        .read_events(&project_id, 0)
        .await
        .map_err(ApiError::Project)?
        .iter()
        .any(|event| event.payload.get("id") == Some(&response.id));
    if !known {
        return Err(ApiError::NotFound("unknown Codex request id".to_owned()));
    }
    state
        .codex
        .respond_to_server_request(response.id, response.result)
        .await?;
    Ok(StatusCode::ACCEPTED)
}

async fn rollback_agent_version(
    State(state): State<AppState>,
    Path((project_id, version_id)): Path<(String, String)>,
) -> Result<Json<AgentTurnAccepted>, ApiError> {
    let manifest = state
        .agent_projects
        .manifest(&project_id)
        .await
        .map_err(ApiError::Project)?;
    let version = manifest
        .versions
        .iter()
        .find(|version| version.id == version_id)
        .ok_or_else(|| ApiError::NotFound("unknown draft version".to_owned()))?;
    let text = format!(
        "请回退到 {}（{}）。从该版本快照恢复源码和 manifest 指针，不要删除后续版本；恢复后运行相关 HyperFrames 检查，并把结果作为新的稳定 Draft 提交审阅。",
        version.label, version.id
    );
    post_agent_turn(
        State(state),
        Path(project_id),
        Json(AgentTurnRequest {
            text,
            attachments: vec![],
            context: vec![format!("rollback:{}", version.id)],
            model: None,
            reasoning_effort: None,
            interrupt: false,
        }),
    )
    .await
}

async fn agent_event_stream(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    headers: HeaderMap,
    Query(query): Query<AgentEventQuery>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>>, ApiError>
{
    let after = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .unwrap_or(query.after);
    let subscriber = state.agent_events.subscribe();
    let (historical, overflow, latest_seq) = state
        .agent_projects
        .read_events_after_limited(&project_id, after, 1_000)
        .await
        .map_err(ApiError::Project)?;
    let baseline = if overflow {
        latest_seq
    } else {
        historical.last().map_or(after, |event| event.seq)
    };
    let mut history_events: Vec<Result<Event, std::convert::Infallible>> = historical
        .into_iter()
        .map(|event| {
            Ok(Event::default()
                .event("agent-event")
                .id(event.seq.to_string())
                .json_data(event)
                .unwrap_or_else(|_| Event::default().data("{}")))
        })
        .collect();
    if overflow {
        history_events.clear();
        history_events.push(Ok(Event::default()
            .event("resync-required")
            .id(latest_seq.to_string())
            .data(latest_seq.to_string())));
    }
    let history_stream = tokio_stream::iter(history_events);
    let live_project_id = project_id.clone();
    let live = BroadcastStream::new(subscriber).filter_map(move |result| match result {
        Ok(event) if event.project_id == live_project_id && event.seq > baseline => {
            Some(Ok(Event::default()
                .event("agent-event")
                .id(event.seq.to_string())
                .json_data(event)
                .unwrap_or_else(|_| Event::default().data("{}"))))
        }
        _ => None,
    });
    Ok(Sse::new(history_stream.chain(live)).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

async fn agent_event_log(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(query): Query<AgentEventLogQuery>,
) -> Result<Json<agent_projects::AgentEventPage>, ApiError> {
    Ok(Json(
        state
            .agent_projects
            .read_event_page(&project_id, query.before, query.limit)
            .await
            .map_err(ApiError::Project)?,
    ))
}

async fn emit_agent_state_event(
    state: &AppState,
    project_id: &str,
    turn_id: Option<String>,
    method: &str,
) {
    if let Ok(event) = state
        .agent_projects
        .append_event(
            project_id,
            turn_id,
            method.to_owned(),
            json!({ "method": method }),
        )
        .await
    {
        let _ = state.agent_events.send(event);
    }
}

async fn upload_agent_asset(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<AgentUploadResponse>, ApiError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
    {
        if field.name() != Some("file") {
            continue;
        }
        let original = field.file_name().unwrap_or("asset.bin").to_owned();
        let extension = FilePath::new(&original)
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| value.len() <= 10)
            .unwrap_or("bin");
        let filename = format!("{}.{extension}", Uuid::new_v4());
        let bytes = field
            .bytes()
            .await
            .map_err(|error| ApiError::BadRequest(error.to_string()))?;
        let relative = format!("assets/inbox/{filename}");
        fs::write(
            state
                .agent_projects
                .resolve_relative(&project_id, &relative)
                .map_err(ApiError::Project)?,
            bytes,
        )
        .await?;
        return Ok(Json(AgentUploadResponse {
            path: relative,
            name: original,
        }));
    }
    Err(ApiError::BadRequest("file is required".to_owned()))
}

async fn get_agent_media(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<AgentMedia>, ApiError> {
    Ok(Json(
        state
            .agent_projects
            .media(&project_id)
            .await
            .map_err(ApiError::Project)?,
    ))
}

async fn patch_agent_scene(
    State(state): State<AppState>,
    Path((project_id, scene_id)): Path<(String, String)>,
    Json(request): Json<PatchAgentSceneRequest>,
) -> Result<Json<MediaScene>, ApiError> {
    let scene = state
        .agent_projects
        .patch_scene_assets(&project_id, &scene_id, request.asset_ids)
        .await
        .map_err(|message| {
            if message.starts_with("unknown scene id") {
                ApiError::NotFound(message)
            } else if message.starts_with("unknown asset id") {
                ApiError::Validation(message)
            } else {
                ApiError::Project(message)
            }
        })?;
    emit_agent_state_event(&state, &project_id, None, "media/updated").await;
    Ok(Json(scene))
}

async fn import_agent_heygen_audio(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<ImportHeyGenAudioRequest>,
) -> Result<Json<MediaAsset>, ApiError> {
    let query = request.query.trim();
    if query.is_empty() || request.id.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "HeyGen 音频 id 和搜索描述不能为空".to_owned(),
        ));
    }
    let audio_type = normalize_audio_type(&request.audio_type)?;
    let media = state
        .agent_projects
        .media(&project_id)
        .await
        .map_err(ApiError::Project)?;
    if let Some(asset) = media
        .assets
        .into_iter()
        .find(|asset| asset.provider_id.as_deref() == Some(request.id.as_str()))
    {
        return Ok(Json(asset));
    }
    let results = state
        .heygen
        .search_audio(query, audio_type, 50, 0.0)
        .await?;
    let sound = results
        .data
        .into_iter()
        .find(|sound| sound.id == request.id)
        .ok_or_else(|| ApiError::Validation("HeyGen 音频已失效，请重新搜索".to_owned()))?;
    let bytes = state.heygen.download_audio(&sound.audio_url).await?;
    let extension = audio_extension(&bytes)
        .ok_or_else(|| ApiError::External("HeyGen 返回了无法识别的音频文件格式".to_owned()))?;
    let filename = format!("{}.{}", Uuid::new_v4(), extension);
    let relative = format!("assets/audio/{filename}");
    let destination = state
        .agent_projects
        .resolve_relative(&project_id, &relative)
        .map_err(ApiError::Project)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::write(destination, bytes).await?;
    let asset = MediaAsset {
        id: Uuid::new_v4().to_string(),
        name: sound.name,
        url: format!("/api/agent-projects/{project_id}/files/{relative}"),
        hyperframes_path: relative,
        kind: extension.to_owned(),
        source: "heygen".to_owned(),
        media_type: Some(audio_type.to_owned()),
        duration_seconds: Some(sound.duration),
        provider_id: Some(sound.id),
        description: Some(sound.description),
        created_at: agent_projects::now_millis(),
    };
    let asset = state
        .agent_projects
        .append_media_asset(&project_id, asset)
        .await
        .map_err(ApiError::Project)?;
    emit_agent_state_event(&state, &project_id, None, "media/updated").await;
    Ok(Json(asset))
}

async fn start_agent_studio(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<StudioResponse>, ApiError> {
    use std::hash::{Hash, Hasher};
    let _guard = state.studio_lock.lock().await;
    let project_dir = state
        .agent_projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    project_id.hash(&mut hasher);
    let port = 8600 + (hasher.finish() % 100) as u16;
    let status = run_preview_command(&state, &project_dir, &["--status"]).await?;
    let reusable = status.pointer("/result/state").and_then(Value::as_str) == Some("running")
        && status.pointer("/result/host").and_then(Value::as_str) == Some("0.0.0.0")
        && status
            .pointer("/result/port")
            .and_then(Value::as_u64)
            .is_some_and(|value| (8600..8800).contains(&value));
    if !reusable && status.pointer("/result/state").and_then(Value::as_str) == Some("running") {
        run_preview_command(&state, &project_dir, &["--stop"]).await?;
    }
    let preview = if reusable {
        status
    } else {
        run_preview_command(
            &state,
            &project_dir,
            &["--port", &port.to_string(), "--background", "--force-new"],
        )
        .await?
    };
    let server_url = preview
        .pointer("/result/serverUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::External("HyperFrames preview 未返回服务地址".to_owned()))?;
    let name = project_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&project_id);
    let preview_url = preview
        .pointer("/result/studioUrl")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{server_url}/#project/{name}"));
    Ok(Json(StudioResponse {
        storyboard_url: format!("{server_url}/?view=storyboard#project/{name}"),
        preview_url,
    }))
}

async fn mark_agent_studio_dirty(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let mut manifest = state
        .agent_projects
        .manifest(&project_id)
        .await
        .map_err(ApiError::Project)?;
    manifest.dirty = true;
    state
        .agent_projects
        .write_manifest(&project_id, &manifest)
        .await
        .map_err(ApiError::Project)?;
    state
        .agent_projects
        .update_project(&project_id, |record| {
            record.status_label = "Studio 中有未验证的修改".to_owned();
        })
        .await
        .map_err(ApiError::Project)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn agent_project_file(
    State(state): State<AppState>,
    Path((project_id, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let project_root = fs::canonicalize(
        state
            .agent_projects
            .project_dir(&project_id)
            .map_err(ApiError::Project)?,
    )
    .await?;
    let file_path = fs::canonicalize(
        state
            .agent_projects
            .resolve_relative(&project_id, &path)
            .map_err(ApiError::Project)?,
    )
    .await?;
    if !file_path.starts_with(&project_root) {
        return Err(ApiError::BadRequest(
            "project file escapes workspace".to_owned(),
        ));
    }
    let metadata = fs::metadata(&file_path).await?;
    if !metadata.is_file() {
        return Err(ApiError::BadRequest("not a file".to_owned()));
    }
    let total = metadata.len();
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |value| value.as_secs());
    let etag = format!("\"{total:x}-{modified:x}\"");
    if headers
        .get(IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        == Some(etag.as_str())
    {
        let mut response = StatusCode::NOT_MODIFIED.into_response();
        response
            .headers_mut()
            .insert(ETAG, etag.parse().expect("etag header"));
        return Ok(response);
    }
    let mime = content_type_for_path(&file_path);
    let range = headers
        .get(RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| parse_byte_range(value, total));
    let (start, end, status) = range.map_or(
        (0, total.saturating_sub(1), StatusCode::OK),
        |(start, end)| (start, end, StatusCode::PARTIAL_CONTENT),
    );
    let length = if total == 0 { 0 } else { end - start + 1 };
    let mut file = fs::File::open(&file_path).await?;
    file.seek(std::io::SeekFrom::Start(start)).await?;
    let mut bytes = vec![0; length as usize];
    if length > 0 {
        file.read_exact(&mut bytes).await?;
    }
    let mut response = (status, bytes).into_response();
    let response_headers = response.headers_mut();
    response_headers.insert(
        CONTENT_TYPE,
        mime.parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().expect("static mime")),
    );
    response_headers.insert(ACCEPT_RANGES, "bytes".parse().expect("static header"));
    response_headers.insert(
        CONTENT_LENGTH,
        length.to_string().parse().expect("numeric header"),
    );
    response_headers.insert(ETAG, etag.parse().expect("etag header"));
    if status == StatusCode::PARTIAL_CONTENT {
        response_headers.insert(
            CONTENT_RANGE,
            format!("bytes {start}-{end}/{total}")
                .parse()
                .expect("range header"),
        );
    }
    Ok(response)
}

fn parse_byte_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let value = value.strip_prefix("bytes=")?.split(',').next()?;
    let (start, end) = value.split_once('-')?;
    if total == 0 {
        return None;
    }
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(total);
        return Some((total - suffix, total - 1));
    }
    let start = start.parse::<u64>().ok()?;
    if start >= total {
        return None;
    }
    let end = if end.is_empty() {
        total - 1
    } else {
        end.parse::<u64>().ok()?.min(total - 1)
    };
    (start <= end).then_some((start, end))
}

fn content_type_for_path(path: &FilePath) -> &'static str {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "json" => "application/json",
        "md" => "text/markdown; charset=utf-8",
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

async fn start_next_agent_turn_locked(state: AppState, project_id: String) -> Result<(), ApiError> {
    if state.agent_jobs.contains(&project_id).await {
        return Ok(());
    }
    let Some(queued) = state
        .agent_projects
        .claim_next(&project_id)
        .await
        .map_err(ApiError::Project)?
    else {
        return Ok(());
    };
    let cancellation = TurnCancellation::default();
    state
        .agent_jobs
        .insert(
            project_id.clone(),
            ActiveAgentTurn {
                cancellation: cancellation.clone(),
                request_id: queued.id.clone(),
                context: queued.context.clone(),
            },
        )
        .await;
    let run_state = state.clone();
    tokio::spawn(async move {
        run_agent_queue(run_state, project_id, queued, cancellation).await;
    });
    Ok(())
}

async fn run_agent_queue(
    state: AppState,
    project_id: String,
    mut queued: QueuedTurn,
    mut cancellation: TurnCancellation,
) {
    loop {
        run_agent_turn(&state, &project_id, queued, &cancellation).await;
        let _gate = state.agent_jobs.lock(&project_id).await;
        let next = state
            .agent_projects
            .claim_next(&project_id)
            .await
            .ok()
            .flatten();
        let Some(next) = next else {
            state.agent_jobs.remove(&project_id).await;
            break;
        };
        cancellation = TurnCancellation::default();
        state
            .agent_jobs
            .insert(
                project_id.clone(),
                ActiveAgentTurn {
                    cancellation: cancellation.clone(),
                    request_id: next.id.clone(),
                    context: next.context.clone(),
                },
            )
            .await;
        queued = next;
    }
}

async fn run_agent_turn(
    state: &AppState,
    project_id: &str,
    queued: QueuedTurn,
    cancellation: &TurnCancellation,
) {
    let mut project = match state.agent_projects.read_project(project_id).await {
        Ok(value) => value,
        Err(_) => return,
    };
    let mut thread_id = if let Some(thread_id) = project.thread_id.clone() {
        thread_id
    } else {
        let project_dir = match state.agent_projects.project_dir(project_id) {
            Ok(path) => path,
            Err(_) => return,
        };
        match state
            .codex
            .start_thread_at(&project_dir, Some(&project.model))
            .await
        {
            Ok(thread) => {
                let thread_id = thread.thread_id;
                let _ = state
                    .agent_projects
                    .update_project(project_id, |record| {
                        record.thread_id = Some(thread_id.clone())
                    })
                    .await;
                project.thread_id = Some(thread_id.clone());
                thread_id
            }
            Err(error) => {
                let _ = state
                    .agent_projects
                    .requeue_front(
                        project_id,
                        queued.clone(),
                        format!("Codex 会话启动失败：{error}"),
                    )
                    .await;
                return;
            }
        }
    };
    let manifest = state
        .agent_projects
        .manifest(project_id)
        .await
        .unwrap_or_default();
    let attachment_note = if queued.attachments.is_empty() {
        String::new()
    } else {
        format!("\n项目附件：{}", queued.attachments.join(", "))
    };
    let context_note = if queued.context.is_empty() {
        String::new()
    } else {
        format!("\n当前反馈上下文：{}", queued.context.join(" · "))
    };
    let dirty_note = if manifest.dirty {
        "\nHyperFrames Studio 或上次中断留下了未验证改动。先检查当前工作区，再决定复用或修复；不要覆盖用户的手动修改。"
    } else {
        ""
    };
    let prompt = format!(
        "用户请求：{}{}{}{}\n所有工作必须限制在当前项目目录。按照 yingya-video-agent skill 管理 checkpoint、manifest、质量检查与版本。不得在项目 turn 中安装或更新任何 skill、plugin、CLI 或全局依赖；缺少可选能力时直接使用已安装的 HyperFrames 核心能力或说明 fallback。",
        queued.text, attachment_note, context_note, dirty_note
    );
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<Value>();
    let event_store = state.agent_projects.clone();
    let event_bus = state.agent_events.clone();
    let event_project = project_id.to_owned();
    let event_task = tokio::spawn(async move {
        while let Some(raw) = event_rx.recv().await {
            let method = raw
                .get("method")
                .and_then(Value::as_str)
                .unwrap_or("codex/event")
                .to_owned();
            let turn_id = raw
                .pointer("/params/turnId")
                .or_else(|| raw.pointer("/params/turn/id"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            if let Ok(event) = event_store
                .append_event(&event_project, turn_id, method, raw)
                .await
            {
                let _ = event_bus.send(event);
            }
        }
    });
    let result = state
        .codex
        .run_turn(
            &thread_id,
            &prompt,
            &[],
            TurnOptions {
                use_imagegen: false,
                model: Some(queued.model.as_deref().unwrap_or(&project.model)),
                effort: Some(
                    queued
                        .reasoning_effort
                        .as_deref()
                        .unwrap_or(&project.reasoning_effort),
                ),
                cancellation: Some(cancellation),
                use_video_agent: true,
                event_tx: Some(event_tx.clone()),
            },
        )
        .await;
    let result = match result {
        Err(error) if is_thread_not_found(&error) && !cancellation.is_cancelled() => {
            let project_dir = match state.agent_projects.project_dir(project_id) {
                Ok(path) => path,
                Err(message) => {
                    drop(event_tx);
                    let _ = event_task.await;
                    let _ = state
                        .agent_projects
                        .update_project(project_id, |record| {
                            record.active_turn_id = None;
                            record.status = "failed".to_owned();
                            record.status_label = format!("Codex 执行失败：{message}");
                        })
                        .await;
                    return;
                }
            };
            match state
                .codex
                .start_thread_at(&project_dir, Some(&project.model))
                .await
            {
                Ok(thread) => {
                    thread_id = thread.thread_id;
                    let _ = state
                        .agent_projects
                        .update_project(project_id, |record| {
                            record.thread_id = Some(thread_id.clone());
                            record.status_label = "Codex 会话已恢复，正在继续执行".to_owned();
                        })
                        .await;
                    state
                        .codex
                        .run_turn(
                            &thread_id,
                            &prompt,
                            &[],
                            TurnOptions {
                                use_imagegen: false,
                                model: Some(queued.model.as_deref().unwrap_or(&project.model)),
                                effort: Some(
                                    queued
                                        .reasoning_effort
                                        .as_deref()
                                        .unwrap_or(&project.reasoning_effort),
                                ),
                                cancellation: Some(cancellation),
                                use_video_agent: true,
                                event_tx: Some(event_tx.clone()),
                            },
                        )
                        .await
                }
                Err(start_error) => Err(start_error),
            }
        }
        result => result,
    };
    drop(event_tx);
    let _ = event_task.await;
    if matches!(&result, Err(CodexError::InterruptTimeout(_))) {
        warn!(
            project_id,
            "Codex interrupt grace period expired; restarting app-server"
        );
        for (affected_id, active) in state.agent_jobs.active_projects().await {
            active.cancellation.cancel();
            let _ = state
                .agent_projects
                .update_message_status(&affected_id, &active.request_id, "interrupted")
                .await;
            let _ = state
                .agent_projects
                .set_queue_paused(&affected_id, true)
                .await;
        }
        if let Err(error) = state.codex.restart().await {
            warn!(%error, "failed to restart Codex app-server");
        }
    }
    match result {
        Ok(turn) => {
            let _ = state
                .agent_projects
                .update_message_status(project_id, &queued.id, "completed")
                .await;
            if !turn.text.trim().is_empty() {
                let _ = state
                    .agent_projects
                    .append_message(
                        project_id,
                        AppendAgentMessage {
                            turn_id: Some(queued.id.clone()),
                            role: "assistant".to_owned(),
                            text: turn.text,
                            attachments: vec![],
                            context: vec![],
                            status: "completed".to_owned(),
                        },
                    )
                    .await;
            }
            let mut manifest = state
                .agent_projects
                .manifest(project_id)
                .await
                .unwrap_or_default();
            let workflow = validate_completed_workflow(state, project_id, &manifest).await;
            if workflow.invalid {
                manifest.dirty = true;
                let _ = state
                    .agent_projects
                    .write_manifest(project_id, &manifest)
                    .await;
                let _ = state
                    .agent_projects
                    .append_message(
                        project_id,
                        AppendAgentMessage {
                            turn_id: Some(queued.id.clone()),
                            role: "assistant".to_owned(),
                            text: workflow.guidance.to_owned(),
                            attachments: vec![],
                            context: vec![],
                            status: "completed".to_owned(),
                        },
                    )
                    .await;
            }
            let _ = state
                .agent_projects
                .update_project(project_id, |record| {
                    record.active_turn_id = None;
                    record.queue_paused = workflow.invalid;
                    record.status = workflow.status.to_owned();
                    record.status_label = workflow.label.to_owned();
                })
                .await;
        }
        Err(error) => {
            let interrupted = matches!(
                error,
                CodexError::TurnInterrupted(_) | CodexError::InterruptTimeout(_)
            ) || cancellation.is_cancelled();
            let _ = state
                .agent_projects
                .update_message_status(
                    project_id,
                    &queued.id,
                    if interrupted { "interrupted" } else { "failed" },
                )
                .await;
            let mut manifest = state
                .agent_projects
                .manifest(project_id)
                .await
                .unwrap_or_default();
            manifest.dirty = true;
            let _ = state
                .agent_projects
                .write_manifest(project_id, &manifest)
                .await;
            let _ = state
                .agent_projects
                .update_project(project_id, |record| {
                    record.active_turn_id = None;
                    record.status = if interrupted { "interrupted" } else { "failed" }.to_owned();
                    record.status_label = if interrupted {
                        "运行已中断".to_owned()
                    } else {
                        format!("Codex 执行失败：{error}")
                    };
                })
                .await;
        }
    }
}

struct WorkflowCompletion {
    status: &'static str,
    label: &'static str,
    invalid: bool,
    guidance: &'static str,
}

async fn validate_completed_workflow(
    state: &AppState,
    project_id: &str,
    manifest: &agent_projects::AgentManifest,
) -> WorkflowCompletion {
    let checkpoint_kind = manifest
        .checkpoint
        .as_ref()
        .map(|value| value.kind.as_str());
    let checkpoint_artifacts_valid = if let Some(checkpoint) = &manifest.checkpoint {
        !checkpoint.artifact_ids.is_empty()
            && checkpoint.artifact_ids.iter().all(|id| {
                manifest
                    .artifacts
                    .iter()
                    .any(|artifact| artifact.id == *id && !artifact.path.trim().is_empty())
            })
    } else {
        false
    };
    let referenced_paths_exist = async {
        for artifact in &manifest.artifacts {
            let Ok(path) = state
                .agent_projects
                .resolve_relative(project_id, &artifact.path)
            else {
                return false;
            };
            if fs::metadata(path).await.is_err() {
                return false;
            }
        }
        true
    }
    .await;
    let draft_valid = if let Some(current) = manifest.current_draft.as_deref() {
        if let Some(version) = manifest
            .versions
            .iter()
            .find(|version| version.id == current)
        {
            let source = state
                .agent_projects
                .resolve_relative(project_id, &version.source_path);
            let video = state
                .agent_projects
                .resolve_relative(project_id, &version.video_path);
            match (source, video) {
                (Ok(source), Ok(video)) => {
                    fs::metadata(source).await.is_ok() && fs::metadata(video).await.is_ok()
                }
                _ => false,
            }
        } else {
            false
        }
    } else {
        false
    };
    let draft_source_synced = if let Some(current) = manifest.current_draft.as_deref() {
        if let Some(version) = manifest
            .versions
            .iter()
            .find(|version| version.id == current)
        {
            let snapshot = state
                .agent_projects
                .resolve_relative(project_id, &version.source_path);
            let workspace = state
                .agent_projects
                .resolve_relative(project_id, &manifest.studio_entry);
            match (snapshot, workspace) {
                (Ok(mut snapshot), Ok(workspace)) => {
                    if fs::metadata(&snapshot)
                        .await
                        .map(|metadata| metadata.is_dir())
                        .unwrap_or(false)
                    {
                        snapshot = snapshot.join("index.html");
                    }
                    match (fs::read(snapshot).await, fs::read(workspace).await) {
                        (Ok(snapshot), Ok(workspace)) => snapshot == workspace,
                        _ => false,
                    }
                }
                _ => false,
            }
        } else {
            false
        }
    } else {
        false
    };
    let completed_video_valid = manifest.artifacts.iter().any(|artifact| {
        artifact.kind.to_ascii_lowercase().contains("video") && !artifact.path.trim().is_empty()
    }) && referenced_paths_exist;

    match manifest.phase.as_str() {
        "plan_review"
            if checkpoint_kind == Some("plan")
                && checkpoint_artifacts_valid
                && referenced_paths_exist =>
        {
            WorkflowCompletion {
                status: "waiting_plan",
                label: "制作方案等待确认",
                invalid: false,
                guidance: "",
            }
        }
        "draft_review"
            if checkpoint_kind == Some("draft")
                && checkpoint_artifacts_valid
                && referenced_paths_exist
                && draft_valid
                && draft_source_synced =>
        {
            WorkflowCompletion {
                status: "draft_review",
                label: "草稿等待确认",
                invalid: false,
                guidance: "",
            }
        }
        "completed" if manifest.checkpoint.is_none() && completed_video_valid => {
            WorkflowCompletion {
                status: "completed",
                label: "高清成片已完成",
                invalid: false,
                guidance: "",
            }
        }
        "briefing"
            if manifest.artifacts.is_empty()
                && manifest.versions.is_empty()
                && !has_untracked_composition(state, project_id).await =>
        {
            WorkflowCompletion {
                status: "waiting_input",
                label: "等待补充创作信息",
                invalid: false,
                guidance: "",
            }
        }
        _ => WorkflowCompletion {
            status: "failed",
            label: "制作流程异常，已暂停",
            invalid: true,
            guidance: "检测到本次修改尚未形成与当前源码一致的可审阅版本，已暂停后续队列。请完成检查、渲染下一版视频，并把源码快照、视频和 manifest 一并登记为新的 draft 后再提交审核。",
        },
    }
}

async fn has_untracked_composition(state: &AppState, project_id: &str) -> bool {
    for relative in ["index.html", "video/index.html"] {
        if let Ok(path) = state.agent_projects.resolve_relative(project_id, relative)
            && fs::metadata(path).await.is_ok()
        {
            return true;
        }
    }
    false
}

async fn audit_existing_project_workflows(state: &AppState) {
    let Ok(projects) = state.agent_projects.list().await else {
        return;
    };
    for project in projects {
        if project.active_turn_id.is_some() {
            continue;
        }
        let Ok(mut manifest) = state.agent_projects.manifest(&project.id).await else {
            continue;
        };
        let workflow = validate_completed_workflow(state, &project.id, &manifest).await;
        if workflow.invalid && !manifest.dirty {
            manifest.dirty = true;
            let _ = state
                .agent_projects
                .write_manifest(&project.id, &manifest)
                .await;
        }
        let _ = state
            .agent_projects
            .update_project(&project.id, |record| {
                record.queue_paused = workflow.invalid;
                record.status = workflow.status.to_owned();
                record.status_label = workflow.label.to_owned();
            })
            .await;
    }
}

fn is_thread_not_found(error: &CodexError) -> bool {
    matches!(error, CodexError::Rpc(message) if message.contains("thread not found"))
}

async fn run_turn(
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
    Json(request): Json<TurnRequest>,
) -> Result<Json<TurnResponse>, ApiError> {
    execute_turn(state, thread_id, request, false).await
}

async fn generate_image(
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
    Json(request): Json<TurnRequest>,
) -> Result<Json<TurnResponse>, ApiError> {
    execute_turn(state, thread_id, request, true).await
}

async fn execute_turn(
    state: AppState,
    thread_id: String,
    request: TurnRequest,
    use_imagegen: bool,
) -> Result<Json<TurnResponse>, ApiError> {
    if request.prompt.trim().is_empty() {
        return Err(ApiError::BadRequest("prompt cannot be empty".to_owned()));
    }
    let model = request
        .model
        .as_deref()
        .unwrap_or_else(|| state.codex.model());
    let effort = request.reasoning_effort.as_deref().unwrap_or("auto");
    validate_model_settings(model, effort).map_err(ApiError::Validation)?;

    let mut reference_images = Vec::with_capacity(request.reference_images.len());
    for image in &request.reference_images {
        reference_images.push(state.assets.resolve(image).await?);
    }

    let turn = state
        .codex
        .run_turn(
            &thread_id,
            request.prompt.trim(),
            &reference_images,
            TurnOptions {
                use_imagegen,
                model: Some(model),
                effort: Some(effort),
                cancellation: None,
                use_video_agent: false,
                event_tx: None,
            },
        )
        .await?;
    let images = state.assets.import_generated(turn.generated_images).await?;

    Ok(Json(TurnResponse {
        thread_id: turn.thread_id,
        turn_id: turn.turn_id,
        status: turn.status,
        text: turn.text,
        images,
    }))
}

async fn upload_image(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, ApiError> {
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
    {
        if field.name() != Some("file") {
            continue;
        }

        let extension = image_extension(field.file_name(), field.content_type())?;
        let bytes = field
            .bytes()
            .await
            .map_err(|error| ApiError::BadRequest(error.to_string()))?;
        if bytes.is_empty() {
            return Err(ApiError::BadRequest("uploaded image is empty".to_owned()));
        }
        if !has_image_signature(extension, &bytes) {
            return Err(ApiError::BadRequest(
                "uploaded file content does not match its image format".to_owned(),
            ));
        }

        let relative = format!("uploads/{}.{}", Uuid::new_v4(), extension);
        let destination = state.assets.root.join(&relative);
        fs::write(&destination, bytes).await?;
        return Ok(Json(UploadResponse {
            url: format!("/assets/{relative}"),
            hyperframes_path: format!("assets/{relative}"),
        }));
    }

    Err(ApiError::BadRequest(
        "multipart field `file` is required".to_owned(),
    ))
}

async fn search_heygen_audio(
    State(state): State<AppState>,
    Query(request): Query<HeyGenAudioSearchQuery>,
) -> Result<Json<HeyGenAudioSearchResponse>, ApiError> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err(ApiError::BadRequest("音频搜索描述不能为空".to_owned()));
    }
    let audio_type = normalize_audio_type(&request.audio_type)?;
    let limit = request.limit.clamp(1, 20);
    let min_score = request.min_score.unwrap_or(0.7).clamp(0.0, 1.0);
    Ok(Json(
        state
            .heygen
            .search_audio(query, audio_type, limit, min_score)
            .await?,
    ))
}

async fn run_preview_command(
    state: &AppState,
    project_dir: &FilePath,
    arguments: &[&str],
) -> Result<Value, ApiError> {
    let mut command = Command::new(state.root.join("node_modules/.bin/hyperframes"));
    command
        .arg("preview")
        .args(arguments)
        .args(["--json", "--no-open"])
        .current_dir(project_dir)
        .env("HOME", state.hyperframes_home.as_ref())
        .env("HYPERFRAMES_PREVIEW_HOST", "0.0.0.0")
        .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| ApiError::External("HyperFrames preview 启动超时".to_owned()))??;
    if !output.status.success() {
        return Err(ApiError::External(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
        .ok_or_else(|| ApiError::External("HyperFrames preview 返回了无效状态".to_owned()))
}

fn default_audio_type() -> String {
    "music".to_owned()
}

fn default_audio_limit() -> u8 {
    10
}

fn normalize_audio_type(value: &str) -> Result<&'static str, ApiError> {
    match value {
        "music" => Ok("music"),
        "sound_effects" => Ok("sound_effects"),
        _ => Err(ApiError::Validation(
            "音频类型必须是 music 或 sound_effects".to_owned(),
        )),
    }
}

fn audio_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"RIFF") && bytes.get(8..12).is_some_and(|part| part == b"WAVE") {
        Some("wav")
    } else if bytes.starts_with(b"ID3")
        || bytes
            .get(..2)
            .is_some_and(|part| part[0] == 0xff && part[1] & 0xe0 == 0xe0)
    {
        Some("mp3")
    } else if bytes.starts_with(b"OggS") {
        Some("ogg")
    } else if bytes.get(4..8).is_some_and(|part| part == b"ftyp") {
        Some("m4a")
    } else {
        None
    }
}

impl AssetStore {
    async fn new(root: PathBuf) -> Result<Self, std::io::Error> {
        fs::create_dir_all(root.join("uploads")).await?;
        fs::create_dir_all(root.join("generated")).await?;
        Ok(Self {
            root: Arc::new(root.canonicalize()?),
        })
    }

    async fn resolve(&self, public_path: &str) -> Result<PathBuf, ApiError> {
        let relative = public_path
            .strip_prefix("/assets/")
            .or_else(|| public_path.strip_prefix("assets/"))
            .ok_or_else(|| {
                ApiError::BadRequest(
                    "referenceImages entries must start with /assets/ or assets/".to_owned(),
                )
            })?;
        let resolved = fs::canonicalize(self.root.join(relative)).await?;
        if !resolved.starts_with(self.root.as_ref()) || !resolved.is_file() {
            return Err(ApiError::BadRequest(
                "reference image is outside the assets directory".to_owned(),
            ));
        }
        Ok(resolved)
    }

    async fn import_generated(
        &self,
        events: Vec<GeneratedImageEvent>,
    ) -> Result<Vec<ImageAsset>, ApiError> {
        let mut assets = Vec::new();
        for event in events {
            let Some(source) = event.saved_path else {
                if event.status == "failed" {
                    continue;
                }
                return Err(ApiError::Codex(CodexError::MissingGeneratedImage(
                    event.failure.unwrap_or_else(|| event.id.clone()),
                )));
            };
            let extension = generated_extension(&source)?;
            let filename = format!("{}.{}", Uuid::new_v4(), extension);
            let destination = self.root.join("generated").join(&filename);
            fs::copy(&source, &destination).await?;
            let relative = format!("generated/{filename}");
            assets.push(ImageAsset {
                id: event.id,
                url: format!("/assets/{relative}"),
                hyperframes_path: format!("assets/{relative}"),
                mime_type: image_mime(extension).to_owned(),
                revised_prompt: event.revised_prompt,
            });
        }
        Ok(assets)
    }
}

fn image_extension(
    file_name: Option<&str>,
    content_type: Option<&str>,
) -> Result<&'static str, ApiError> {
    let extension = file_name
        .and_then(|name| FilePath::new(name).extension())
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);
    match (extension.as_deref(), content_type) {
        (Some("png"), _) | (_, Some("image/png")) => Ok("png"),
        (Some("jpg" | "jpeg"), _) | (_, Some("image/jpeg")) => Ok("jpg"),
        (Some("webp"), _) | (_, Some("image/webp")) => Ok("webp"),
        (Some("gif"), _) | (_, Some("image/gif")) => Ok("gif"),
        (Some("avif"), _) | (_, Some("image/avif")) => Ok("avif"),
        _ => Err(ApiError::BadRequest(
            "supported image formats: png, jpg, webp, gif, avif".to_owned(),
        )),
    }
}

fn generated_extension(path: &FilePath) -> Result<&str, ApiError> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "png" => Ok("png"),
        "jpg" | "jpeg" => Ok("jpg"),
        "webp" => Ok("webp"),
        "gif" => Ok("gif"),
        "avif" => Ok("avif"),
        _ => Err(ApiError::External(format!(
            "Codex generated an unsupported image format: {}",
            path.display()
        ))),
    }
}

fn image_mime(extension: &str) -> &'static str {
    match extension {
        "jpg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "avif" => "image/avif",
        _ => "image/png",
    }
}

fn has_image_signature(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "jpg" => bytes.starts_with(b"\xff\xd8\xff"),
        "webp" => {
            bytes.starts_with(b"RIFF") && bytes.get(8..12).is_some_and(|part| part == b"WEBP")
        }
        "gif" => bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a"),
        "avif" => bytes.get(4..12).is_some_and(|part| {
            part.starts_with(b"ftyp") && (part.ends_with(b"avif") || part.ends_with(b"avis"))
        }),
        _ => false,
    }
}

fn env_path(name: &str, fallback: PathBuf) -> PathBuf {
    env::var_os(name).map(PathBuf::from).unwrap_or(fallback)
}

fn env_bool(name: &str, fallback: bool) -> bool {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

fn env_u64(name: &str, fallback: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(fallback)
}

async fn discover_hyperframes_browser(
    root: &FilePath,
    hyperframes_home: &FilePath,
) -> Option<PathBuf> {
    if let Some(path) = env::var_os("YINGYA_HYPERFRAMES_BROWSER_PATH") {
        return Some(PathBuf::from(path));
    }

    let output = tokio::process::Command::new(root.join("node_modules/.bin/hyperframes"))
        .args(["browser", "path"])
        .env("HOME", hyperframes_home)
        .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let path = PathBuf::from(String::from_utf8(output.stdout).ok()?.trim());
    path.is_file().then_some(path)
}

enum ApiError {
    BadRequest(String),
    Validation(String),
    NotFound(String),
    Conflict(String),
    Project(String),
    External(String),
    Codex(CodexError),
    Io(std::io::Error),
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadRequest(message)
            | Self::Validation(message)
            | Self::NotFound(message)
            | Self::Conflict(message)
            | Self::Project(message)
            | Self::External(message) => formatter.write_str(message),
            Self::Codex(error) => error.fmt(formatter),
            Self::Io(error) => error.fmt(formatter),
        }
    }
}

impl From<CodexError> for ApiError {
    fn from(error: CodexError) -> Self {
        Self::Codex(error)
    }
}

impl From<HeyGenError> for ApiError {
    fn from(error: HeyGenError) -> Self {
        Self::External(error.to_string())
    }
}

impl From<std::io::Error> for ApiError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code, message) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, "bad_request", message),
            Self::Validation(message) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_error",
                message,
            ),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, "not_found", message),
            Self::Conflict(message) => (StatusCode::CONFLICT, "conflict", message),
            Self::Project(message) if is_not_found_message(&message) => {
                (StatusCode::NOT_FOUND, "not_found", message)
            }
            Self::Project(message) if message.starts_with("invalid ") => (
                StatusCode::UNPROCESSABLE_ENTITY,
                "validation_error",
                message,
            ),
            Self::Project(message) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "project_store_error",
                message,
            ),
            Self::External(message) => (StatusCode::BAD_GATEWAY, "external_service_error", message),
            Self::Codex(error) => (StatusCode::BAD_GATEWAY, "codex_error", error.to_string()),
            Self::Io(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (StatusCode::NOT_FOUND, "not_found", error.to_string())
            }
            Self::Io(error) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "io_error",
                error.to_string(),
            ),
        };
        (status, Json(json!({ "code": code, "message": message }))).into_response()
    }
}

fn is_not_found_message(message: &str) -> bool {
    message.contains("No such file")
        || message.starts_with("unknown ")
        || message.contains("not found")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn installs_bundled_video_agent_into_codex_home() {
        let root = env::temp_dir().join(format!("yingya-skill-test-{}", Uuid::new_v4()));
        let resources = root.join("resources");
        let codex_home = root.join("codex-home");
        fs::create_dir_all(resources.join("skills/yingya-video-agent/agents"))
            .await
            .unwrap();
        fs::write(
            resources.join("skills/yingya-video-agent/SKILL.md"),
            "---\nname: yingya-video-agent\ndescription: test\n---\n",
        )
        .await
        .unwrap();
        fs::write(
            resources.join("skills/yingya-video-agent/agents/openai.yaml"),
            "interface:\n  display_name: \"Yingya\"\n",
        )
        .await
        .unwrap();

        let installed = install_bundled_video_agent_skill(&resources, &codex_home)
            .await
            .unwrap();

        assert_eq!(
            installed,
            codex_home.join("skills/yingya-video-agent/SKILL.md")
        );
        assert!(installed.is_file());
        assert!(
            codex_home
                .join("skills/yingya-video-agent/agents/openai.yaml")
                .is_file()
        );
        fs::remove_dir_all(root).await.unwrap();
    }

    #[test]
    fn recognizes_missing_codex_threads_for_recovery() {
        assert!(is_thread_not_found(&CodexError::Rpc(
            "thread not found: stale-thread".to_owned()
        )));
        assert!(!is_thread_not_found(&CodexError::Rpc(
            "model unavailable".to_owned()
        )));
    }

    #[test]
    fn recognizes_supported_image_signatures() {
        assert!(has_image_signature("png", b"\x89PNG\r\n\x1a\nrest"));
        assert!(has_image_signature("jpg", b"\xff\xd8\xffrest"));
        assert!(has_image_signature("webp", b"RIFF0000WEBPrest"));
        assert!(!has_image_signature("png", b"not an image"));
    }

    #[test]
    fn recognizes_supported_audio_signatures() {
        assert_eq!(
            audio_extension(b"RIFF0000WAVErest of a wav file"),
            Some("wav")
        );
        assert_eq!(audio_extension(b"ID3rest of an mp3 file"), Some("mp3"));
        assert_eq!(audio_extension(b"\xff\xfbrest of an mp3 file"), Some("mp3"));
        assert_eq!(audio_extension(b"OggSrest of an ogg file"), Some("ogg"));
        assert_eq!(audio_extension(b"0000ftyprest of an m4a file"), Some("m4a"));
        assert_eq!(audio_extension(b"not audio"), None);
    }

    #[test]
    fn validates_heygen_audio_types() {
        assert_eq!(normalize_audio_type("music").ok(), Some("music"));
        assert_eq!(
            normalize_audio_type("sound_effects").ok(),
            Some("sound_effects")
        );
        assert!(normalize_audio_type("voice").is_err());
    }

    #[test]
    fn parses_video_byte_ranges() {
        assert_eq!(parse_byte_range("bytes=0-99", 1_000), Some((0, 99)));
        assert_eq!(parse_byte_range("bytes=900-", 1_000), Some((900, 999)));
        assert_eq!(parse_byte_range("bytes=-100", 1_000), Some((900, 999)));
        assert_eq!(parse_byte_range("bytes=1000-", 1_000), None);
        assert_eq!(parse_byte_range("items=0-10", 1_000), None);
    }
}
