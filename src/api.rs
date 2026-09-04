use std::{
    env,
    net::SocketAddr,
    path::{Path as FilePath, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::agent_jobs::{ActiveAgentTurn, ActiveRenderJob, AgentJobCoordinator};
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
use crate::render_jobs::{RenderJob, RenderJobStatus, RenderJobStore};
use crate::studio_sessions::{StudioSession, StudioSessionManager};
use crate::voices::{UploadedVoice, VoiceClient, VoiceError, VoiceList};
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
use sha2::{Digest, Sha256};
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, BufReader},
    net::TcpListener,
    process::Command,
    sync::{broadcast, mpsc},
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
    root: Arc<PathBuf>,
    hyperframes_home: Arc<PathBuf>,
    agent_projects: AgentProjectStore,
    agent_events: broadcast::Sender<AgentEvent>,
    agent_jobs: AgentJobCoordinator,
    render_jobs: RenderJobStore,
    studio_sessions: StudioSessionManager,
    voices: VoiceClient,
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
struct UpdateAgentProjectRequest {
    title: Option<String>,
    #[serde(rename = "voiceId")]
    voice_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceDesignRequest {
    name: String,
    description: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoicePreviewRequest {
    voice_id: String,
    #[serde(default = "default_voice_preview_text")]
    text: String,
}

fn default_voice_preview_text() -> String {
    "你好，我是映芽为这个项目选定的声音。之后的旁白都会保持这一音色。".to_owned()
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageLibraryMetadata {
    id: String,
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    source_name: Option<String>,
    kind: String,
    created_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageLibraryAsset {
    id: String,
    url: String,
    hyperframes_path: String,
    mime_type: String,
    prompt: Option<String>,
    source_name: Option<String>,
    kind: String,
    created_at: u64,
}

#[derive(Debug, Serialize)]
struct ImageLibraryResponse {
    images: Vec<ImageLibraryAsset>,
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
    state: String,
    host: String,
    port: u16,
    project_name: String,
    last_seen_at: u64,
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
    job_id: String,
    status: String,
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
    let voices = VoiceClient::from_env()?;
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
    let render_jobs = RenderJobStore::new(paths.projects.clone());
    let studio_sessions = StudioSessionManager::new(
        root.join("node_modules/.bin/hyperframes"),
        paths.hyperframes_home.clone(),
        paths.projects.clone(),
    );
    let state = AppState {
        codex,
        heygen,
        assets,
        root: Arc::new(root.clone()),
        hyperframes_home: Arc::new(paths.hyperframes_home.clone()),
        agent_projects,
        agent_events,
        agent_jobs: AgentJobCoordinator::default(),
        render_jobs,
        studio_sessions,
        voices,
    };
    audit_existing_project_workflows(&state).await;
    reconcile_render_jobs(&state).await;
    if let Err(error) = state.studio_sessions.adopt_existing().await {
        warn!(%error, "failed to adopt existing HyperFrames Studio sessions");
    }
    spawn_studio_maintenance(state.clone());
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
        .route("/api/assets/images", get(list_images).post(upload_image))
        .route("/api/heygen/audio", get(search_heygen_audio))
        .route("/api/voices", get(list_voices).post(clone_voice))
        .route("/api/voices/design", post(design_voice))
        .route("/api/voices/preview", post(preview_voice))
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
            post(start_agent_studio).delete(stop_agent_studio),
        )
        .route(
            "/api/agent-projects/{project_id}/studio/heartbeat",
            post(heartbeat_agent_studio),
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
    if state.agent_jobs.active_render(&project_id).await.is_some() {
        return Err(ApiError::Conflict(
            "项目正在渲染成片，请等待渲染结束后再删除".to_owned(),
        ));
    }
    state
        .studio_sessions
        .stop(&project_id)
        .await
        .map_err(ApiError::External)?;
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
    Json(request): Json<UpdateAgentProjectRequest>,
) -> Result<Json<AgentProjectRecord>, ApiError> {
    if request.title.is_none() && request.voice_id.is_none() {
        return Err(ApiError::BadRequest("没有需要更新的项目设置".to_owned()));
    }
    let mut project = if let Some(title) = request.title {
        let title = title.trim();
        if title.is_empty() {
            return Err(ApiError::BadRequest("项目标题不能为空".to_owned()));
        }
        if title.chars().count() > 48 {
            return Err(ApiError::BadRequest(
                "项目标题不能超过 48 个字符".to_owned(),
            ));
        }
        let title = title.to_owned();
        state
            .agent_projects
            .update_project(&project_id, |record| record.title = title)
            .await
            .map_err(ApiError::Project)?
    } else {
        state
            .agent_projects
            .read_project(&project_id)
            .await
            .map_err(ApiError::Project)?
    };
    if let Some(voice_id) = request.voice_id {
        let voice_id = validate_voice_name(&voice_id)?;
        if voice_id != "default" && !state.voices.exists(&voice_id).await? {
            return Err(ApiError::Validation(format!(
                "音色“{voice_id}”不存在或已被删除"
            )));
        }
        project = state
            .agent_projects
            .update_voice(&project_id, voice_id)
            .await
            .map_err(ApiError::Project)?;
    }
    emit_agent_state_event(&state, &project_id, None, "project/updated").await;
    Ok(Json(project))
}

async fn list_voices(State(state): State<AppState>) -> Result<Json<VoiceList>, ApiError> {
    Ok(Json(state.voices.list().await?))
}

async fn design_voice(
    State(state): State<AppState>,
    Json(request): Json<VoiceDesignRequest>,
) -> Result<Json<UploadedVoice>, ApiError> {
    let name = validate_voice_name(&request.name)?;
    let description = request.description.trim();
    if description.chars().count() < 4 || description.chars().count() > 200 {
        return Err(ApiError::Validation("音色描述需要 4–200 个字符".to_owned()));
    }
    if state.voices.exists(&name).await? {
        return Err(ApiError::Conflict(format!("音色“{name}”已经存在")));
    }
    Ok(Json(state.voices.create_design(&name, description).await?))
}

async fn clone_voice(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<UploadedVoice>, ApiError> {
    let mut name = None;
    let mut description = None;
    let mut ref_text = None;
    let mut authorized = false;
    let mut audio = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?
    {
        match field.name() {
            Some("name") => name = Some(field.text().await.map_err(bad_multipart)?),
            Some("description") => description = Some(field.text().await.map_err(bad_multipart)?),
            Some("refText") => ref_text = Some(field.text().await.map_err(bad_multipart)?),
            Some("authorized") => authorized = field.text().await.map_err(bad_multipart)? == "true",
            Some("audio") => {
                let filename = field.file_name().unwrap_or("voice.wav").to_owned();
                let mime_type = field.content_type().unwrap_or("audio/wav").to_owned();
                let bytes = field.bytes().await.map_err(bad_multipart)?.to_vec();
                audio = Some((filename, mime_type, bytes));
            }
            _ => {}
        }
    }
    if !authorized {
        return Err(ApiError::Validation(
            "创建克隆音色前需要确认已获得声音所有者授权".to_owned(),
        ));
    }
    let name = validate_voice_name(name.as_deref().unwrap_or_default())?;
    if state.voices.exists(&name).await? {
        return Err(ApiError::Conflict(format!("音色“{name}”已经存在")));
    }
    let ref_text = ref_text.unwrap_or_default();
    if ref_text.trim().is_empty() || ref_text.chars().count() > 500 {
        return Err(ApiError::Validation(
            "请填写参考音频的准确文字，最多 500 个字符".to_owned(),
        ));
    }
    let description = description.unwrap_or_default();
    if description.chars().count() > 200 {
        return Err(ApiError::Validation(
            "音色描述不能超过 200 个字符".to_owned(),
        ));
    }
    let (filename, mime_type, bytes) =
        audio.ok_or_else(|| ApiError::BadRequest("请选择参考音频".to_owned()))?;
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return Err(ApiError::Validation(
            "参考音频需要是 1–30 秒且不超过 10 MB 的清晰人声".to_owned(),
        ));
    }
    Ok(Json(
        state
            .voices
            .upload(
                &name,
                description.trim(),
                ref_text.trim(),
                "yingya-user-authorized",
                &filename,
                &mime_type,
                bytes,
            )
            .await?,
    ))
}

async fn preview_voice(
    State(state): State<AppState>,
    Json(request): Json<VoicePreviewRequest>,
) -> Result<Response, ApiError> {
    let voice_id = validate_voice_name(&request.voice_id)?;
    let text = request.text.trim();
    if text.is_empty() || text.chars().count() > 120 {
        return Err(ApiError::Validation("试听文字需要 1–120 个字符".to_owned()));
    }
    let audio = state.voices.synthesize(&voice_id, text).await?;
    Ok(([(CONTENT_TYPE, "audio/wav")], audio).into_response())
}

fn validate_voice_name(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > 32
        || value
            .chars()
            .any(|character| matches!(character, '/' | '\\' | '\0'))
    {
        return Err(ApiError::Validation(
            "音色名称需要 1–32 个字符，且不能包含路径符号".to_owned(),
        ));
    }
    Ok(value.to_owned())
}

fn bad_multipart(error: axum::extract::multipart::MultipartError) -> ApiError {
    ApiError::BadRequest(error.to_string())
}

async fn get_agent_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<AgentProjectDetail>, ApiError> {
    Ok(Json(load_project_detail(&state, &project_id).await?))
}

async fn create_agent_project(
    State(state): State<AppState>,
    Json(request): Json<CreateAgentProjectRequest>,
) -> Result<Json<AgentProjectDetail>, ApiError> {
    validate_model_settings(&request.model, &request.reasoning_effort)
        .map_err(ApiError::Validation)?;
    let voice_id = validate_voice_name(&request.voice_id)?;
    if voice_id != "default" && !state.voices.exists(&voice_id).await? {
        return Err(ApiError::Validation(format!(
            "音色“{voice_id}”不存在或已被删除"
        )));
    }
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
    Ok(Json(load_project_detail(&state, &project.id).await?))
}

async fn load_project_detail(
    state: &AppState,
    project_id: &str,
) -> Result<AgentProjectDetail, ApiError> {
    let mut detail = state
        .agent_projects
        .get(project_id)
        .await
        .map_err(ApiError::Project)?;
    detail.render_jobs = state
        .render_jobs
        .list(project_id, 10)
        .await
        .map_err(ApiError::Project)?;
    Ok(detail)
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
    let mut scaffold_files = Vec::new();
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
        if checkpoint.kind == "plan" {
            scaffold_files = ensure_hyperframes_scaffold(
                &state,
                &project_id,
                &detail.project.aspect_ratio,
                &manifest.output_spec,
            )
            .await?;
        }
        if let Err(error) = state
            .agent_projects
            .write_manifest(&project_id, &manifest)
            .await
        {
            for path in scaffold_files {
                let _ = fs::remove_file(path).await;
            }
            return Err(ApiError::Project(error));
        }
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
        for path in scaffold_files {
            let _ = fs::remove_file(path).await;
        }
    }
    accepted
}

async fn ensure_hyperframes_scaffold(
    state: &AppState,
    project_id: &str,
    aspect_ratio: &str,
    output_spec: &Value,
) -> Result<Vec<PathBuf>, ApiError> {
    let project_dir = state
        .agent_projects
        .project_dir(project_id)
        .map_err(ApiError::Project)?;
    write_hyperframes_scaffold(&project_dir, project_id, aspect_ratio, output_spec).await
}

async fn write_hyperframes_scaffold(
    project_dir: &FilePath,
    project_id: &str,
    aspect_ratio: &str,
    output_spec: &Value,
) -> Result<Vec<PathBuf>, ApiError> {
    let (width, height) = match aspect_ratio {
        "9:16" => (1080, 1920),
        "1:1" => (1080, 1080),
        _ => (1920, 1080),
    };
    let duration = output_spec
        .get("durationSeconds")
        .or_else(|| output_spec.get("duration"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(10.0);
    let config = format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",
            "paths": {
                "blocks": "compositions",
                "components": "compositions/components",
                "assets": "assets"
            },
            "media": { "autoProxy": true }
        }))
        .map_err(|error| ApiError::External(error.to_string()))?
    );
    let metadata = format!(
        "{}\n",
        serde_json::to_string_pretty(&json!({
            "id": project_id,
            "name": project_id,
            "createdAt": unix_millis(SystemTime::now())
        }))
        .map_err(|error| ApiError::External(error.to_string()))?
    );
    let html = format!(
        r#"<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={width}, height={height}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * {{ box-sizing: border-box; }}
      html, body {{ margin: 0; width: {width}px; height: {height}px; overflow: hidden; background: #000; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{duration}" data-width="{width}" data-height="{height}"></div>
    <script>
      window.__timelines = window.__timelines || {{}};
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
"#
    );
    let mut created = Vec::new();
    for (name, contents) in [
        ("hyperframes.json", config),
        ("meta.json", metadata),
        ("index.html", html),
    ] {
        let path = project_dir.join(name);
        if fs::metadata(&path).await.is_err() {
            if let Err(error) = fs::write(&path, contents).await {
                for created_path in &created {
                    let _ = fs::remove_file(created_path).await;
                }
                return Err(ApiError::Io(error));
            }
            created.push(path);
        }
    }
    Ok(created)
}

async fn render_agent_video(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<RenderAgentVideoRequest>,
) -> Result<(StatusCode, Json<RenderAgentVideoResponse>), ApiError> {
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
    if let Some(render) = state.agent_jobs.active_render(&project_id).await {
        return Err(ApiError::Conflict(format!(
            "项目已有渲染任务正在运行：{}",
            render.id
        )));
    }

    let manifest = state
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
    if fs::metadata(&source).await.is_err() {
        return Err(ApiError::NotFound("草稿源文件不存在，无法渲染".to_owned()));
    }
    let source_dir = if fs::metadata(&source).await?.is_dir() {
        source.clone()
    } else {
        source
            .parent()
            .ok_or_else(|| ApiError::Validation("草稿源文件路径无效".to_owned()))?
            .to_path_buf()
    };
    let project_dir = state
        .agent_projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    let canonical_project = fs::canonicalize(&project_dir).await?;
    let canonical_source = fs::canonicalize(&source_dir).await?;
    if !canonical_source.starts_with(&canonical_project) {
        return Err(ApiError::Validation(
            "草稿源目录不能通过软链接指向项目外部".to_owned(),
        ));
    }

    let job_id = Uuid::new_v4().to_string();
    let relative_output =
        render_output_relative_path(&version.id, resolution, request.fps, &job_id);
    let output_path = state
        .agent_projects
        .resolve_relative(&project_id, &relative_output)
        .map_err(ApiError::Project)?;
    let temporary_output = project_dir
        .join(".yingya/exports/.tmp")
        .join(format!("{job_id}.partial.mp4"));
    if let Some(parent) = temporary_output.parent() {
        fs::create_dir_all(parent).await?;
    }
    ensure_render_output_parents(
        &canonical_project,
        [output_path.as_path(), temporary_output.as_path()],
    )
    .await?;
    state
        .agent_jobs
        .insert_render(project_id.clone(), ActiveRenderJob { id: job_id.clone() })
        .await
        .map_err(|active| ApiError::Conflict(format!("项目已有渲染任务正在运行：{}", active.id)))?;
    let started_at = agent_projects::now_millis();
    let queued_job = RenderJob::queued(
        job_id.clone(),
        version.id.clone(),
        resolution.to_owned(),
        request.fps,
        started_at,
    );
    if let Err(error) = state.render_jobs.create(&project_id, queued_job).await {
        state.agent_jobs.remove_render(&project_id).await;
        return Err(ApiError::Project(error));
    }
    if let Err(error) = state
        .agent_projects
        .update_project(&project_id, |record| {
            record.status = "rendering".to_owned();
            record.status_label = format!("正在渲染 {} 成片", resolution_label);
        })
        .await
    {
        state.agent_jobs.remove_render(&project_id).await;
        return Err(ApiError::Project(error));
    }
    if let Err(error) = update_render_job(&state, &project_id, &job_id, "render/started", |job| {
        job.status = RenderJobStatus::Running;
        job.progress = 5;
        job.message = "正在准备渲染环境".to_owned();
    })
    .await
    {
        state.agent_jobs.remove_render(&project_id).await;
        return Err(ApiError::Project(error));
    }
    emit_agent_state_event(&state, &project_id, None, "project/updated").await;

    let render_state = state.clone();
    let render_project_id = project_id.clone();
    let render_job_id = job_id.clone();
    let render_resolution = resolution.to_owned();
    let render_resolution_pixels = resolution_pixels.to_owned();
    let render_resolution_label = resolution_label.to_owned();
    tokio::spawn(async move {
        run_render_job(
            render_state,
            render_project_id,
            render_job_id,
            version,
            canonical_source,
            temporary_output,
            output_path,
            relative_output,
            render_resolution,
            render_resolution_pixels,
            render_resolution_label,
            request.fps,
        )
        .await;
    });

    Ok((
        StatusCode::ACCEPTED,
        Json(RenderAgentVideoResponse {
            job_id,
            status: "rendering".to_owned(),
            resolution: resolution_pixels.to_owned(),
            fps: request.fps,
        }),
    ))
}

#[allow(clippy::too_many_arguments)]
async fn run_render_job(
    state: AppState,
    project_id: String,
    job_id: String,
    version: agent_projects::DraftVersion,
    source_dir: PathBuf,
    temporary_output: PathBuf,
    output_path: PathBuf,
    relative_output: String,
    resolution: String,
    resolution_pixels: String,
    resolution_label: String,
    fps: u16,
) {
    let _ = update_render_job(&state, &project_id, &job_id, "render/progress", |job| {
        job.progress = 8;
        job.message = "正在检查草稿源文件".to_owned();
    })
    .await;
    let result = async {
        preflight_render_source(&state, &project_id, &job_id, &version, &source_dir).await?;
        update_render_job(&state, &project_id, &job_id, "render/progress", |job| {
            job.progress = 12;
            job.message = "正在捕获 HyperFrames 画面".to_owned();
        })
        .await?;
        run_render_command(
            &state,
            &project_id,
            &job_id,
            &source_dir,
            &temporary_output,
            &resolution,
            fps,
        )
        .await?;
        verify_render_output(&temporary_output).await?;
        fs::rename(&temporary_output, &output_path)
            .await
            .map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    }
    .await;

    let _gate = state.agent_jobs.lock(&project_id).await;
    match result {
        Ok(())
            if fs::metadata(&output_path)
                .await
                .is_ok_and(|value| value.is_file()) =>
        {
            let _ = update_render_job(&state, &project_id, &job_id, "render/progress", |job| {
                job.progress = 96;
                job.message = "正在登记成片".to_owned();
            })
            .await;
            let completion = async {
                let original_manifest = state.agent_projects.manifest(&project_id).await?;
                let mut manifest = original_manifest.clone();
                let label = format!(
                    "{} · {} · {} FPS 成片",
                    version.label, resolution_label, fps
                );
                let artifact_id = format!("final-{job_id}");
                manifest.artifacts.push(AgentArtifact {
                    id: artifact_id,
                    kind: "final-video".to_owned(),
                    label,
                    path: relative_output.clone(),
                    version: Some(version.id),
                    metadata: json!({
                        "quality": "high",
                        "frameRate": fps,
                        "resolution": resolution_pixels,
                        "renderJobId": job_id,
                    }),
                });
                if let Some(output_spec) = manifest.output_spec.as_object_mut() {
                    output_spec.insert("finalQuality".to_owned(), Value::String("high".to_owned()));
                    output_spec.insert("frameRate".to_owned(), Value::from(fps));
                    output_spec.insert("resolution".to_owned(), Value::String(resolution_pixels));
                }
                if !manifest.dirty {
                    manifest.checkpoint = None;
                    manifest.phase = "completed".to_owned();
                }
                let dirty = manifest.dirty;
                state
                    .agent_projects
                    .write_manifest(&project_id, &manifest)
                    .await?;
                if let Err(error) = state
                    .agent_projects
                    .update_project(&project_id, |record| {
                        record.status = if dirty { "draft_review" } else { "completed" }.to_owned();
                        record.status_label = if dirty {
                            "成片已生成，工作区修改待检查".to_owned()
                        } else {
                            format!("{} 成片已完成", resolution_label)
                        };
                    })
                    .await
                {
                    let _ = state
                        .agent_projects
                        .write_manifest(&project_id, &original_manifest)
                        .await;
                    return Err(error);
                }
                Ok::<(), String>(())
            }
            .await;
            match completion {
                Ok(()) => {
                    let ended_at = agent_projects::now_millis();
                    let _ = update_render_job(
                        &state,
                        &project_id,
                        &job_id,
                        "render/completed",
                        |job| {
                            job.status = RenderJobStatus::Completed;
                            job.progress = 100;
                            job.message = "成片渲染完成".to_owned();
                            job.output_path = Some(relative_output.clone());
                            job.error = None;
                            job.ended_at = Some(ended_at);
                        },
                    )
                    .await;
                }
                Err(error) => {
                    remove_temporary_render_output(&output_path).await;
                    finish_failed_render(&state, &project_id, &job_id, &error).await;
                }
            }
        }
        Ok(()) => {
            remove_temporary_render_output(&output_path).await;
            finish_failed_render(
                &state,
                &project_id,
                &job_id,
                "HyperFrames 未生成预期的视频文件",
            )
            .await;
        }
        Err(error) => {
            finish_failed_render(&state, &project_id, &job_id, &error).await;
        }
    }
    remove_temporary_render_output(&temporary_output).await;
    state.agent_jobs.remove_render(&project_id).await;
    emit_agent_state_event(&state, &project_id, None, "project/updated").await;
    if let Err(error) = start_next_agent_turn_locked(state.clone(), project_id.clone()).await {
        warn!(%project_id, %error, "failed to resume queued agent turn after render");
    }
}

fn render_output_relative_path(
    version_id: &str,
    resolution: &str,
    fps: u16,
    job_id: &str,
) -> String {
    format!(".yingya/exports/{version_id}-{resolution}-{fps}fps-{job_id}.mp4")
}

async fn remove_temporary_render_output(path: &FilePath) {
    if fs::try_exists(path).await.unwrap_or(false) {
        let _ = fs::remove_file(path).await;
    }
}

async fn ensure_render_output_parents<'a>(
    canonical_project: &FilePath,
    paths: impl IntoIterator<Item = &'a FilePath>,
) -> Result<(), ApiError> {
    for parent in paths.into_iter().filter_map(FilePath::parent) {
        let canonical_parent = fs::canonicalize(parent).await?;
        if !canonical_parent.starts_with(canonical_project) {
            return Err(ApiError::Validation(
                "渲染输出目录不能通过软链接指向项目外部".to_owned(),
            ));
        }
    }
    Ok(())
}

async fn finish_failed_render(state: &AppState, project_id: &str, job_id: &str, error: &str) {
    let message = truncate_status(error, 320);
    let _ = state
        .agent_projects
        .update_project(project_id, |record| {
            record.status = "draft_review".to_owned();
            record.status_label = "成片渲染失败，可重试".to_owned();
        })
        .await;
    let ended_at = agent_projects::now_millis();
    let _ = update_render_job(state, project_id, job_id, "render/failed", |job| {
        job.status = RenderJobStatus::Failed;
        job.progress = 0;
        job.message = "成片渲染失败，可重试".to_owned();
        job.error = Some(message.clone());
        job.ended_at = Some(ended_at);
    })
    .await;
}

async fn preflight_render_source(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    version: &agent_projects::DraftVersion,
    source_dir: &FilePath,
) -> Result<(), String> {
    reject_source_symlinks(source_dir).await?;
    for name in ["index.html", "hyperframes.json", "meta.json"] {
        let path = source_dir.join(name);
        match fs::symlink_metadata(&path).await {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("草稿源文件不能是软链接：{name}"));
            }
            Ok(metadata) if !metadata.is_file() => {
                return Err(format!("草稿源文件无效：{name}"));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && name != "index.html" => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err("草稿版本缺少 index.html".to_owned());
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    if version_report_is_reusable(state, project_id, version, source_dir).await {
        update_render_job(state, project_id, job_id, "render/progress", |job| {
            job.progress = 10;
            job.message = "已复用草稿版本的通过检查".to_owned();
        })
        .await?;
        return Ok(());
    }

    let project_dir = state.agent_projects.project_dir(project_id)?;
    let report_dir = project_dir.join(format!(".yingya/reports/render-jobs/{job_id}"));
    fs::create_dir_all(&report_dir)
        .await
        .map_err(|error| error.to_string())?;
    for (index, command) in ["lint", "validate", "inspect"].into_iter().enumerate() {
        let progress = 8 + (index as u8 * 2);
        let label = match command {
            "lint" => "正在检查 Composition 结构",
            "validate" => "正在验证运行时与文字对比度",
            _ => "正在检查时间轴画面布局",
        };
        update_render_job(state, project_id, job_id, "render/progress", |job| {
            job.progress = progress;
            job.message = label.to_owned();
        })
        .await?;
        let report = run_preflight_command(state, command, source_dir).await?;
        atomic_write_bytes(
            &report_dir.join(format!("{command}.json")),
            report.as_bytes(),
        )
        .await?;
    }
    Ok(())
}

fn reject_source_symlinks(
    directory: &FilePath,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + '_>> {
    Box::pin(async move {
        let mut entries = fs::read_dir(directory)
            .await
            .map_err(|error| error.to_string())?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| error.to_string())?
        {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)
                .await
                .map_err(|error| error.to_string())?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "草稿版本包含不允许的软链接：{}",
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("unknown")
                ));
            }
            if metadata.is_dir() {
                reject_source_symlinks(&path).await?;
            }
        }
        Ok(())
    })
}

