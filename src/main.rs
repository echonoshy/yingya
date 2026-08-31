mod codex;

use std::{
    env,
    net::SocketAddr,
    path::{Path as FilePath, PathBuf},
    sync::Arc,
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use codex::{CodexClient, CodexConfig, CodexError, GeneratedImageEvent, ThreadStarted};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{fs, net::TcpListener};
use tower_http::services::{ServeDir, ServeFile};
use tracing::info;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    codex: Arc<CodexClient>,
    assets: AssetStore,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TurnRequest {
    prompt: String,
    #[serde(default)]
    reference_images: Vec<String>,
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
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
        turn_timeout: Duration::from_secs(env_u64("YINGYA_CODEX_TURN_TIMEOUT_SECS", 900)),
    };

    let codex = CodexClient::spawn(config).await?;
    let assets = AssetStore::new(env_path("YINGYA_ASSETS_DIR", root.join("data/assets"))).await?;
    let static_assets = assets.root.as_ref().clone();
    let state = AppState { codex, assets };
    let app = Router::new()
        .route_service("/", ServeFile::new(root.join("web/index.html")))
        .route("/health", get(health))
        .route("/api/codex/skills", get(list_skills))
        .route("/api/codex/threads", post(start_thread))
        .route("/api/codex/threads/{thread_id}/turns", post(run_turn))
        .route(
            "/api/codex/threads/{thread_id}/images",
            post(generate_image),
        )
        .route("/api/assets/images", post(upload_image))
        .nest_service("/assets", ServeDir::new(static_assets))
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
            use_imagegen,
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
    Codex(CodexError),
    Io(std::io::Error),
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
            Self::Codex(error) => (StatusCode::BAD_GATEWAY, error.to_string()),
            Self::Io(error) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()),
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_supported_image_signatures() {
        assert!(has_image_signature("png", b"\x89PNG\r\n\x1a\nrest"));
        assert!(has_image_signature("jpg", b"\xff\xd8\xffrest"));
        assert!(has_image_signature("webp", b"RIFF0000WEBPrest"));
        assert!(!has_image_signature("png", b"not an image"));
    }
}
