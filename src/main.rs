mod codex;
mod projects;
mod agent_projects;

use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    path::{Path as FilePath, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{HeaderMap, StatusCode, header::{ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, IF_NONE_MATCH, RANGE}},
    response::{IntoResponse, Response, Sse, sse::Event},
    routing::{get, patch, post},
};
use codex::{
    CodexClient, CodexConfig, CodexError, GeneratedImageEvent, ThreadStarted, TurnCancellation,
    TurnCompleted, TurnOptions,
};
use agent_projects::{AgentEvent, AgentProjectDetail, AgentProjectRecord, AgentProjectStore, AgentTurnRequest, CreateAgentProjectRequest, QueuedTurn};
use projects::{
    AssetRecord, CreateProjectRequest, MessageRequest, PatchSceneRequest, ProjectActionRequest,
    ProjectDetail, ProjectEvent, ProjectRecord, ProjectStore, RunRecord, SceneRecord, now,
    validate_model_settings,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
    net::TcpListener,
    process::Command,
    sync::{Mutex, Notify, broadcast, mpsc},
};
use tokio_stream::{StreamExt, wrappers::BroadcastStream};
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    codex: Arc<CodexClient>,
    heygen: HeyGenClient,
    assets: AssetStore,
    projects: ProjectStore,
    project_events: broadcast::Sender<ProjectEvent>,
    jobs: Arc<Mutex<HashMap<String, ActiveJob>>>,
    studio_lock: Arc<Mutex<()>>,
    root: Arc<PathBuf>,
    hyperframes_home: Arc<PathBuf>,
    agent_projects: AgentProjectStore,
    agent_events: broadcast::Sender<AgentEvent>,
    agent_jobs: Arc<Mutex<HashMap<String, ActiveAgentTurn>>>,
}

#[derive(Clone)]
struct ActiveAgentTurn {
    cancellation: TurnCancellation,
    request_id: String,
    context: Vec<String>,
}

#[derive(Clone)]
struct ActiveJob {
    id: String,
    cancellation: TurnCancellation,
    completion: Arc<Notify>,
}

struct ProjectJobSpec {
    action: String,
    instruction: String,
    scene_ids: Vec<String>,
    user_message: Option<String>,
    resume_state: Option<ProjectResumeState>,
    model: Option<String>,
    reasoning_effort: Option<String>,
}

#[derive(Clone)]
struct ProjectResumeState {
    status: String,
    status_label: String,
    current_view: String,
    progress: u8,
}