async fn version_report_is_reusable(
    state: &AppState,
    project_id: &str,
    version: &agent_projects::DraftVersion,
    source_dir: &FilePath,
) -> bool {
    let Some(relative_report) = version.report_path.as_deref() else {
        return false;
    };
    let Ok(report_path) = state
        .agent_projects
        .resolve_relative(project_id, relative_report)
    else {
        return false;
    };
    let Ok(report_bytes) = fs::read(&report_path).await else {
        return false;
    };
    let Ok(report) = serde_json::from_slice::<Value>(&report_bytes) else {
        return false;
    };
    if report.get("ok").and_then(Value::as_bool) != Some(true) {
        return false;
    }
    let Some(report_dir) = report_path.parent() else {
        return false;
    };
    let Ok(fingerprint_bytes) = fs::read(report_dir.join("source-fingerprint.json")).await else {
        return false;
    };
    let Ok(fingerprint) = serde_json::from_slice::<Value>(&fingerprint_bytes) else {
        return false;
    };
    for name in ["index.html", "index.motion.json"] {
        let path = source_dir.join(name);
        let expected = fingerprint
            .pointer(&format!("/files/{name}"))
            .and_then(Value::as_str);
        let exists = fs::try_exists(&path).await.unwrap_or(false);
        let (true, Some(expected)) = (exists, expected) else {
            if !exists && expected.is_none() {
                continue;
            }
            return false;
        };
        let Ok(bytes) = fs::read(path).await else {
            return false;
        };
        let actual = format!("{:x}", Sha256::digest(bytes));
        if actual != expected {
            return false;
        }
    }
    true
}