#[derive(Clone)]
struct HeyGenClient {
    http: reqwest::Client,
    api_key: Option<Arc<str>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct HeyGenAudioSound {
    id: String,
    name: String,
    description: String,
    #[serde(rename(deserialize = "audio_url", serialize = "audioUrl"))]
    audio_url: String,
    duration: f32,
    score: f32,
    #[serde(rename = "type")]
    audio_type: String,
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

#[derive(Debug, Serialize, Deserialize)]
struct HeyGenAudioSearchResponse {
    data: Vec<HeyGenAudioSound>,
    #[serde(default, rename(deserialize = "has_more", serialize = "hasMore"))]
    has_more: bool,
    #[serde(default, rename(deserialize = "next_token", serialize = "nextToken"))]
    next_token: Option<String>,
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
struct ActionResponse {
    job_id: String,
    status: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentTurnAccepted {
    turn_id: String,
    status: String,
    queue_depth: usize,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateProjectImageRequest {
    prompt: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning_effort: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GenerateProjectImageResponse {
    text: String,
    assets: Vec<AssetRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftScriptOutput {
    summary: String,
    scenes: Vec<DraftSceneOutput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DraftSceneOutput {
    narrative_role: String,
    narration: String,
    visual_direction: String,
    asset_strategy: String,
    motion_blueprint: String,
    transition: String,
    duration_seconds: Option<f32>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("yingya_server=info")),
        )
        .init();

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let hyperframes_browser = discover_hyperframes_browser(&root).await;
    let config = CodexConfig {
        binary: env_path("YINGYA_CODEX_BIN", root.join("node_modules/.bin/codex")),
        home: env_path("YINGYA_CODEX_HOME", root.join(".runtime/codex-home")),
        workspace: env_path("YINGYA_WORKSPACE", root.clone()),
        model: env::var("YINGYA_CODEX_MODEL").unwrap_or_else(|_| "gpt-5.6-terra".to_owned()),
        network_access: env_bool("YINGYA_CODEX_NETWORK_ACCESS", true),
        hyperframes_browser,
        video_agent_skill: Some(root.join("skills/yingya-video-agent/SKILL.md")),
        // This is an inactivity timeout, not a cap on the total production time.
        turn_timeout: Duration::from_secs(env_u64("YINGYA_CODEX_TURN_TIMEOUT_SECS", 3600)),
    };

    let codex = CodexClient::spawn(config).await?;
    let heygen = HeyGenClient::new()?;
    let assets = AssetStore::new(env_path("YINGYA_ASSETS_DIR", root.join("data/assets"))).await?;
    let project_root = env_path("YINGYA_PROJECTS_DIR", root.join("data/projects"));
    let projects = ProjectStore::new(project_root.clone()).await?;
    projects
        .recover_interrupted()
        .await
        .map_err(std::io::Error::other)?;
    let (project_events, _) = broadcast::channel(512);
    let agent_projects = AgentProjectStore::new(env_path("YINGYA_AGENT_PROJECTS_DIR", root.join("data/video-projects"))).await?;
    agent_projects.recover_interrupted().await.map_err(std::io::Error::other)?;
    let (agent_events, _) = broadcast::channel(2_048);
    let static_assets = assets.root.as_ref().clone();
    let web_dist = root.join("web-dist");
    let web_index = web_dist.join("index.html");
    let state = AppState {
        codex,
        heygen,
        assets,
        projects,
        project_events,
        jobs: Arc::new(Mutex::new(HashMap::new())),
        studio_lock: Arc::new(Mutex::new(())),
        root: Arc::new(root.clone()),
        hyperframes_home: Arc::new(root.join(".runtime/hyperframes-home")),
        agent_projects,
        agent_events,
        agent_jobs: Arc::new(Mutex::new(HashMap::new())),
    };
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
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/agent-projects", get(list_agent_projects).post(create_agent_project))
        .route("/api/agent-projects/{project_id}", get(get_agent_project).patch(rename_agent_project).delete(delete_agent_project))
        .route("/api/agent-projects/{project_id}/turns", post(post_agent_turn))
        .route("/api/agent-projects/{project_id}/interrupt", post(interrupt_agent_turn))
        .route("/api/agent-projects/{project_id}/queue/{turn_id}", axum::routing::delete(remove_queued_turn))
        .route("/api/agent-projects/{project_id}/events", get(agent_event_stream))
        .route("/api/agent-projects/{project_id}/checkpoint", post(confirm_agent_checkpoint))
        .route("/api/agent-projects/{project_id}/requests/respond", post(respond_agent_request))
        .route("/api/agent-projects/{project_id}/versions/{version_id}/rollback", post(rollback_agent_version))
        .route("/api/agent-projects/{project_id}/studio", post(start_agent_studio))
        .route("/api/agent-projects/{project_id}/studio/dirty", post(mark_agent_studio_dirty))
        .route("/api/agent-projects/{project_id}/assets", post(upload_agent_asset))
        .route("/api/agent-projects/{project_id}/files/{*path}", get(agent_project_file))
        .route("/api/projects/{project_id}", get(get_project))
        .route(
            "/api/projects/{project_id}/scenes/{scene_id}",
            patch(patch_scene),
        )
        .route("/api/projects/{project_id}/actions", post(project_action))
        .route("/api/projects/{project_id}/messages", post(post_message))
        .route(
            "/api/projects/{project_id}/images",
            post(generate_project_image),
        )
        .route(
            "/api/projects/{project_id}/studio",
            post(start_project_studio),
        )
        .route(
            "/api/projects/{project_id}/assets",
            post(upload_project_asset),
        )
        .route(
            "/api/projects/{project_id}/heygen/audio",
            post(import_heygen_audio),
        )
        .route(
            "/api/projects/{project_id}/events",
            get(project_event_stream),
        )
        .route(
            "/api/projects/{project_id}/artifacts/{name}",
            get(project_artifact),
        )
        .nest_service("/assets", ServeDir::new(static_assets))
        .nest_service("/project-files", ServeDir::new(project_root))
        .fallback_service(ServeDir::new(web_dist).not_found_service(ServeFile::new(web_index)))
        .layer(DefaultBodyLimit::max(25 * 1024 * 1024))
        .with_state(state);

    let address: SocketAddr = env::var("YINGYA_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:3000".to_owned())
        .parse()?;
    let listener = TcpListener::bind(address).await?;
    info!(%address, "Yingya Rust backend is listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        backend: "rust",
        codex_model: state.codex.model().to_owned(),
    })
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

async fn list_agent_projects(State(state): State<AppState>) -> Result<Json<Vec<AgentProjectRecord>>, ApiError> {
    Ok(Json(state.agent_projects.list().await.map_err(ApiError::Project)?))
}

async fn delete_agent_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    if state.agent_jobs.lock().await.contains_key(&project_id) {
        return Err(ApiError::Conflict("项目仍在运行，请先停止任务再删除".to_owned()));
    }
    state.agent_projects.delete(&project_id).await.map_err(ApiError::Project)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn rename_agent_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<RenameAgentProjectRequest>,
) -> Result<Json<AgentProjectRecord>, ApiError> {
    let title = request.title.trim();
    if title.is_empty() { return Err(ApiError::BadRequest("项目标题不能为空".to_owned())); }
    if title.chars().count() > 48 { return Err(ApiError::BadRequest("项目标题不能超过 48 个字符".to_owned())); }
    let title = title.to_owned();
    let project = state.agent_projects.update_project(&project_id, |record| record.title = title).await.map_err(ApiError::Project)?;
    Ok(Json(project))
}

async fn get_agent_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<AgentProjectDetail>, ApiError> {
    Ok(Json(state.agent_projects.get(&project_id).await.map_err(ApiError::Project)?))
}

async fn create_agent_project(
    State(state): State<AppState>,
    Json(request): Json<CreateAgentProjectRequest>,
) -> Result<Json<AgentProjectDetail>, ApiError> {
    validate_model_settings(&request.model, &request.reasoning_effort).map_err(ApiError::BadRequest)?;
    let project = state.agent_projects.create(&request).await.map_err(ApiError::Project)?;
    let workspace = state.agent_projects.project_dir(&project.id).map_err(ApiError::Project)?;
    let thread = state.codex.start_thread_at(&workspace, Some(&project.model)).await?;
    state.agent_projects.update_project(&project.id, |record| {
        record.thread_id = Some(thread.thread_id.clone());
        record.status = "idle".to_owned();
        record.status_label = "等待发送需求".to_owned();
    }).await.map_err(ApiError::Project)?;
    Ok(Json(state.agent_projects.get(&project.id).await.map_err(ApiError::Project)?))
}

async fn post_agent_turn(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<AgentTurnRequest>,
) -> Result<Json<AgentTurnAccepted>, ApiError> {
    if request.text.trim().is_empty() { return Err(ApiError::BadRequest("message cannot be empty".to_owned())); }
    if let Some(model) = request.model.as_deref() {
        validate_model_settings(model, request.reasoning_effort.as_deref().unwrap_or("auto")).map_err(ApiError::BadRequest)?;
    }
    if request.interrupt
        && let Some(active) = state.agent_jobs.lock().await.get(&project_id).cloned()
    {
        active.cancellation.cancel();
        let project_dir = state.agent_projects.project_dir(&project_id).map_err(ApiError::Project)?;
        terminate_project_processes(&project_dir).await;
    }
    state.agent_projects.append_message(&project_id, "user", &request.text, request.attachments.clone(), request.context.clone(), "queued").await.map_err(ApiError::Project)?;
    let queued = state.agent_projects.enqueue(&project_id, request).await.map_err(ApiError::Project)?;
    try_start_next_agent_turn(state.clone(), project_id.clone()).await?;
    let detail = state.agent_projects.get(&project_id).await.map_err(ApiError::Project)?;
    let status = if detail.project.active_turn_id.as_deref() == Some(queued.id.as_str()) { "running" } else { "queued" };
    Ok(Json(AgentTurnAccepted { turn_id: queued.id, status: status.to_owned(), queue_depth: detail.queue.len() }))
}

async fn interrupt_agent_turn(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let active = state.agent_jobs.lock().await.get(&project_id).cloned();
    let project_dir = state.agent_projects.project_dir(&project_id).map_err(ApiError::Project)?;
    if active.is_some() {
        state.agent_projects.update_project(&project_id, |record| {
            record.status = "stopping".to_owned();
            record.status_label = "正在停止当前任务".to_owned();
        }).await.map_err(ApiError::Project)?;
    }
    if let Some(active) = active { active.cancellation.cancel(); }
    terminate_project_processes(&project_dir).await;
    Ok(if state.agent_jobs.lock().await.contains_key(&project_id) { StatusCode::ACCEPTED } else { StatusCode::NO_CONTENT })
}

async fn terminate_project_processes(project_dir: &FilePath) {
    let marker = project_dir.to_string_lossy();
    let current = std::process::id();
    let mut pids = Vec::new();
    let Ok(mut entries) = fs::read_dir("/proc").await else { return; };
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Some(pid) = entry.file_name().to_str().and_then(|value| value.parse::<u32>().ok()) else { continue; };
        if pid == current { continue; }
        let cwd_matches = fs::read_link(entry.path().join("cwd")).await.ok().is_some_and(|cwd| cwd.starts_with(project_dir));
        let command_matches = fs::read(entry.path().join("cmdline")).await.ok().is_some_and(|bytes| String::from_utf8_lossy(&bytes).contains(marker.as_ref()));
        if cwd_matches || command_matches { pids.push(pid); }
    }
    if pids.is_empty() { return; }
    let mut terminate = tokio::process::Command::new("kill");
    terminate.arg("-TERM").args(pids.iter().map(u32::to_string));
    let _ = terminate.status().await;
    tokio::time::sleep(Duration::from_millis(350)).await;
    let survivors: Vec<String> = pids.into_iter().filter(|pid| std::path::Path::new("/proc").join(pid.to_string()).exists()).map(|pid| pid.to_string()).collect();
    if !survivors.is_empty() {
        let _ = tokio::process::Command::new("kill").arg("-KILL").args(survivors).status().await;
    }
}

async fn remove_queued_turn(
    State(state): State<AppState>,
    Path((project_id, turn_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    state.agent_projects.remove_queued(&project_id, &turn_id).await.map_err(ApiError::Project)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn confirm_agent_checkpoint(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<AgentTurnAccepted>, ApiError> {
    let detail = state.agent_projects.get(&project_id).await.map_err(ApiError::Project)?;
    let checkpoint = detail.manifest.checkpoint.ok_or_else(|| ApiError::BadRequest("project is not waiting for confirmation".to_owned()))?;
    if checkpoint.kind != "plan" {
        return Err(ApiError::BadRequest("草稿视频无需再次确认或导出，请直接在预览中审阅".to_owned()));
    }
    let checkpoint_context = format!("checkpoint:{}", checkpoint.id);
    let active = state.agent_jobs.lock().await.get(&project_id).cloned();
    let accepted = if let Some(active) = active.filter(|active| active.context.iter().any(|value| value == &checkpoint_context)) {
        Json(AgentTurnAccepted {
            turn_id: active.request_id,
            status: "running".to_owned(),
            queue_depth: detail.queue.len(),
        })
    } else if let Some(existing) = detail.queue.iter().find(|turn| {
        turn.context.iter().any(|value| value == &checkpoint_context)
    }) {
        Json(AgentTurnAccepted {
            turn_id: existing.id.clone(),
            status: "queued".to_owned(),
            queue_depth: detail.queue.len(),
        })
    } else {
        let text = "当前制作方案已经确认。请按方案继续制作完整草稿；完成 HyperFrames lint、validate、inspect 和必要的动画检查后，写入 draft checkpoint 并返回可审阅视频。";
        post_agent_turn(State(state.clone()), Path(project_id.clone()), Json(AgentTurnRequest { text: text.to_owned(), attachments: vec![], context: vec![checkpoint_context], model: None, reasoning_effort: None, interrupt: false })).await?
    };
    let mut manifest = state.agent_projects.manifest(&project_id).await.map_err(ApiError::Project)?;
    if manifest.checkpoint.as_ref().is_some_and(|current| current.id == checkpoint.id) {
        manifest.checkpoint = None;
        manifest.phase = "production".to_owned();
        state.agent_projects.write_manifest(&project_id, &manifest).await.map_err(ApiError::Project)?;
    }
    Ok(accepted)
}

async fn respond_agent_request(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(response): Json<AgentServerResponse>,
) -> Result<StatusCode, ApiError> {
    let known = state.agent_projects.read_events(&project_id, 0).await.map_err(ApiError::Project)?
        .iter().any(|event| event.payload.get("id") == Some(&response.id));
    if !known { return Err(ApiError::BadRequest("unknown Codex request id".to_owned())); }
    state.codex.respond_to_server_request(response.id, response.result).await?;
    Ok(StatusCode::ACCEPTED)
}

async fn rollback_agent_version(
    State(state): State<AppState>,
    Path((project_id, version_id)): Path<(String, String)>,
) -> Result<Json<AgentTurnAccepted>, ApiError> {
    let manifest = state.agent_projects.manifest(&project_id).await.map_err(ApiError::Project)?;
    let version = manifest.versions.iter().find(|version| version.id == version_id)
        .ok_or_else(|| ApiError::BadRequest("unknown draft version".to_owned()))?;
    let text = format!("请回退到 {}（{}）。从该版本快照恢复源码和 manifest 指针，不要删除后续版本；恢复后运行相关 HyperFrames 检查，并把结果作为新的稳定 Draft 提交审阅。", version.label, version.id);
    post_agent_turn(State(state), Path(project_id), Json(AgentTurnRequest { text, attachments: vec![], context: vec![format!("rollback:{}", version.id)], model: None, reasoning_effort: None, interrupt: false })).await
}

async fn agent_event_stream(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(query): Query<AgentEventQuery>,
) -> Result<Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>>, ApiError> {
    let historical = state.agent_projects.read_events(&project_id, query.after).await.map_err(ApiError::Project)?;
    let history_stream = tokio_stream::iter(historical.into_iter().map(|event| Ok(Event::default().event("agent-event").id(event.seq.to_string()).json_data(event).unwrap_or_else(|_| Event::default().data("{}")))));
    let live_project_id = project_id.clone();
    let live = BroadcastStream::new(state.agent_events.subscribe()).filter_map(move |result| match result {
        Ok(event) if event.project_id == live_project_id && event.seq > query.after => Some(Ok(Event::default().event("agent-event").id(event.seq.to_string()).json_data(event).unwrap_or_else(|_| Event::default().data("{}")))),
        _ => None,
    });
    Ok(Sse::new(history_stream.chain(live)))
}

async fn upload_agent_asset(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<AgentUploadResponse>, ApiError> {
    while let Some(field) = multipart.next_field().await.map_err(|error| ApiError::BadRequest(error.to_string()))? {
        if field.name() != Some("file") { continue; }
        let original = field.file_name().unwrap_or("asset.bin").to_owned();
        let extension = FilePath::new(&original).extension().and_then(|value| value.to_str()).filter(|value| value.len() <= 10).unwrap_or("bin");
        let filename = format!("{}.{extension}", Uuid::new_v4());
        let bytes = field.bytes().await.map_err(|error| ApiError::BadRequest(error.to_string()))?;
        let relative = format!("assets/inbox/{filename}");
        fs::write(state.agent_projects.resolve_relative(&project_id, &relative).map_err(ApiError::Project)?, bytes).await?;
        return Ok(Json(AgentUploadResponse { path: relative, name: original }));
    }
    Err(ApiError::BadRequest("file is required".to_owned()))
}

async fn start_agent_studio(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<StudioResponse>, ApiError> {
    use std::hash::{Hash, Hasher};
    let _guard = state.studio_lock.lock().await;
    let project_dir = state.agent_projects.project_dir(&project_id).map_err(ApiError::Project)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new(); project_id.hash(&mut hasher);
    let port = 8600 + (hasher.finish() % 100) as u16;
    let status = run_preview_command(&state, &project_dir, &["--status"]).await?;
    let reusable = status.pointer("/result/state").and_then(Value::as_str) == Some("running")
        && status.pointer("/result/host").and_then(Value::as_str) == Some("0.0.0.0")
        && status.pointer("/result/port").and_then(Value::as_u64).is_some_and(|value| (8600..8800).contains(&value));
    if !reusable && status.pointer("/result/state").and_then(Value::as_str) == Some("running") {
        run_preview_command(&state, &project_dir, &["--stop"]).await?;
    }
    let preview = if reusable { status } else { run_preview_command(&state, &project_dir, &["--port", &port.to_string(), "--background", "--force-new"]).await? };
    let server_url = preview.pointer("/result/serverUrl").and_then(Value::as_str).ok_or_else(|| ApiError::BadRequest("HyperFrames preview 未返回服务地址".to_owned()))?;
    let name = project_dir.file_name().and_then(|value| value.to_str()).unwrap_or(&project_id);
    let preview_url = preview.pointer("/result/studioUrl").and_then(Value::as_str).map(str::to_owned).unwrap_or_else(|| format!("{server_url}/#project/{name}"));
    Ok(Json(StudioResponse { storyboard_url: format!("{server_url}/?view=storyboard#project/{name}"), preview_url }))
}

async fn mark_agent_studio_dirty(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let mut manifest = state.agent_projects.manifest(&project_id).await.map_err(ApiError::Project)?;
    manifest.dirty = true;
    state.agent_projects.write_manifest(&project_id, &manifest).await.map_err(ApiError::Project)?;
    state.agent_projects.update_project(&project_id, |record| { record.status_label = "Studio 中有未验证的修改".to_owned(); }).await.map_err(ApiError::Project)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn agent_project_file(
    State(state): State<AppState>,
    Path((project_id, path)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let project_root = fs::canonicalize(state.agent_projects.project_dir(&project_id).map_err(ApiError::Project)?).await?;
    let file_path = fs::canonicalize(state.agent_projects.resolve_relative(&project_id, &path).map_err(ApiError::Project)?).await?;
    if !file_path.starts_with(&project_root) { return Err(ApiError::BadRequest("project file escapes workspace".to_owned())); }
    let metadata = fs::metadata(&file_path).await?;
    if !metadata.is_file() { return Err(ApiError::BadRequest("not a file".to_owned())); }
    let total = metadata.len();
    let modified = metadata.modified().ok().and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |value| value.as_secs());
    let etag = format!("\"{total:x}-{modified:x}\"");
    if headers.get(IF_NONE_MATCH).and_then(|value| value.to_str().ok()) == Some(etag.as_str()) {
        let mut response = StatusCode::NOT_MODIFIED.into_response();
        response.headers_mut().insert(ETAG, etag.parse().expect("etag header"));
        return Ok(response);
    }
    let mime = content_type_for_path(&file_path);
    let range = headers.get(RANGE).and_then(|value| value.to_str().ok()).and_then(|value| parse_byte_range(value, total));
    let (start, end, status) = range.map_or((0, total.saturating_sub(1), StatusCode::OK), |(start, end)| (start, end, StatusCode::PARTIAL_CONTENT));
    let length = if total == 0 { 0 } else { end - start + 1 };
    let mut file = fs::File::open(&file_path).await?;
    file.seek(std::io::SeekFrom::Start(start)).await?;
    let mut bytes = vec![0; length as usize];
    if length > 0 { file.read_exact(&mut bytes).await?; }
    let mut response = (status, bytes).into_response();
    let response_headers = response.headers_mut();
    response_headers.insert(CONTENT_TYPE, mime.parse().unwrap_or_else(|_| "application/octet-stream".parse().expect("static mime")));
    response_headers.insert(ACCEPT_RANGES, "bytes".parse().expect("static header"));
    response_headers.insert(CONTENT_LENGTH, length.to_string().parse().expect("numeric header"));
    response_headers.insert(ETAG, etag.parse().expect("etag header"));
    if status == StatusCode::PARTIAL_CONTENT { response_headers.insert(CONTENT_RANGE, format!("bytes {start}-{end}/{total}").parse().expect("range header")); }
    Ok(response)
}

fn parse_byte_range(value: &str, total: u64) -> Option<(u64, u64)> {
    let value = value.strip_prefix("bytes=")?.split(',').next()?;
    let (start, end) = value.split_once('-')?;
    if total == 0 { return None; }
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?.min(total);
        return Some((total - suffix, total - 1));
    }
    let start = start.parse::<u64>().ok()?;
    if start >= total { return None; }
    let end = if end.is_empty() { total - 1 } else { end.parse::<u64>().ok()?.min(total - 1) };
    (start <= end).then_some((start, end))
}

fn content_type_for_path(path: &FilePath) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or_default().to_ascii_lowercase().as_str() {
        "mp4" => "video/mp4", "webm" => "video/webm", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg", "svg" => "image/svg+xml", "json" => "application/json", "md" => "text/markdown; charset=utf-8", "html" => "text/html; charset=utf-8", "css" => "text/css; charset=utf-8", "js" | "mjs" => "text/javascript; charset=utf-8", "wav" => "audio/wav", "mp3" => "audio/mpeg", _ => "application/octet-stream",
    }
}

async fn try_start_next_agent_turn(state: AppState, project_id: String) -> Result<(), ApiError> {
    if state.agent_jobs.lock().await.contains_key(&project_id) { return Ok(()); }
    let Some(queued) = state.agent_projects.dequeue(&project_id).await.map_err(ApiError::Project)? else { return Ok(()); };
    let cancellation = TurnCancellation::default();
    state.agent_jobs.lock().await.insert(project_id.clone(), ActiveAgentTurn {
        cancellation: cancellation.clone(),
        request_id: queued.id.clone(),
        context: queued.context.clone(),
    });
    state.agent_projects.update_project(&project_id, |record| { record.active_turn_id = Some(queued.id.clone()); record.status = "running".to_owned(); record.status_label = "Codex 正在执行".to_owned(); }).await.map_err(ApiError::Project)?;
    let run_state = state.clone();
    tokio::spawn(async move { run_agent_queue(run_state, project_id, queued, cancellation).await; });
    Ok(())
}

async fn run_agent_queue(state: AppState, project_id: String, mut queued: QueuedTurn, mut cancellation: TurnCancellation) {
    loop {
        run_agent_turn(&state, &project_id, queued, &cancellation).await;
        let next = state.agent_projects.dequeue(&project_id).await.ok().flatten();
        let Some(next) = next else {
            state.agent_jobs.lock().await.remove(&project_id);
            break;
        };
        cancellation = TurnCancellation::default();
        state.agent_jobs.lock().await.insert(project_id.clone(), ActiveAgentTurn {
            cancellation: cancellation.clone(),
            request_id: next.id.clone(),
            context: next.context.clone(),
        });
        let _ = state.agent_projects.update_project(&project_id, |record| {
            record.active_turn_id = Some(next.id.clone());
            record.status = "running".to_owned();
            record.status_label = "Codex 正在执行队列中的请求".to_owned();
        }).await;
        queued = next;
    }
}

async fn run_agent_turn(state: &AppState, project_id: &str, queued: QueuedTurn, cancellation: &TurnCancellation) {
    let project = match state.agent_projects.read_project(project_id).await { Ok(value) => value, Err(_) => return };
    let Some(mut thread_id) = project.thread_id.clone() else { return; };
    let manifest = state.agent_projects.manifest(project_id).await.unwrap_or_default();
    let attachment_note = if queued.attachments.is_empty() { String::new() } else { format!("\n项目附件：{}", queued.attachments.join(", ")) };
    let context_note = if queued.context.is_empty() { String::new() } else { format!("\n当前反馈上下文：{}", queued.context.join(" · ")) };
    let dirty_note = if manifest.dirty { "\nHyperFrames Studio 或上次中断留下了未验证改动。先检查当前工作区，再决定复用或修复；不要覆盖用户的手动修改。" } else { "" };
    let prompt = format!("用户请求：{}{}{}{}\n所有工作必须限制在当前项目目录。按照 yingya-video-agent skill 管理 checkpoint、manifest、质量检查与版本。不得在项目 turn 中安装或更新任何 skill、plugin、CLI 或全局依赖；缺少可选能力时直接使用已安装的 HyperFrames 核心能力或说明 fallback。", queued.text, attachment_note, context_note, dirty_note);
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<Value>();
    let event_store = state.agent_projects.clone();
    let event_bus = state.agent_events.clone();
    let event_project = project_id.to_owned();
    let event_task = tokio::spawn(async move {
        while let Some(raw) = event_rx.recv().await {
            let method = raw.get("method").and_then(Value::as_str).unwrap_or("codex/event").to_owned();
            let turn_id = raw.pointer("/params/turnId").or_else(|| raw.pointer("/params/turn/id")).and_then(Value::as_str).map(str::to_owned);
            if let Ok(event) = event_store.append_event(&event_project, turn_id, method, raw).await { let _ = event_bus.send(event); }
        }
    });
    let result = state.codex.run_turn(&thread_id, &prompt, &[], TurnOptions {
        use_imagegen: false,
        model: Some(queued.model.as_deref().unwrap_or(&project.model)),
        effort: Some(queued.reasoning_effort.as_deref().unwrap_or(&project.reasoning_effort)),
        cancellation: Some(cancellation),
        use_video_agent: true,
        event_tx: Some(event_tx.clone()),
    }).await;
    let result = match result {
        Err(error) if is_thread_not_found(&error) && !cancellation.is_cancelled() => {
            let project_dir = match state.agent_projects.project_dir(project_id) {
                Ok(path) => path,
                Err(message) => {
                    drop(event_tx);
                    let _ = event_task.await;
                    let _ = state.agent_projects.update_project(project_id, |record| {
                        record.active_turn_id = None;
                        record.status = "failed".to_owned();
                        record.status_label = format!("Codex 执行失败：{message}");
                    }).await;
                    return;
                }
            };
            match state.codex.start_thread_at(&project_dir, Some(&project.model)).await {
                Ok(thread) => {
                    thread_id = thread.thread_id;
                    let _ = state.agent_projects.update_project(project_id, |record| {
                        record.thread_id = Some(thread_id.clone());
                        record.status_label = "Codex 会话已恢复，正在继续执行".to_owned();
                    }).await;
                    state.codex.run_turn(&thread_id, &prompt, &[], TurnOptions {
                        use_imagegen: false,
                        model: Some(queued.model.as_deref().unwrap_or(&project.model)),
                        effort: Some(queued.reasoning_effort.as_deref().unwrap_or(&project.reasoning_effort)),
                        cancellation: Some(cancellation),
                        use_video_agent: true,
                        event_tx: Some(event_tx.clone()),
                    }).await
                }
                Err(start_error) => Err(start_error),
            }
        }
        result => result,
    };
    drop(event_tx);
    let _ = event_task.await;
    match result {
        Ok(turn) => {
            if !turn.text.trim().is_empty() { let _ = state.agent_projects.append_message(project_id, "assistant", &turn.text, vec![], vec![], "completed").await; }
            let manifest = state.agent_projects.manifest(project_id).await.unwrap_or_default();
            let (status, label) = match manifest.checkpoint.as_ref().map(|value| value.kind.as_str()) {
                Some("plan") => ("waiting_plan", "制作方案等待确认"),
                Some("draft") => ("draft_review", "草稿等待确认"),
                _ if manifest.phase == "completed" => ("completed", "高清成片已完成"),
                _ => ("idle", "等待下一条指令"),
            };
            let _ = state.agent_projects.update_project(project_id, |record| { record.active_turn_id = None; record.status = status.to_owned(); record.status_label = label.to_owned(); }).await;
        }
        Err(error) => {
            let interrupted = matches!(error, CodexError::TurnInterrupted(_)) || cancellation.is_cancelled();
            let mut manifest = state.agent_projects.manifest(project_id).await.unwrap_or_default(); manifest.dirty = true; let _ = state.agent_projects.write_manifest(project_id, &manifest).await;
            let _ = state.agent_projects.update_project(project_id, |record| { record.active_turn_id = None; record.status = if interrupted { "interrupted" } else { "failed" }.to_owned(); record.status_label = if interrupted { "运行已中断".to_owned() } else { format!("Codex 执行失败：{error}") }; }).await;
        }
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
    validate_model_settings(model, effort).map_err(ApiError::BadRequest)?;

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

async fn list_projects(
    State(state): State<AppState>,
) -> Result<Json<Vec<ProjectRecord>>, ApiError> {
    Ok(Json(
        state.projects.list().await.map_err(ApiError::Project)?,
    ))
}

async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<ProjectDetail>, ApiError> {
    Ok(Json(
        state
            .projects
            .get(&project_id)
            .await
            .map_err(ApiError::Project)?,
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

async fn create_project(
    State(state): State<AppState>,
    Json(request): Json<CreateProjectRequest>,
) -> Result<(StatusCode, Json<ProjectDetail>), ApiError> {
    let mut detail = state
        .projects
        .create(request)
        .await
        .map_err(ApiError::Project)?;
    let project_dir = state
        .projects
        .project_dir(&detail.project.id)
        .map_err(ApiError::Project)?;
    let thread = state
        .codex
        .start_thread_at(&project_dir, Some(&detail.project.model))
        .await?;
    detail.project = state
        .projects
        .update_project(&detail.project.id, |project| {
            project.thread_id = Some(thread.thread_id.clone());
        })
        .await
        .map_err(ApiError::Project)?;
    let project_id = detail.project.id.clone();
    spawn_project_job(
        state.clone(),
        project_id.clone(),
        ProjectJobSpec {
            action: "discovery".to_owned(),
            instruction: String::new(),
            scene_ids: vec![],
            user_message: None,
            resume_state: None,
            model: None,
            reasoning_effort: None,
        },
    )
    .await?;
    detail = state
        .projects
        .get(&project_id)
        .await
        .map_err(ApiError::Project)?;
    Ok((StatusCode::CREATED, Json(detail)))
}

async fn post_message(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<MessageRequest>,
) -> Result<Json<ActionResponse>, ApiError> {
    let current = state
        .projects
        .read_project(&project_id)
        .await
        .map_err(ApiError::Project)?;
    let action = message_action(&current.status, &request.text);
    let resume_state = (action == "chatting").then(|| ProjectResumeState {
        status: current.status.clone(),
        status_label: current.status_label.clone(),
        current_view: current.current_view.clone(),
        progress: current.progress,
    });
    let job_id = spawn_project_job(
        state,
        project_id,
        ProjectJobSpec {
            action: action.to_owned(),
            instruction: request.text.clone(),
            scene_ids: vec![],
            user_message: Some(request.text),
            resume_state,
            model: request.model,
            reasoning_effort: request.reasoning_effort,
        },
    )
    .await?;
    Ok(Json(ActionResponse {
        job_id,
        status: "running".to_owned(),
    }))
}

async fn start_project_studio(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<StudioResponse>, ApiError> {
    use std::hash::{Hash, Hasher};
    let _studio_guard = state.studio_lock.lock().await;
    let project_dir = state
        .projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    project_id.hash(&mut hasher);
    let port = 8600 + (hasher.finish() % 100) as u16;
    let status = run_preview_command(&state, &project_dir, &["--status"]).await?;
    let reusable = status.pointer("/result/state").and_then(Value::as_str) == Some("running")
        && status.pointer("/result/host").and_then(Value::as_str) == Some("0.0.0.0")
        && status.pointer("/result/port").and_then(Value::as_u64).is_some_and(|value| (8600..8800).contains(&value));
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
    let name = project_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(&project_id);
    let server_url = preview
        .pointer("/result/serverUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::BadRequest("HyperFrames preview 未返回服务地址".to_owned()))?;
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
        .map_err(|_| ApiError::BadRequest("HyperFrames preview 启动超时".to_owned()))??;
    if !output.status.success() {
        return Err(ApiError::BadRequest(
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find_map(|line| serde_json::from_str(line).ok())
        .ok_or_else(|| ApiError::BadRequest("HyperFrames preview 返回了无效状态".to_owned()))
}

async fn generate_project_image(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<GenerateProjectImageRequest>,
) -> Result<Json<GenerateProjectImageResponse>, ApiError> {
    let job_id = Uuid::new_v4().to_string();
    let cancellation = reserve_project_job(&state, &project_id, &job_id).await?;
    let result =
        generate_project_image_inner(state.clone(), project_id.clone(), request, &cancellation)
            .await;
    release_project_job(&state, &project_id, &job_id).await;
    result
}

async fn generate_project_image_inner(
    state: AppState,
    project_id: String,
    request: GenerateProjectImageRequest,
    cancellation: &TurnCancellation,
) -> Result<Json<GenerateProjectImageResponse>, ApiError> {
    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err(ApiError::BadRequest("参考图描述不能为空".to_owned()));
    }
    state
        .projects
        .update_model_settings(
            &project_id,
            request.model.as_deref(),
            request.reasoning_effort.as_deref(),
        )
        .await
        .map_err(ApiError::Project)?;
    let project = state
        .projects
        .read_project(&project_id)
        .await
        .map_err(ApiError::Project)?;
    let turn = run_isolated_project_codex_turn(
        &state,
        &project_id,
        &format!(
            "为当前视频项目生成一张高质量参考图。画幅为 {}。图像将作为视觉风格和镜头素材参考，不要添加文字、水印或界面边框。用户描述：{}",
            project.aspect_ratio, prompt
        ),
        true,
        Some(cancellation),
    )
    .await?;
    let project_dir = state
        .projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    fs::create_dir_all(project_dir.join("assets/generated")).await?;
    let mut assets = Vec::new();
    for event in turn.generated_images {
        let Some(source) = event.saved_path else {
            if event.status == "failed" {
                continue;
            }
            return Err(ApiError::Codex(CodexError::MissingGeneratedImage(
                event.failure.unwrap_or(event.id),
            )));
        };
        let extension = generated_extension(&source)?;
        let filename = format!("{}.{}", Uuid::new_v4(), extension);
        fs::copy(
            &source,
            project_dir.join("assets/generated").join(&filename),
        )
        .await?;
        let asset = AssetRecord {
            id: event.id,
            name: format!("参考图-{}.{}", assets.len() + 1, extension),
            url: format!("/project-files/{project_id}/assets/generated/{filename}"),
            hyperframes_path: format!("assets/generated/{filename}"),
            kind: extension.to_owned(),
            source: "imagegen".to_owned(),
            media_type: None,
            duration_seconds: None,
            provider_id: None,
            description: None,
            created_at: now(),
        };
        state
            .projects
            .append_asset(&project_id, asset.clone())
            .await
            .map_err(ApiError::Project)?;
        assets.push(asset);
    }
    if assets.is_empty() {
        return Err(ApiError::BadRequest(
            "ImageGen 没有返回可保存的图片，请调整描述后重试".to_owned(),
        ));
    }
    emit_event(
        &state,
        &project_id,
        None,
        "asset.added",
        "参考图已生成",
        project.progress,
    );
    Ok(Json(GenerateProjectImageResponse {
        text: turn.text,
        assets,
    }))
}

async fn patch_scene(
    State(state): State<AppState>,
    Path((project_id, scene_id)): Path<(String, String)>,
    Json(patch): Json<PatchSceneRequest>,
) -> Result<Json<ProjectDetail>, ApiError> {
    let operation_id = Uuid::new_v4().to_string();
    reserve_project_job(&state, &project_id, &operation_id).await?;
    let result = state
        .projects
        .patch_scene(&project_id, &scene_id, patch)
        .await
        .map_err(ApiError::Project);
    release_project_job(&state, &project_id, &operation_id).await;
    let detail = result?;
    emit_event(
        &state,
        &project_id,
        None,
        "scene.dirty",
        "镜头修改已保存",
        detail.project.progress,
    );
    Ok(Json(detail))
}

async fn project_action(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<ProjectActionRequest>,
) -> Result<Json<ActionResponse>, ApiError> {
    let detail = state
        .projects
        .get(&project_id)
        .await
        .map_err(ApiError::Project)?;
    if request.action == "cancel" {
        let active_job = state.jobs.lock().await.get(&project_id).map(|job| {
            (
                job.id.clone(),
                job.cancellation.clone(),
                Arc::clone(&job.completion),
            )
        });
        if let Some((job_id, cancellation, completion)) = active_job {
            cancellation.cancel();
            let wait_for_completion = async {
                loop {
                    let notified = completion.notified();
                    if state
                        .jobs
                        .lock()
                        .await
                        .get(&project_id)
                        .is_none_or(|job| job.id != job_id)
                    {
                        break;
                    }
                    notified.await;
                }
            };
            let _ = tokio::time::timeout(Duration::from_secs(10), wait_for_completion).await;
        }
        state
            .projects
            .update_project(&project_id, |project| {
                project.status = "cancelled".to_owned();
                project.status_label = "任务已取消，可随时重试".to_owned();
                project.active_job_id = None;
                project.job_step = None;
            })
            .await
            .map_err(ApiError::Project)?;
        emit_event(&state, &project_id, None, "job.cancelled", "任务已取消", 0);
        return Ok(Json(ActionResponse {
            job_id: "cancelled".to_owned(),
            status: "cancelled".to_owned(),
        }));
    }
    if request.action == "approve-script" && detail.project.status == "asset_review" {
        return Ok(Json(ActionResponse {
            job_id: "already-approved".to_owned(),
            status: "succeeded".to_owned(),
        }));
    }
    validate_project_action(&detail.project.status, &request.action)?;
    let action = match request.action.as_str() {
        "draft-script" | "revise-script" => "drafting",
        "approve-script" => {
            let operation_id = Uuid::new_v4().to_string();
            reserve_project_job(&state, &project_id, &operation_id).await?;
            let result = async {
                state
                .projects
                .update_project(&project_id, |project| {
                    project.status = "asset_review".to_owned();
                    project.status_label = "剧本已确认，正在准备素材".to_owned();
                    project.current_view = "assets".to_owned();
                    project.progress = 34;
                })
                .await
                .map_err(ApiError::Project)?;
                state
                .projects
                .append_message(
                    &project_id,
                    "assistant",
                    "剧本已确认。接下来我会按场景检查素材需求：你可以生成参考图、上传已有资料，再把素材匹配到对应场景。没有绑定素材的场景会使用动态排版或程序化图解。",
                )
                .await
                .map_err(ApiError::Project)?;
                emit_event(
                    &state,
                    &project_id,
                    None,
                    "script.approved",
                    "剧本已确认",
                    34,
                );
                Ok(Json(ActionResponse {
                    job_id: "approved".to_owned(),
                    status: "succeeded".to_owned(),
                }))
            }
            .await;
            release_project_job(&state, &project_id, &operation_id).await;
            return result;
        }
        "approve-assets" => "building",
        "approve-plan" | "build" => "building",
        "revise" => "revising",
        "render-final" => "finalizing",
        "retry" => "retrying",
        _ => {
            return Err(ApiError::BadRequest(
                "unsupported project action".to_owned(),
            ));
        }
    };
    let job_id = spawn_project_job(
        state,
        project_id,
        ProjectJobSpec {
            action: action.to_owned(),
            instruction: request.instruction,
            scene_ids: request.scene_ids,
            user_message: None,
            resume_state: None,
            model: request.model,
            reasoning_effort: request.reasoning_effort,
        },
    )
    .await?;
    Ok(Json(ActionResponse {
        job_id,
        status: "queued".to_owned(),
    }))
}

async fn upload_project_asset(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, ApiError> {
    let project_dir = state
        .projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
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
            .filter(|value| {
                value.len() <= 8 && value.chars().all(|char| char.is_ascii_alphanumeric())
            })
            .unwrap_or("bin")
            .to_ascii_lowercase();
        let bytes = field
            .bytes()
            .await
            .map_err(|error| ApiError::BadRequest(error.to_string()))?;
        if bytes.is_empty() {
            return Err(ApiError::BadRequest("uploaded asset is empty".to_owned()));
        }
        let filename = format!("{}.{}", Uuid::new_v4(), extension);
        fs::write(project_dir.join("assets/uploads").join(&filename), bytes).await?;
        let asset = AssetRecord {
            id: Uuid::new_v4().to_string(),
            name: original,
            url: format!("/project-files/{project_id}/assets/uploads/{filename}"),
            hyperframes_path: format!("assets/uploads/{filename}"),
            kind: extension.clone(),
            source: "upload".to_owned(),
            media_type: None,
            duration_seconds: None,
            provider_id: None,
            description: None,
            created_at: now(),
        };
        state
            .projects
            .append_asset(&project_id, asset)
            .await
            .map_err(ApiError::Project)?;
        emit_event(&state, &project_id, None, "asset.added", "素材已上传", 34);
        return Ok(Json(UploadResponse {
            url: format!("/project-files/{project_id}/assets/uploads/{filename}"),
            hyperframes_path: format!("assets/uploads/{filename}"),
        }));
    }
    Err(ApiError::BadRequest(
        "multipart field `file` is required".to_owned(),
    ))
}

async fn import_heygen_audio(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(request): Json<ImportHeyGenAudioRequest>,
) -> Result<Json<AssetRecord>, ApiError> {
    let query = request.query.trim();
    if query.is_empty() || request.id.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "HeyGen 音频 id 和搜索描述不能为空".to_owned(),
        ));
    }
    let audio_type = normalize_audio_type(&request.audio_type)?;
    state
        .projects
        .read_project(&project_id)
        .await
        .map_err(ApiError::Project)?;

    let existing = state
        .projects
        .read_assets(&project_id)
        .await
        .map_err(ApiError::Project)?;
    if let Some(asset) = existing
        .into_iter()
        .find(|asset| asset.provider_id.as_deref() == Some(request.id.as_str()))
    {
        return Ok(Json(asset));
    }

    // Re-run the trusted server-side search instead of accepting an arbitrary
    // download URL from the browser. This also refreshes expired signed URLs.
    let results = state
        .heygen
        .search_audio(query, audio_type, 50, 0.0)
        .await?;
    let sound = results
        .data
        .into_iter()
        .find(|sound| sound.id == request.id)
        .ok_or_else(|| ApiError::BadRequest("HeyGen 音频已失效，请重新搜索".to_owned()))?;
    let bytes = state.heygen.download_audio(&sound.audio_url).await?;
    let extension = audio_extension(&bytes)
        .ok_or_else(|| ApiError::External("HeyGen 返回了无法识别的音频文件格式".to_owned()))?;

    let project_dir = state
        .projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    let audio_dir = project_dir.join("assets/audio");
    fs::create_dir_all(&audio_dir).await?;
    let filename = format!("{}.{}", Uuid::new_v4(), extension);
    fs::write(audio_dir.join(&filename), bytes).await?;
    let asset = AssetRecord {
        id: Uuid::new_v4().to_string(),
        name: sound.name,
        url: format!("/project-files/{project_id}/assets/audio/{filename}"),
        hyperframes_path: format!("assets/audio/{filename}"),
        kind: extension.to_owned(),
        source: "heygen".to_owned(),
        media_type: Some(audio_type.to_owned()),
        duration_seconds: Some(sound.duration),
        provider_id: Some(sound.id),
        description: Some(sound.description),
        created_at: now(),
    };
    state
        .projects
        .append_asset(&project_id, asset.clone())
        .await
        .map_err(ApiError::Project)?;
    emit_event(
        &state,
        &project_id,
        None,
        "asset.added",
        if audio_type == "music" {
            "背景音乐已加入项目"
        } else {
            "音效已加入项目"
        },
        34,
    );
    Ok(Json(asset))
}

async fn project_event_stream(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, std::convert::Infallible>>> {
    let stream =
        BroadcastStream::new(state.project_events.subscribe()).filter_map(
            move |event| match event {
                Ok(event) if event.project_id == project_id => {
                    let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_owned());
                    Some(Ok(Event::default().event(&event.kind).data(data)))
                }
                _ => None,
            },
        );
    Sse::new(stream)
}

async fn project_artifact(
    State(state): State<AppState>,
    Path((project_id, name)): Path<(String, String)>,
) -> Result<Response, ApiError> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == "." || name == ".." {
        return Err(ApiError::BadRequest("invalid artifact name".to_owned()));
    }
    let path = state
        .projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?
        .join("artifacts")
        .join(&name);
    let bytes = fs::read(path).await?;
    let mime = match FilePath::new(&name)
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    };
    Ok(([(CONTENT_TYPE, mime)], bytes).into_response())
}

async fn spawn_project_job(
    state: AppState,
    project_id: String,
    spec: ProjectJobSpec,
) -> Result<String, ApiError> {
    let job_id = Uuid::new_v4().to_string();
    let cancellation = reserve_project_job(&state, &project_id, &job_id).await?;
    if let Err(error) = state
        .projects
        .update_model_settings(
            &project_id,
            spec.model.as_deref(),
            spec.reasoning_effort.as_deref(),
        )
        .await
        .map_err(ApiError::Project)
    {
        release_project_job(&state, &project_id, &job_id).await;
        return Err(error);
    }
    if let Some(message) = spec.user_message
        && let Err(error) = state
            .projects
            .append_message(&project_id, "user", &message)
            .await
            .map_err(ApiError::Project)
    {
        release_project_job(&state, &project_id, &job_id).await;
        return Err(error);
    }
    let task_state = state.clone();
    let task_project_id = project_id.clone();
    let task_job_id = job_id.clone();
    let action = spec.action;
    let instruction = spec.instruction;
    let scene_ids = spec.scene_ids;
    let resume_state = spec.resume_state;
    let error_resume_state = resume_state.clone();
    tokio::spawn(async move {
        let result = run_project_job(
            &task_state,
            &task_project_id,
            &task_job_id,
            &action,
            &instruction,
            &scene_ids,
            resume_state.as_ref(),
            &cancellation,
        )
        .await;
        if let Err(error) = result
            && !matches!(error, ApiError::Cancelled)
            && !cancellation.is_cancelled()
        {
            let message = error.to_string();
            let _ = task_state
                .projects
                .update_project(&task_project_id, |project| {
                    if let Some(resume) = &error_resume_state {
                        project.status = resume.status.clone();
                        project.status_label = resume.status_label.clone();
                        project.current_view = resume.current_view.clone();
                        project.progress = resume.progress;
                    } else {
                        project.status = "failed".to_owned();
                        project.status_label = "制作任务失败".to_owned();
                    }
                    project.last_error = Some(message.clone());
                    project.active_job_id = None;
                    project.job_step = None;
                })
                .await;
            emit_event(
                &task_state,
                &task_project_id,
                Some(task_job_id.clone()),
                "job.failed",
                &message,
                0,
            );
        }
        release_project_job(&task_state, &task_project_id, &task_job_id).await;
    });
    Ok(job_id)
}

async fn reserve_project_job(
    state: &AppState,
    project_id: &str,
    job_id: &str,
) -> Result<TurnCancellation, ApiError> {
    let mut jobs = state.jobs.lock().await;
    if jobs.contains_key(project_id) {
        return Err(ApiError::Conflict(
            "当前项目已有任务在运行，请等待完成或先停止任务".to_owned(),
        ));
    }
    let cancellation = TurnCancellation::default();
    let completion = Arc::new(Notify::new());
    jobs.insert(
        project_id.to_owned(),
        ActiveJob {
            id: job_id.to_owned(),
            cancellation: cancellation.clone(),
            completion,
        },
    );
    Ok(cancellation)
}

async fn release_project_job(state: &AppState, project_id: &str, job_id: &str) {
    let mut jobs = state.jobs.lock().await;
    if jobs.get(project_id).is_some_and(|job| job.id == job_id)
        && let Some(job) = jobs.remove(project_id)
    {
        job.completion.notify_one();
    }
}

async fn run_project_job(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    action: &str,
    instruction: &str,
    scene_ids: &[String],
    resume_state: Option<&ProjectResumeState>,
    cancellation: &TurnCancellation,
) -> Result<(), ApiError> {
    if cancellation.is_cancelled() {
        return Err(ApiError::Cancelled);
    }
    let (label, progress) = match action {
        "discovery" => ("导演 Agent 正在理解你的想法", 8),
        "chatting" => (
            "导演 Agent 正在回复你的问题",
            resume_state.map_or(10, |state| state.progress),
        ),
        "drafting" => ("导演 Agent 正在整理剧本", 22),
        "planning" => ("导演 Agent 正在规划场景", 12),
        "finalizing" => ("正在渲染高质量成片", 92),
        "revising" => ("导演 Agent 正在重做受影响镜头", 42),
        _ => ("正在生成画面、配音与字幕", 42),
    };
    state
        .projects
        .update_project(project_id, |project| {
            if resume_state.is_none() {
                project.status = action.to_owned();
                project.progress = progress;
            }
            project.status_label = label.to_owned();
            project.active_job_id = Some(job_id.to_owned());
            project.job_step = Some(
                match action {
                    "discovery" | "chatting" => "discussion",
                    "drafting" => "script",
                    "planning" => "planning",
                    "finalizing" => "final_render",
                    _ => "production",
                }
                .to_owned(),
            );
            project.last_error = None;
        })
        .await
        .map_err(ApiError::Project)?;
    let run = RunRecord {
        id: job_id.to_owned(),
        project_id: project_id.to_owned(),
        action: action.to_owned(),
        status: "running".to_owned(),
        message: label.to_owned(),
        scene_ids: scene_ids.to_vec(),
        created_at: now(),
        finished_at: None,
    };
    state
        .projects
        .append_run(&run)
        .await
        .map_err(ApiError::Project)?;
    emit_event(
        state,
        project_id,
        Some(job_id.to_owned()),
        "job.running",
        label,
        progress,
    );

    if action == "finalizing" {
        run_hyperframes(state, project_id, job_id, true, cancellation).await?;
        if cancellation.is_cancelled() {
            return Err(ApiError::Cancelled);
        }
        state
            .projects
            .update_project(project_id, |project| {
                project.status = "completed".to_owned();
                project.status_label = "高质量成片已导出".to_owned();
                project.progress = 100;
                project.final_url = Some(format!("/api/projects/{project_id}/artifacts/final.mp4"));
                project.active_job_id = None;
                project.job_step = None;
                project.current_view = "review".to_owned();
            })
            .await
            .map_err(ApiError::Project)?;
    } else {
        if !matches!(action, "planning" | "discovery" | "chatting" | "drafting") {
            let mut scenes = state
                .projects
                .read_scenes(project_id)
                .await
                .map_err(ApiError::Project)?;
            for scene in &mut scenes {
                if scene_ids.is_empty() || scene_ids.contains(&scene.id) {
                    scene.status = "generating".to_owned();
                }
            }
            state
                .projects
                .write_scenes(project_id, &scenes)
                .await
                .map_err(ApiError::Project)?;
        }
        let prompt = if action == "drafting" {
            drafting_prompt(state, project_id, instruction).await?
        } else {
            agent_prompt(action, instruction, scene_ids)
        };
        let turn = if matches!(action, "discovery" | "chatting") {
            run_project_codex_turn(state, project_id, &prompt, false, Some(cancellation)).await?
        } else {
            run_isolated_project_codex_turn(state, project_id, &prompt, false, Some(cancellation))
                .await?
        };
        if cancellation.is_cancelled() {
            return Err(ApiError::Cancelled);
        }
        if matches!(action, "discovery" | "chatting") {
            state
                .projects
                .append_message(project_id, "assistant", &turn.text)
                .await
                .map_err(ApiError::Project)?;
            state
                .projects
                .update_project(project_id, |project| {
                    if let Some(resume) = resume_state {
                        project.status = resume.status.clone();
                        project.status_label = resume.status_label.clone();
                        project.progress = resume.progress;
                        project.current_view = resume.current_view.clone();
                    } else {
                        project.status = "discovery".to_owned();
                        project.status_label = "继续和导演讨论".to_owned();
                        project.progress = 10;
                        project.current_view = "conversation".to_owned();
                    }
                    project.active_job_id = None;
                    project.job_step = None;
                })
                .await
                .map_err(ApiError::Project)?;
        } else if action == "drafting" {
            let draft = parse_draft_script(&turn.text)?;
            let scene_count = draft.scenes.len();
            if !(3..=12).contains(&scene_count) {
                return Err(ApiError::BadRequest(
                    "剧本必须包含 3 到 12 个场景".to_owned(),
                ));
            }
            let project = state
                .projects
                .read_project(project_id)
                .await
                .map_err(ApiError::Project)?;
            let default_duration = project.duration_seconds as f32 / scene_count as f32;
            let scenes = draft
                .scenes
                .into_iter()
                .enumerate()
                .map(|(index, scene)| {
                    let duration_seconds = scene.duration_seconds.unwrap_or(default_duration);
                    if !(1.0..=30.0).contains(&duration_seconds) {
                        return Err(ApiError::BadRequest(format!(
                            "场景 {} 时长必须在 1 到 30 秒之间",
                            index + 1
                        )));
                    }
                    Ok(SceneRecord {
                        id: format!("scene-{:02}", index + 1),
                        order: index + 1,
                        narrative_role: scene.narrative_role,
                        narration: scene.narration,
                        visual_direction: scene.visual_direction,
                        duration_seconds,
                        asset_strategy: scene.asset_strategy,
                        motion_blueprint: scene.motion_blueprint,
                        caption_mode: "智能匹配".to_owned(),
                        transition: scene.transition,
                        status: "draft".to_owned(),
                        thumbnail_url: None,
                        asset_ids: Vec::new(),
                        version: 1,
                    })
                })
                .collect::<Result<Vec<_>, ApiError>>()?;
            state
                .projects
                .write_scenes(project_id, &scenes)
                .await
                .map_err(ApiError::Project)?;
            state
                .projects
                .write_source_files(&project, &scenes)
                .await
                .map_err(ApiError::Project)?;
            state
                .projects
                .append_message(project_id, "assistant", &draft.summary)
                .await
                .map_err(ApiError::Project)?;
            state
                .projects
                .update_project(project_id, |project| {
                    project.status = "script_review".to_owned();
                    project.status_label = "剧本等待确认".to_owned();
                    project.progress = 28;
                    project.active_job_id = None;
                    project.job_step = None;
                    project.current_view = "script".to_owned();
                })
                .await
                .map_err(ApiError::Project)?;
        } else if action == "planning" {
            let scenes = state
                .projects
                .read_scenes(project_id)
                .await
                .map_err(ApiError::Project)?;
            state
                .projects
                .update_project(project_id, |project| {
                    project.status = "plan_review".to_owned();
                    project.status_label = "场景方案等待确认".to_owned();
                    project.progress = 28;
                    project.active_job_id = None;
                    project.job_step = None;
                    project.current_view = "scenes".to_owned();
                })
                .await
                .map_err(ApiError::Project)?;
            if scenes.iter().any(|scene| scene.status == "failed") {
                return Err(ApiError::BadRequest(
                    "Agent returned a failed scene".to_owned(),
                ));
            }
        } else {
            run_hyperframes(state, project_id, job_id, false, cancellation).await?;
            if cancellation.is_cancelled() {
                return Err(ApiError::Cancelled);
            }
            let mut scenes = state
                .projects
                .read_scenes(project_id)
                .await
                .map_err(ApiError::Project)?;
            for scene in &mut scenes {
                if scene_ids.is_empty() || scene_ids.contains(&scene.id) {
                    scene.status = "ready".to_owned();
                }
            }
            state
                .projects
                .write_scenes(project_id, &scenes)
                .await
                .map_err(ApiError::Project)?;
            state
                .projects
                .update_project(project_id, |project| {
                    project.status = "review_ready".to_owned();
                    project.status_label = "草稿成片等待确认".to_owned();
                    project.progress = 86;
                    project.draft_url =
                        Some(format!("/api/projects/{project_id}/artifacts/draft.mp4"));
                    project.active_job_id = None;
                    project.job_step = None;
                    project.current_view = "review".to_owned();
                })
                .await
                .map_err(ApiError::Project)?;
        }
    }
    if cancellation.is_cancelled() {
        return Err(ApiError::Cancelled);
    }
    let completed = RunRecord {
        status: "succeeded".to_owned(),
        message: "任务完成".to_owned(),
        finished_at: Some(now()),
        ..run
    };
    state
        .projects
        .append_run(&completed)
        .await
        .map_err(ApiError::Project)?;
    emit_event(
        state,
        project_id,
        Some(job_id.to_owned()),
        "job.succeeded",
        "任务完成",
        100,
    );
    Ok(())
}

async fn drafting_prompt(
    state: &AppState,
    project_id: &str,
    instruction: &str,
) -> Result<String, ApiError> {
    let project = state
        .projects
        .read_project(project_id)
        .await
        .map_err(ApiError::Project)?;
    let messages = state
        .projects
        .read_messages(project_id)
        .await
        .map_err(ApiError::Project)?;
    let conversation = serde_json::to_string(&messages)
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;
    Ok(format!(
        "你是映芽的导演 Agent。不要调用任何工具，不要读写文件，只根据下面提供的项目和完整对话生成可确认的中文无脸口播剧本。面向用户已经确认的受众与表达要求，不要重新提问，不要擅自加入被排除的内容。输出只能是一个 JSON 对象，不要 Markdown、解释或代码围栏。JSON 必须严格使用以下结构：{{\"summary\":\"已整理剧本，请在右侧确认。\",\"scenes\":[{{\"narrativeRole\":\"场景作用\",\"narration\":\"可直接配音的旁白\",\"visualDirection\":\"明确画面内容与构图\",\"assetStrategy\":\"用户素材/ImageGen/程序化图解/动态排版之一\",\"motionBlueprint\":\"简洁动效说明\",\"transition\":\"转场说明\",\"durationSeconds\":8}}]}}。生成 4 到 8 个场景，旁白连贯完整。项目主题：{}。画幅：{}。补充要求：{}。完整对话 JSON：{}",
        project.prompt,
        project.aspect_ratio,
        if instruction.trim().is_empty() {
            "根据当前讨论整理"
        } else {
            instruction.trim()
        },
        conversation
    ))
}

fn parse_draft_script(text: &str) -> Result<DraftScriptOutput, ApiError> {
    let start = text
        .find('{')
        .ok_or_else(|| ApiError::BadRequest("Agent 未返回结构化剧本".to_owned()))?;
    let end = text
        .rfind('}')
        .ok_or_else(|| ApiError::BadRequest("Agent 返回的剧本不完整".to_owned()))?;
    serde_json::from_str(&text[start..=end])
        .map_err(|error| ApiError::BadRequest(format!("剧本 JSON 无法解析：{error}")))
}

fn agent_prompt(action: &str, instruction: &str, scene_ids: &[String]) -> String {
    if action == "discovery" {
        return format!(
            "你是映芽的导演 Agent，现在只做前期创作讨论，不生成图片、视频、分镜或 Composition。读取 project.json 和 messages.json，理解用户想做的视频。根据已有信息自然回应；如果关键内容仍不清楚，一次只问 2 到 4 个真正影响剧本的问题，优先确认受众、核心信息、叙事角度和必须保留的内容。不要询问时长、模型或技术参数。用户最新补充：{}",
            instruction.trim()
        );
    }
    if action == "chatting" {
        return format!(
            "你是映芽的导演 Agent，现在只回答用户关于当前项目、剧本、素材或成片的问题。读取 project.json、messages.json 以及已有剧本和场景文件理解上下文，但不要生成或修改任何文件，不要生成图片、配音、视频或 Composition，也不要推进项目阶段。给出自然、简洁、可继续讨论的中文回答。用户最新问题：{}",
            instruction.trim()
        );
    }
    if action == "planning" {
        return "你是映芽的导演 Agent。读取当前目录的 BRIEF.md、SCRIPT.md、STORYBOARD.md、frame.md 和 scenes.json。使用 faceless-explainer 工作流，为中文无脸口播完善故事、逐镜头旁白、视觉意图、素材策略、动效蓝图和转场。必须更新上述 Markdown 与 scenes.json；保持 scenes.json 的现有字段结构和合法状态值。此阶段只做方案，不生成视频，完成后简短报告关键导演选择。".to_owned();
    }
    format!(
        "你是映芽的导演 Agent。读取当前项目的 BRIEF.md、SCRIPT.md、STORYBOARD.md、frame.md、scenes.json 和 assets.json，使用 HyperFrames 与可用媒体能力制作无脸口播。scenes.json 中每个场景的 assetIds 是用户明确绑定的素材，必须优先按 assets.json 找到对应 hyperframesPath 并用于该场景；assets.json 中 source=heygen、mediaType=music 的音频是全片背景音乐，即使未绑定镜头也必须加入独立音轨并把旁白期间音量控制在 0.08–0.18；mediaType=sound_effects 的音频应在绑定镜头的关键动作或转场处加入独立音轨。未绑定到场景的 ImageGen 图片可作为全片风格参考，未绑定素材的场景按 assetStrategy 使用程序化图解、动态排版或生成素材。仅重建指定镜头及其下游依赖（空列表表示全片）：{:?}。用户反馈：{}。在当前目录创建或更新可被 HyperFrames CLI 检查和渲染的 composition；生成或复用素材、配音和字幕时间戳，并更新 scenes.json 状态与缩略图路径。不要等待进一步确认。",
        scene_ids,
        if instruction.trim().is_empty() {
            "按已确认方案制作"
        } else {
            instruction.trim()
        }
    )
}

fn wants_script_draft(message: &str) -> bool {
    let compact = message
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    [
        "开始制作",
        "开始创作",
        "开始做",
        "可以开始",
        "继续制作",
        "继续创作",
        "生成剧本",
        "整理剧本",
        "确认方向",
        "方向确认",
    ]
    .iter()
    .any(|intent| compact.contains(intent))
}

fn message_action(status: &str, message: &str) -> &'static str {
    match status {
        "discovery" if wants_script_draft(message) => "drafting",
        "discovery" => "discovery",
        _ => "chatting",
    }
}

fn validate_project_action(status: &str, action: &str) -> Result<(), ApiError> {
    let allowed = match action {
        "draft-script" => status == "discovery",
        "revise-script" => status == "script_review",
        "approve-script" => status == "script_review",
        "approve-assets" | "approve-plan" | "build" => {
            matches!(status, "asset_review" | "plan_review")
        }
        "revise" => matches!(status, "review_ready" | "completed"),
        "render-final" => status == "review_ready",
        "retry" => matches!(status, "failed" | "cancelled"),
        _ => {
            return Err(ApiError::BadRequest(
                "unsupported project action".to_owned(),
            ));
        }
    };
    if allowed {
        Ok(())
    } else {
        Err(ApiError::Conflict(format!(
            "当前阶段 {status} 不能执行 {action}，请按剧本、素材、制作、审阅的顺序继续"
        )))
    }
}

async fn run_project_codex_turn(
    state: &AppState,
    project_id: &str,
    prompt: &str,
    use_imagegen: bool,
    cancellation: Option<&TurnCancellation>,
) -> Result<TurnCompleted, ApiError> {
    let project = state
        .projects
        .read_project(project_id)
        .await
        .map_err(ApiError::Project)?;
    let project_dir = state
        .projects
        .project_dir(project_id)
        .map_err(ApiError::Project)?;
    let thread_id = match project.thread_id {
        Some(thread_id) => thread_id,
        None => {
            let thread = state
                .codex
                .start_thread_at(&project_dir, Some(&project.model))
                .await?;
            state
                .projects
                .update_project(project_id, |project| {
                    project.thread_id = Some(thread.thread_id.clone());
                })
                .await
                .map_err(ApiError::Project)?;
            thread.thread_id
        }
    };
    match state
        .codex
        .run_turn(
            &thread_id,
            prompt,
            &[],
            TurnOptions {
                use_imagegen,
                model: Some(&project.model),
                effort: Some(&project.reasoning_effort),
                cancellation,
                use_video_agent: false,
                event_tx: None,
            },
        )
        .await
    {
        Ok(turn) => Ok(turn),
        Err(CodexError::TurnInterrupted(_)) => Err(ApiError::Cancelled),
        Err(_) if cancellation.is_some_and(TurnCancellation::is_cancelled) => {
            Err(ApiError::Cancelled)
        }
        Err(CodexError::Rpc(message)) if message.contains("thread not found") => {
            if cancellation.is_some_and(TurnCancellation::is_cancelled) {
                return Err(ApiError::Cancelled);
            }
            let thread = state
                .codex
                .start_thread_at(&project_dir, Some(&project.model))
                .await?;
            state
                .projects
                .update_project(project_id, |project| {
                    project.thread_id = Some(thread.thread_id.clone());
                })
                .await
                .map_err(ApiError::Project)?;
            Ok(state
                .codex
                .run_turn(
                    &thread.thread_id,
                    prompt,
                    &[],
                    TurnOptions {
                        use_imagegen,
                        model: Some(&project.model),
                        effort: Some(&project.reasoning_effort),
                        cancellation,
                        use_video_agent: false,
                        event_tx: None,
                    },
                )
                .await
                .map_err(|error| match error {
                    CodexError::TurnInterrupted(_) => ApiError::Cancelled,
                    error => ApiError::Codex(error),
                })?)
        }
        Err(error) => Err(ApiError::Codex(error)),
    }
}

async fn run_isolated_project_codex_turn(
    state: &AppState,
    project_id: &str,
    prompt: &str,
    use_imagegen: bool,
    cancellation: Option<&TurnCancellation>,
) -> Result<TurnCompleted, ApiError> {
    let project = state
        .projects
        .read_project(project_id)
        .await
        .map_err(ApiError::Project)?;
    let project_dir = state
        .projects
        .project_dir(project_id)
        .map_err(ApiError::Project)?;
    let thread = state
        .codex
        .start_thread_at(&project_dir, Some(&project.model))
        .await?;
    state
        .codex
        .run_turn(
            &thread.thread_id,
            prompt,
            &[],
            TurnOptions {
                use_imagegen,
                model: Some(&project.model),
                effort: Some(&project.reasoning_effort),
                cancellation,
                use_video_agent: false,
                event_tx: None,
            },
        )
        .await
        .map_err(|error| match error {
            CodexError::TurnInterrupted(_) => ApiError::Cancelled,
            _ if cancellation.is_some_and(TurnCancellation::is_cancelled) => ApiError::Cancelled,
            error => ApiError::Codex(error),
        })
}

async fn run_hyperframes(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    high_quality: bool,
    cancellation: &TurnCancellation,
) -> Result<(), ApiError> {
    update_job_step(
        state,
        project_id,
        job_id,
        "hyperframes_check",
        "正在运行 HyperFrames 检查",
        if high_quality { 94 } else { 68 },
    )
    .await?;
    let project_dir = state
        .projects
        .project_dir(project_id)
        .map_err(ApiError::Project)?;
    let binary = state.root.join("node_modules/.bin/hyperframes");
    let mut check_command = Command::new(&binary);
    check_command
        .args(["check", "--snapshots"])
        .current_dir(&project_dir)
        .env("HOME", state.hyperframes_home.as_ref())
        .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
        .kill_on_drop(true);
    let check = tokio::select! {
        result = check_command.output() => result?,
        _ = cancellation.cancelled() => return Err(ApiError::Cancelled),
    };
    if !check.status.success() {
        return Err(ApiError::BadRequest(
            String::from_utf8_lossy(&check.stderr).to_string(),
        ));
    }
    let (step, label, progress) = if high_quality {
        ("final_render", "正在渲染高质量成片", 96)
    } else {
        ("preview_render", "正在渲染预览视频", 78)
    };
    update_job_step(state, project_id, job_id, step, label, progress).await?;
    let output_name = if high_quality {
        "artifacts/final.mp4"
    } else {
        "artifacts/draft.mp4"
    };
    let mut command = Command::new(binary);
    command.arg("render").kill_on_drop(true);
    if high_quality {
        command.args(["--quality", "high"]);
    } else {
        command.args(["--quality", "draft"]);
    }
    let render_future = command
        .args(["--output", output_name])
        .current_dir(&project_dir)
        .env("HOME", state.hyperframes_home.as_ref())
        .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
        .output();
    let render = tokio::select! {
        result = render_future => result?,
        _ = cancellation.cancelled() => return Err(ApiError::Cancelled),
    };
    if !render.status.success() {
        return Err(ApiError::BadRequest(
            String::from_utf8_lossy(&render.stderr).to_string(),
        ));
    }
    Ok(())
}

async fn update_job_step(
    state: &AppState,
    project_id: &str,
    job_id: &str,
    step: &str,
    label: &str,
    progress: u8,
) -> Result<(), ApiError> {
    state
        .projects
        .update_project(project_id, |project| {
            if project.active_job_id.as_deref() == Some(job_id) {
                project.job_step = Some(step.to_owned());
                project.status_label = label.to_owned();
                project.progress = progress;
            }
        })
        .await
        .map_err(ApiError::Project)?;
    emit_event(
        state,
        project_id,
        Some(job_id.to_owned()),
        "job.progress",
        label,
        progress,
    );
    Ok(())
}

fn emit_event(
    state: &AppState,
    project_id: &str,
    job_id: Option<String>,
    kind: &str,
    message: &str,
    progress: u8,
) {
    let _ = state.project_events.send(ProjectEvent {
        project_id: project_id.to_owned(),
        job_id,
        kind: kind.to_owned(),
        message: message.to_owned(),
        progress,
        timestamp: now(),
    });
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
        _ => Err(ApiError::BadRequest(
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

impl HeyGenClient {
    fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(45))
                .build()?,
            api_key: env::var("HEYGEN_API_KEY")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .map(Arc::<str>::from),
        })
    }

    fn api_key(&self) -> Result<&str, ApiError> {
        self.api_key
            .as_deref()
            .ok_or_else(|| ApiError::External("服务端尚未配置 HEYGEN_API_KEY".to_owned()))
    }

    async fn search_audio(
        &self,
        query: &str,
        audio_type: &str,
        limit: u8,
        min_score: f32,
    ) -> Result<HeyGenAudioSearchResponse, ApiError> {
        let response = self
            .http
            .get("https://api.heygen.com/v3/audio/sounds")
            .header("X-Api-Key", self.api_key()?)
            .query(&[
                ("query", query.to_owned()),
                ("type", audio_type.to_owned()),
                ("limit", limit.to_string()),
                ("min_score", min_score.to_string()),
            ])
            .send()
            .await
            .map_err(|error| ApiError::External(format!("无法连接 HeyGen：{error}")))?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            return Err(ApiError::External(format!(
                "HeyGen 音频搜索失败（{status}）：{}",
                compact_external_error(&message)
            )));
        }
        response
            .json::<HeyGenAudioSearchResponse>()
            .await
            .map_err(|error| ApiError::External(format!("HeyGen 响应无法解析：{error}")))
    }

    async fn download_audio(&self, url: &str) -> Result<Vec<u8>, ApiError> {
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|error| ApiError::External(format!("下载 HeyGen 音频失败：{error}")))?;
        if !response.status().is_success() {
            return Err(ApiError::External(format!(
                "下载 HeyGen 音频失败（{}）",
                response.status()
            )));
        }
        if response
            .content_length()
            .is_some_and(|size| size > 100 * 1024 * 1024)
        {
            return Err(ApiError::External(
                "HeyGen 音频超过 100 MiB 安全限制".to_owned(),
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| ApiError::External(format!("读取 HeyGen 音频失败：{error}")))?;
        if bytes.len() > 100 * 1024 * 1024 {
            return Err(ApiError::External(
                "HeyGen 音频超过 100 MiB 安全限制".to_owned(),
            ));
        }
        Ok(bytes.to_vec())
    }
}

fn compact_external_error(value: &str) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.is_empty() {
        "未知错误".to_owned()
    } else {
        compact.chars().take(300).collect()
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
        _ => Err(ApiError::BadRequest(format!(
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

async fn discover_hyperframes_browser(root: &FilePath) -> Option<PathBuf> {
    if let Some(path) = env::var_os("YINGYA_HYPERFRAMES_BROWSER_PATH") {
        return Some(PathBuf::from(path));
    }

    let output = tokio::process::Command::new(root.join("node_modules/.bin/hyperframes"))
        .args(["browser", "path"])
        .env("HOME", root.join(".runtime/hyperframes-home"))
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
    Conflict(String),
    Project(String),
    External(String),
    Codex(CodexError),
    Io(std::io::Error),
    Cancelled,
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadRequest(message)
            | Self::Conflict(message)
            | Self::Project(message)
            | Self::External(message) => formatter.write_str(message),
            Self::Codex(error) => error.fmt(formatter),
            Self::Io(error) => error.fmt(formatter),
            Self::Cancelled => formatter.write_str("task cancelled"),
        }
    }
}

impl From<CodexError> for ApiError {
    fn from(error: CodexError) -> Self {
        Self::Codex(error)
    }
}

impl From<std::io::Error> for ApiError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, message),
            Self::Conflict(message) => (StatusCode::CONFLICT, message),
            Self::Project(message) => (StatusCode::BAD_REQUEST, message),
            Self::External(message) => (StatusCode::BAD_GATEWAY, message),
            Self::Codex(error) => (StatusCode::BAD_GATEWAY, error.to_string()),
            Self::Io(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
            Self::Cancelled => (StatusCode::CONFLICT, "task cancelled".to_owned()),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn recognizes_natural_language_draft_intent() {
        assert!(wants_script_draft("好的，开始制作吧"));
        assert!(wants_script_draft("方向确认，可以继续创作"));
        assert!(!wants_script_draft("我想再讨论一下受众"));
    }

    #[test]
    fn keeps_questions_as_chat_outside_discovery() {
        assert_eq!(message_action("discovery", "继续聊聊受众"), "discovery");
        assert_eq!(message_action("discovery", "开始创作"), "drafting");
        assert_eq!(
            message_action("script_review", "这一段是什么意思？"),
            "chatting"
        );
        assert_eq!(
            message_action("asset_review", "参考图会怎么使用？"),
            "chatting"
        );
        assert_eq!(
            message_action("completed", "字幕能否再大一点？"),
            "chatting"
        );
    }

    #[test]
    fn enforces_serial_project_transitions() {
        assert!(validate_project_action("discovery", "draft-script").is_ok());
        assert!(validate_project_action("script_review", "approve-script").is_ok());
        assert!(validate_project_action("asset_review", "approve-assets").is_ok());
        assert!(validate_project_action("review_ready", "render-final").is_ok());
        assert!(validate_project_action("discovery", "approve-assets").is_err());
        assert!(validate_project_action("asset_review", "render-final").is_err());
        assert!(validate_project_action("completed", "approve-script").is_err());
    }

    #[test]
    fn parses_fenced_draft_json() {
        let draft = match parse_draft_script(
            "```json\n{\"summary\":\"完成\",\"scenes\":[{\"narrativeRole\":\"开场\",\"narration\":\"旁白\",\"visualDirection\":\"画面\",\"assetStrategy\":\"程序化图解\",\"motionBlueprint\":\"展开\",\"transition\":\"切换\",\"durationSeconds\":8}]}\n```",
        ) {
            Ok(draft) => draft,
            Err(_) => panic!("draft should parse"),
        };
        assert_eq!(draft.summary, "完成");
        assert_eq!(draft.scenes.len(), 1);
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