async fn run_preflight_command(
    state: &AppState,
    command: &str,
    source_dir: &FilePath,
) -> Result<String, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(600),
        Command::new(state.root.join("node_modules/.bin/hyperframes"))
            .arg(command)
            .arg(source_dir)
            .arg("--json")
            .current_dir(source_dir)
            .env("HOME", state.hyperframes_home.as_ref())
            .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| format!("HyperFrames {command} 检查超时"))?
    .map_err(|error| error.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let parsed_ok = serde_json::from_str::<Value>(&stdout)
        .ok()
        .and_then(|value| value.get("ok").and_then(Value::as_bool))
        .unwrap_or(output.status.success());
    if !output.status.success() || !parsed_ok {
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!(
            "HyperFrames {command} 检查未通过：{}",
            truncate_status(&detail, 320)
        ));
    }
    Ok(stdout)
}

async fn verify_render_output(path: &FilePath) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .await
        .map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("HyperFrames 未生成有效的视频文件".to_owned());
    }
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nk=1:nw=1",
            ])
            .arg(path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "ffprobe 验证视频超时".to_owned())?
    .map_err(|error| format!("无法启动 ffprobe：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "渲染文件验证失败：{}",
            truncate_status(&String::from_utf8_lossy(&output.stderr), 320)
        ));
    }
    let duration = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<f64>()
        .unwrap_or_default();
    if !duration.is_finite() || duration <= 0.0 {
        return Err("渲染文件没有有效时长".to_owned());
    }
    Ok(())
}

async fn atomic_write_bytes(path: &FilePath, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, bytes)
        .await
        .map_err(|error| error.to_string())?;
    if let Err(error) = fs::rename(&temporary, path).await {
        let _ = fs::remove_file(temporary).await;
        return Err(error.to_string());
    }
    Ok(())
}

async fn run_render_command(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    source_dir: &FilePath,
    output_path: &FilePath,
    resolution: &str,
    fps: u16,
) -> Result<(), String> {
    let mut child = Command::new(state.root.join("node_modules/.bin/hyperframes"))
        .arg("render")
        .args(["--output", output_path.to_string_lossy().as_ref()])
        .args(["--quality", "high"])
        .args(["--resolution", resolution])
        .args(["--fps", &fps.to_string()])
        .current_dir(source_dir)
        .env("HOME", state.hyperframes_home.as_ref())
        .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| error.to_string())?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (lines_tx, mut lines_rx) = mpsc::channel::<(bool, String)>(64);
    if let Some(stdout) = stdout {
        let lines_tx = lines_tx.clone();
        tokio::spawn(async move {
            forward_process_lines(stdout, false, lines_tx).await;
        });
    }
    if let Some(stderr) = stderr {
        let lines_tx = lines_tx.clone();
        tokio::spawn(async move {
            forward_process_lines(stderr, true, lines_tx).await;
        });
    }
    drop(lines_tx);
    let mut errors = Vec::new();
    let status = tokio::time::timeout(Duration::from_secs(7_200), async {
        loop {
            tokio::select! {
                status = child.wait() => break status.map_err(|error| error.to_string()),
                line = lines_rx.recv() => {
                    let Some((is_error, line)) = line else {
                        break child.wait().await.map_err(|error| error.to_string());
                    };
                    if is_error { errors.push(line.clone()); }
                    if let Some(percent) = render_percent(&line) {
                        let percent = 12 + ((u16::from(percent) * 83 / 100) as u8);
                        let message = truncate_status(&line, 320);
                        let _ = update_render_job(state, project_id, job_id, "render/progress", |job| {
                            job.progress = percent;
                            job.message = message;
                        }).await;
                    }
                }
            }
        }
    }).await.map_err(|_| "视频渲染超时".to_owned())??;
    while let Ok((is_error, line)) = lines_rx.try_recv() {
        if is_error {
            errors.push(line);
        }
    }
    if status.success() {
        Ok(())
    } else {
        Err(errors
            .into_iter()
            .rev()
            .find(|line| !line.trim().is_empty())
            .unwrap_or_else(|| format!("HyperFrames 渲染进程退出：{status}")))
    }
}

async fn forward_process_lines(
    stream: impl tokio::io::AsyncRead + Unpin,
    is_error: bool,
    sender: mpsc::Sender<(bool, String)>,
) {
    let mut lines = BufReader::new(stream).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if sender.send((is_error, line)).await.is_err() {
            break;
        }
    }
}

fn render_percent(line: &str) -> Option<u8> {
    line.split_whitespace().find_map(|word| {
        let number =
            word.trim_matches(|character: char| !character.is_ascii_digit() && character != '.');
        if !word.contains('%') {
            return None;
        }
        number
            .parse::<f32>()
            .ok()
            .map(|value| value.clamp(1.0, 95.0) as u8)
    })
}

fn truncate_status(value: &str, limit: usize) -> String {
    let mut result: String = value.trim().chars().take(limit).collect();
    if value.trim().chars().count() > limit {
        result.push('…');
    }
    result
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

async fn update_render_job<F>(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    method: &str,
    update: F,
) -> Result<RenderJob, String>
where
    F: FnOnce(&mut RenderJob),
{
    let now = agent_projects::now_millis();
    let job = state
        .render_jobs
        .update(project_id, job_id, |job| {
            update(job);
            job.updated_at = now;
        })
        .await?;
    emit_render_event(state, project_id, method, &job).await;
    Ok(job)
}

async fn emit_render_event(state: &AppState, project_id: &str, method: &str, job: &RenderJob) {
    if let Ok(event) = state
        .agent_projects
        .append_event(
            project_id,
            None,
            method.to_owned(),
            json!({
                "jobId": job.id,
                "versionId": job.version_id,
                "status": job.status,
                "resolution": job.resolution,
                "fps": job.fps,
                "progress": job.progress,
                "message": truncate_status(&job.message, 320),
                "outputPath": job.output_path,
                "error": job.error,
            }),
        )
        .await
    {
        let _ = state.agent_events.send(event);
    }
}

async fn reconcile_render_jobs(state: &AppState) {
    let interrupted = match state
        .render_jobs
        .reconcile_interrupted(agent_projects::now_millis())
        .await
    {
        Ok(jobs) => jobs,
        Err(error) => {
            warn!(%error, "failed to reconcile render jobs");
            return;
        }
    };
    for (project_id, job) in interrupted {
        let _ = state
            .agent_projects
            .update_project(&project_id, |record| {
                record.status = "draft_review".to_owned();
                record.status_label = "上次渲染因服务重启中断，可重试".to_owned();
            })
            .await;
        emit_render_event(state, &project_id, "render/interrupted", &job).await;
    }
}

fn spawn_studio_maintenance(state: AppState) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            for project_id in state.studio_sessions.detect_source_changes().await {
                let manifest_result = state.agent_projects.manifest(&project_id).await;
                let Ok(mut manifest) = manifest_result else {
                    continue;
                };
                if manifest.dirty {
                    continue;
                }
                manifest.dirty = true;
                if state
                    .agent_projects
                    .write_manifest(&project_id, &manifest)
                    .await
                    .is_err()
                {
                    continue;
                }
                if !state.agent_jobs.contains(&project_id).await
                    && state.agent_jobs.active_render(&project_id).await.is_none()
                {
                    let _ = state
                        .agent_projects
                        .update_project(&project_id, |record| {
                            record.status = "draft_review".to_owned();
                            record.status_label = "Studio 中有未验证的修改".to_owned();
                        })
                        .await;
                }
                emit_agent_state_event(&state, &project_id, None, "project/updated").await;
            }
            let _ = state
                .studio_sessions
                .reap_idle(agent_projects::now_millis(), 2 * 60 * 60 * 1000)
                .await;
        }
    });
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
    let project_dir = state
        .agent_projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    let session = state
        .studio_sessions
        .start(&project_id, &project_dir)
        .await
        .map_err(ApiError::External)?;
    Ok(Json(studio_response(session)))
}

async fn heartbeat_agent_studio(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<StudioResponse>, ApiError> {
    let session = state
        .studio_sessions
        .heartbeat(&project_id)
        .await
        .map_err(ApiError::External)?;
    Ok(Json(studio_response(session)))
}

async fn stop_agent_studio(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    state
        .studio_sessions
        .stop(&project_id)
        .await
        .map_err(ApiError::External)?;
    Ok(StatusCode::NO_CONTENT)
}

fn studio_response(session: StudioSession) -> StudioResponse {
    StudioResponse {
        storyboard_url: session.storyboard_url,
        preview_url: session.preview_url,
        state: session.state,
        host: session.host,
        port: session.port,
        project_name: session.project_name,
        last_seen_at: session.last_seen_at,
    }
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
    if state.agent_jobs.contains(&project_id).await
        || state.agent_jobs.active_render(&project_id).await.is_some()
    {
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
    let voice_note = format!(
        "\n项目固定旁白音色：{}。需要生成旁白时必须让所有片段都使用这个 voice ID，并复用同一音色；不要临时改回 default 或为不同片段重新设计音色。配置也保存在 .yingya/voice.json。",
        project.voice_id
    );
    let prompt = format!(
        "用户请求：{}{}{}{}{}\n所有工作必须限制在当前项目目录。按照 yingya-video-agent skill 管理 checkpoint、manifest、质量检查与版本。不得在项目 turn 中安装或更新任何 skill、plugin、CLI 或全局依赖；缺少可选能力时直接使用已安装的 HyperFrames 核心能力或说明 fallback。",
        queued.text, attachment_note, context_note, dirty_note, voice_note
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
            if workflow.needs_recovery {
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
                    record.queue_paused = workflow.needs_recovery;
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
    needs_recovery: bool,
    guidance: &'static str,
}

async fn validate_completed_workflow(
    state: &AppState,
    project_id: &str,
    manifest: &agent_projects::AgentManifest,
) -> WorkflowCompletion {
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
    let has_untracked_composition = has_untracked_composition(state, project_id).await;
    let quality_report_passed =
        has_current_passing_quality_report(state, project_id, manifest).await;

    classify_completed_workflow(
        manifest,
        WorkflowEvidence {
            checkpoint_artifacts_valid,
            referenced_paths_exist,
            draft_valid,
            draft_source_synced,
            completed_video_valid,
            has_untracked_composition,
            quality_report_passed,
        },
    )
}

#[derive(Clone, Copy)]
struct WorkflowEvidence {
    checkpoint_artifacts_valid: bool,
    referenced_paths_exist: bool,
    draft_valid: bool,
    draft_source_synced: bool,
    completed_video_valid: bool,
    has_untracked_composition: bool,
    quality_report_passed: bool,
}

fn classify_completed_workflow(
    manifest: &agent_projects::AgentManifest,
    evidence: WorkflowEvidence,
) -> WorkflowCompletion {
    let checkpoint_kind = manifest
        .checkpoint
        .as_ref()
        .map(|value| value.kind.as_str());

    match manifest.phase.as_str() {
        "plan_review"
            if checkpoint_kind == Some("plan")
                && evidence.checkpoint_artifacts_valid
                && evidence.referenced_paths_exist =>
        {
            WorkflowCompletion {
                status: "waiting_plan",
                label: "制作方案等待确认",
                needs_recovery: false,
                guidance: "",
            }
        }
        "draft_review"
            if checkpoint_kind == Some("draft")
                && evidence.checkpoint_artifacts_valid
                && evidence.referenced_paths_exist
                && evidence.draft_valid
                && evidence.draft_source_synced =>
        {
            WorkflowCompletion {
                status: "draft_review",
                label: "草稿等待确认",
                needs_recovery: false,
                guidance: "",
            }
        }
        "completed" if manifest.checkpoint.is_none() && evidence.completed_video_valid => {
            WorkflowCompletion {
                status: "completed",
                label: "高清成片已完成",
                needs_recovery: false,
                guidance: "",
            }
        }
        "briefing"
            if manifest.artifacts.is_empty()
                && manifest.versions.is_empty()
                && !evidence.has_untracked_composition =>
        {
            WorkflowCompletion {
                status: "waiting_input",
                label: "等待补充创作信息",
                needs_recovery: false,
                guidance: "",
            }
        }
        "production" | "final_render" if evidence.quality_report_passed => WorkflowCompletion {
            status: "incomplete",
            label: "检查已通过，草稿待封存",
            needs_recovery: true,
            guidance: "质量检查已经通过，但草稿尚未完成封存。现有报告和视频已保留；请登记不可变版本、currentDraft 与 draft checkpoint 后提交审核。",
        },
        "briefing" | "plan_review" | "production" | "draft_review" | "final_render"
        | "completed" => WorkflowCompletion {
            status: "incomplete",
            label: "制作流程待收尾",
            needs_recovery: true,
            guidance: "本次制作已停止在可恢复的中间状态，现有文件已保留。请先复用与当前源码匹配的有效检查报告和视频，只补齐缺失步骤，再完成版本与 checkpoint 登记。",
        },
        _ => WorkflowCompletion {
            status: "failed",
            label: "项目状态无法识别",
            needs_recovery: true,
            guidance: "项目 manifest 使用了无法识别的阶段，已暂停后续队列。请检查 manifest 后恢复到受支持的制作阶段。",
        },
    }
}

async fn has_current_passing_quality_report(
    state: &AppState,
    project_id: &str,
    manifest: &agent_projects::AgentManifest,
) -> bool {
    let Ok(project_dir) = state.agent_projects.project_dir(project_id) else {
        return false;
    };
    let source_modified = [manifest.studio_entry.as_str(), "index.motion.json"]
        .into_iter()
        .filter_map(|relative| {
            state
                .agent_projects
                .resolve_relative(project_id, relative)
                .ok()
        })
        .filter_map(|path| std::fs::metadata(path).ok()?.modified().ok())
        .max();
    for directory in [
        project_dir.join(".yingya"),
        project_dir.join(".yingya/reports"),
    ] {
        let Ok(mut entries) = fs::read_dir(directory).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !name.starts_with("check")
                || path.extension().and_then(|value| value.to_str()) != Some("json")
            {
                continue;
            }
            let Ok(metadata) = entry.metadata().await else {
                continue;
            };
            if let Some(source_modified) = source_modified
                && metadata
                    .modified()
                    .ok()
                    .is_none_or(|modified| modified < source_modified)
            {
                continue;
            }
            let Ok(bytes) = fs::read(&path).await else {
                continue;
            };
            if serde_json::from_slice::<Value>(&bytes)
                .ok()
                .and_then(|value| value.get("ok").and_then(Value::as_bool))
                == Some(true)
            {
                return true;
            }
        }
    }
    false
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
        if workflow.needs_recovery && !manifest.dirty {
            manifest.dirty = true;
            let _ = state
                .agent_projects
                .write_manifest(&project.id, &manifest)
                .await;
        }
        let _ = state
            .agent_projects
            .update_project(&project.id, |record| {
                record.queue_paused = workflow.needs_recovery;
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
    let images = state
        .assets
        .import_generated(turn.generated_images, Some(request.prompt.trim()))
        .await?;

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

        let source_name = field.file_name().map(str::to_owned);
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

        let id = Uuid::new_v4().to_string();
        let relative = format!("uploads/{id}.{extension}");
        let destination = state.assets.root.join(&relative);
        fs::write(&destination, bytes).await?;
        state
            .assets
            .write_metadata(
                &destination,
                &ImageLibraryMetadata {
                    id,
                    prompt: None,
                    source_name,
                    kind: "uploaded".to_owned(),
                    created_at: unix_millis(SystemTime::now()),
                },
            )
            .await?;
        return Ok(Json(UploadResponse {
            url: format!("/assets/{relative}"),
            hyperframes_path: format!("assets/{relative}"),
        }));
    }

    Err(ApiError::BadRequest(
        "multipart field `file` is required".to_owned(),
    ))
}

async fn list_images(
    State(state): State<AppState>,
) -> Result<Json<ImageLibraryResponse>, ApiError> {
    Ok(Json(ImageLibraryResponse {
        images: state.assets.list_images().await?,
    }))
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
        fallback_prompt: Option<&str>,
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
            let id = Uuid::new_v4().to_string();
            let filename = format!("{id}.{extension}");
            let destination = self.root.join("generated").join(&filename);
            fs::copy(&source, &destination).await?;
            self.write_metadata(
                &destination,
                &ImageLibraryMetadata {
                    id: id.clone(),
                    prompt: event
                        .revised_prompt
                        .clone()
                        .or_else(|| fallback_prompt.map(str::to_owned)),
                    source_name: None,
                    kind: "generated".to_owned(),
                    created_at: unix_millis(SystemTime::now()),
                },
            )
            .await?;
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

    async fn write_metadata(
        &self,
        image_path: &FilePath,
        metadata: &ImageLibraryMetadata,
    ) -> Result<(), ApiError> {
        let metadata_path = image_path.with_extension(format!(
            "{}.metadata.json",
            image_path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("image")
        ));
        let bytes = serde_json::to_vec_pretty(metadata).map_err(std::io::Error::other)?;
        fs::write(metadata_path, bytes).await?;
        Ok(())
    }

    async fn list_images(&self) -> Result<Vec<ImageLibraryAsset>, ApiError> {
        let mut images = Vec::new();
        for kind in ["generated", "uploads"] {
            let mut entries = fs::read_dir(self.root.join(kind)).await?;
            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();
                if !entry.file_type().await?.is_file() {
                    continue;
                }
                let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
                    continue;
                };
                let extension = extension.to_ascii_lowercase();
                if !matches!(
                    extension.as_str(),
                    "png" | "jpg" | "jpeg" | "webp" | "gif" | "avif"
                ) {
                    continue;
                }
                let filename = entry.file_name().to_string_lossy().into_owned();
                let metadata_path = path.with_extension(format!("{extension}.metadata.json"));
                let fallback_created_at = entry
                    .metadata()
                    .await?
                    .modified()
                    .map(unix_millis)
                    .unwrap_or_default();
                let metadata = match fs::read(metadata_path).await {
                    Ok(bytes) => serde_json::from_slice::<ImageLibraryMetadata>(&bytes).ok(),
                    Err(_) => None,
                };
                let relative = format!("{kind}/{filename}");
                images.push(ImageLibraryAsset {
                    id: metadata
                        .as_ref()
                        .map(|value| value.id.clone())
                        .unwrap_or_else(|| filename.clone()),
                    url: format!("/assets/{relative}"),
                    hyperframes_path: format!("assets/{relative}"),
                    mime_type: image_mime(&extension).to_owned(),
                    prompt: metadata.as_ref().and_then(|value| value.prompt.clone()),
                    source_name: metadata
                        .as_ref()
                        .and_then(|value| value.source_name.clone()),
                    kind: metadata
                        .as_ref()
                        .map(|value| value.kind.clone())
                        .unwrap_or_else(|| {
                            if kind == "generated" {
                                "generated"
                            } else {
                                "uploaded"
                            }
                            .to_owned()
                        }),
                    created_at: metadata
                        .as_ref()
                        .map(|value| value.created_at)
                        .unwrap_or(fallback_created_at),
                });
            }
        }
        images.sort_by_key(|image| std::cmp::Reverse(image.created_at));
        Ok(images)
    }
}

fn unix_millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
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
        "jpg" | "jpeg" => "image/jpeg",
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

impl From<VoiceError> for ApiError {
    fn from(error: VoiceError) -> Self {
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

    #[tokio::test]
    async fn scaffolds_hyperframes_after_plan_confirmation_without_overwriting_source() {
        let root = env::temp_dir().join(format!("yingya-hyperframes-scaffold-{}", Uuid::new_v4()));
        fs::create_dir_all(root.join("compositions")).await.unwrap();
        let first_scaffold = write_hyperframes_scaffold(
            &root,
            "project-id",
            "9:16",
            &json!({ "durationSeconds": 18 }),
        )
        .await;
        assert!(first_scaffold.is_ok());
        let generated = fs::read_to_string(root.join("index.html")).await.unwrap();
        assert!(generated.contains("data-duration=\"18\""));
        assert!(generated.contains("data-width=\"1080\" data-height=\"1920\""));
        fs::write(root.join("index.html"), "user-authored-composition")
            .await
            .unwrap();
        let second_scaffold =
            write_hyperframes_scaffold(&root, "project-id", "16:9", &json!({})).await;
        assert!(second_scaffold.is_ok());
        assert_eq!(
            fs::read_to_string(root.join("index.html")).await.unwrap(),
            "user-authored-composition"
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

    fn workflow_evidence() -> WorkflowEvidence {
        WorkflowEvidence {
            checkpoint_artifacts_valid: false,
            referenced_paths_exist: true,
            draft_valid: false,
            draft_source_synced: false,
            completed_video_valid: false,
            has_untracked_composition: true,
            quality_report_passed: false,
        }
    }

    #[test]
    fn production_without_a_checkpoint_is_recoverable_not_failed() {
        let manifest = agent_projects::AgentManifest {
            phase: "production".to_owned(),
            dirty: true,
            ..Default::default()
        };
        let result = classify_completed_workflow(&manifest, workflow_evidence());
        assert_eq!(result.status, "incomplete");
        assert_eq!(result.label, "制作流程待收尾");
        assert!(result.needs_recovery);
    }

    #[test]
    fn passing_quality_report_is_exposed_as_ready_to_package() {
        let manifest = agent_projects::AgentManifest {
            phase: "production".to_owned(),
            dirty: true,
            ..Default::default()
        };
        let result = classify_completed_workflow(
            &manifest,
            WorkflowEvidence {
                quality_report_passed: true,
                ..workflow_evidence()
            },
        );
        assert_eq!(result.status, "incomplete");
        assert_eq!(result.label, "检查已通过，草稿待封存");
        assert!(result.needs_recovery);
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

    #[test]
    fn parses_and_clamps_hyperframes_render_progress() {
        assert_eq!(render_percent("Rendering frames 42%"), Some(42));
        assert_eq!(render_percent("Encoding 99.8%"), Some(95));
        assert_eq!(render_percent("Preparing renderer"), None);
    }

    #[test]
    fn render_outputs_are_unique_per_job_and_never_use_the_temporary_directory() {
        let first = render_output_relative_path("draft-3", "portrait-4k", 60, "job-one");
        let second = render_output_relative_path("draft-3", "portrait-4k", 60, "job-two");
        assert_ne!(first, second);
        assert!(first.ends_with("draft-3-portrait-4k-60fps-job-one.mp4"));
        assert!(!first.contains("/.tmp/"));
        assert!(!first.contains(".partial.mp4"));
    }

    #[tokio::test]
    async fn temporary_render_output_is_removed_after_a_terminal_state() {
        let root = env::temp_dir().join(format!("yingya-render-cleanup-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let output = root.join("job.partial.mp4");
        fs::write(&output, b"incomplete video").await.unwrap();

        remove_temporary_render_output(&output).await;

        assert!(!fs::try_exists(&output).await.unwrap());
        fs::remove_dir_all(root).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn render_preflight_rejects_symlinks_inside_version_source() {
        use std::os::unix::fs::symlink;

        let root = env::temp_dir().join(format!("yingya-render-symlink-{}", Uuid::new_v4()));
        let source = root.join("source");
        fs::create_dir_all(&source).await.unwrap();
        fs::write(root.join("outside.html"), "outside")
            .await
            .unwrap();
        symlink(root.join("outside.html"), source.join("index.html")).unwrap();

        let error = reject_source_symlinks(&source).await.unwrap_err();

        assert!(error.contains("软链接"));
        fs::remove_dir_all(root).await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn render_output_cannot_escape_through_a_symlinked_directory() {
        use std::os::unix::fs::symlink;

        let root = env::temp_dir().join(format!("yingya-render-output-{}", Uuid::new_v4()));
        let project = root.join("project");
        let outside = root.join("outside");
        fs::create_dir_all(project.join(".yingya")).await.unwrap();
        fs::create_dir_all(&outside).await.unwrap();
        symlink(&outside, project.join(".yingya/exports")).unwrap();
        fs::create_dir_all(project.join(".yingya/exports/.tmp"))
            .await
            .unwrap();
        let canonical_project = fs::canonicalize(&project).await.unwrap();
        let final_output = project.join(".yingya/exports/final.mp4");
        let temporary_output = project.join(".yingya/exports/.tmp/job.partial.mp4");

        let error = ensure_render_output_parents(
            &canonical_project,
            [final_output.as_path(), temporary_output.as_path()],
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("软链接"));
        fs::remove_dir_all(root).await.unwrap();
    }
}
