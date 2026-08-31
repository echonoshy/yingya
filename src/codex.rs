use std::{
    collections::HashMap,
    path::PathBuf,
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::Serialize;
use serde_json::{Value, json};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, broadcast, oneshot},
    time::timeout,
};
use tracing::{debug, error, warn};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

type PendingRequests = Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>;

#[derive(Debug, Error)]
pub enum CodexError {
    #[error("Codex executable does not exist: {0}")]
    MissingExecutable(PathBuf),
    #[error("Codex credential does not exist: {0}")]
    MissingCredential(PathBuf),
    #[error("failed to start Codex app-server: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("Codex app-server stdin is unavailable")]
    MissingStdin,
    #[error("Codex app-server stdout is unavailable")]
    MissingStdout,
    #[error("failed to communicate with Codex app-server: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid Codex app-server message: {0}")]
    InvalidMessage(#[from] serde_json::Error),
    #[error("Codex request {0} timed out")]
    RequestTimeout(u64),
    #[error("Codex request {0} was cancelled")]
    RequestCancelled(u64),
    #[error("Codex app-server rejected the request: {0}")]
    Rpc(String),
    #[error("Codex response did not contain {0}")]
    MissingField(&'static str),
    #[error("Codex turn {0} timed out")]
    TurnTimeout(String),
    #[error("Codex event stream closed")]
    EventStreamClosed,
    #[error("Codex turn failed: {0}")]
    TurnFailed(String),
    #[error("Codex image generation completed without a saved image: {0}")]
    MissingGeneratedImage(String),
}

#[derive(Clone, Debug)]
pub struct CodexConfig {
    pub binary: PathBuf,
    pub home: PathBuf,
    pub workspace: PathBuf,
    pub model: String,
    pub network_access: bool,
    pub hyperframes_browser: Option<PathBuf>,
    pub turn_timeout: Duration,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadStarted {
    pub thread_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCompleted {
    pub thread_id: String,
    pub turn_id: String,
    pub status: String,
    pub text: String,
    #[serde(skip_serializing)]
    pub generated_images: Vec<GeneratedImageEvent>,
}

#[derive(Debug)]
pub struct GeneratedImageEvent {
    pub id: String,
    pub status: String,
    pub saved_path: Option<PathBuf>,
    pub revised_prompt: Option<String>,
    pub failure: Option<String>,
}

pub struct CodexClient {
    config: CodexConfig,
    stdin: Mutex<ChildStdin>,
    pending: PendingRequests,
    events: broadcast::Sender<Value>,
    next_id: AtomicU64,
    _child: Mutex<Child>,
}

impl CodexClient {
    pub async fn spawn(config: CodexConfig) -> Result<Arc<Self>, CodexError> {
        ensure_runtime_files(&config)?;

        let mut command = Command::new(&config.binary);
        command
            .arg("app-server")
            .arg("-c")
            .arg(format!(
                "sandbox_workspace_write.network_access={}",
                config.network_access
            ))
            .current_dir(&config.workspace)
            .env("CODEX_HOME", &config.home)
            .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
            .env("HYPERFRAMES_SKIP_SKILLS", "1");
        if let Some(browser) = &config.hyperframes_browser {
            command.env("HYPERFRAMES_BROWSER_PATH", browser);
        }

        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(CodexError::Spawn)?;

        let stdin = child.stdin.take().ok_or(CodexError::MissingStdin)?;
        let stdout = child.stdout.take().ok_or(CodexError::MissingStdout)?;
        let stderr = child.stderr.take();
        let pending = PendingRequests::default();
        let (events, _) = broadcast::channel(2_048);

        spawn_stdout_reader(stdout, Arc::clone(&pending), events.clone());
        if let Some(stderr) = stderr {
            spawn_stderr_reader(stderr);
        }

        let client = Arc::new(Self {
            config,
            stdin: Mutex::new(stdin),
            pending,
            events,
            next_id: AtomicU64::new(1),
            _child: Mutex::new(child),
        });

        client
            .request(
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "yingya",
                        "title": "Yingya",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            )
            .await?;
        client.notify("initialized", json!({})).await?;

        Ok(client)
    }

    pub fn model(&self) -> &str {
        &self.config.model
    }

    pub async fn list_skills(&self) -> Result<Value, CodexError> {
        self.request(
            "skills/list",
            json!({
                "cwds": [self.config.workspace],
                "forceReload": true
            }),
        )
        .await
    }

    pub async fn start_thread(&self) -> Result<ThreadStarted, CodexError> {
        let result = self
            .request(
                "thread/start",
                json!({
                    "model": self.config.model,
                    "cwd": self.config.workspace,
                    "approvalPolicy": "never",
                    "sandbox": "workspace-write",
                    "ephemeral": false,
                    "serviceName": "yingya"
                }),
            )
            .await?;

        let thread_id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .ok_or(CodexError::MissingField("thread.id"))?
            .to_owned();

        Ok(ThreadStarted { thread_id })
    }

    pub async fn run_turn(
        &self,
        thread_id: &str,
        prompt: &str,
        reference_images: &[PathBuf],
        use_imagegen: bool,
    ) -> Result<TurnCompleted, CodexError> {
        let mut events = self.events.subscribe();
        let mut input = Vec::with_capacity(reference_images.len() + 2);
        if use_imagegen {
            input.push(json!({
                "type": "skill",
                "name": "imagegen",
                "path": self.config.home.join("skills/.system/imagegen/SKILL.md")
            }));
        }
        input.push(json!({ "type": "text", "text": prompt }));
        input.extend(
            reference_images
                .iter()
                .map(|path| json!({ "type": "localImage", "path": path, "detail": "original" })),
        );

        let result = self
            .request(
                "turn/start",
                json!({
                    "threadId": thread_id,
                    "input": input
                }),
            )
            .await?;
        let turn_id = result
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .ok_or(CodexError::MissingField("turn.id"))?
            .to_owned();

        let wait_for_turn = async {
            let mut final_text = String::new();
            let mut generated_images = Vec::new();

            loop {
                let event = match events.recv().await {
                    Ok(event) => event,
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!(skipped, "Codex event consumer lagged");
                        continue;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        return Err(CodexError::EventStreamClosed);
                    }
                };

                let method = event.get("method").and_then(Value::as_str);
                let event_turn_id = event
                    .pointer("/params/turnId")
                    .or_else(|| event.pointer("/params/turn/id"))
                    .and_then(Value::as_str);

                if event_turn_id.is_some_and(|id| id != turn_id) {
                    continue;
                }

                if method == Some("item/completed") {
                    let item = event.pointer("/params/item");
                    match item
                        .and_then(|value| value.get("type"))
                        .and_then(Value::as_str)
                    {
                        Some("agentMessage") => {
                            if let Some(text) = item
                                .and_then(|value| value.get("text"))
                                .and_then(Value::as_str)
                            {
                                final_text = text.to_owned();
                            }
                        }
                        Some("imageGeneration") => {
                            let item = item.expect("image generation item exists");
                            generated_images.push(GeneratedImageEvent {
                                id: item
                                    .get("id")
                                    .and_then(Value::as_str)
                                    .unwrap_or("image")
                                    .to_owned(),
                                status: item
                                    .get("status")
                                    .and_then(Value::as_str)
                                    .unwrap_or("unknown")
                                    .to_owned(),
                                saved_path: item
                                    .get("savedPath")
                                    .and_then(Value::as_str)
                                    .map(PathBuf::from),
                                revised_prompt: item
                                    .get("revisedPrompt")
                                    .and_then(Value::as_str)
                                    .map(str::to_owned),
                                failure: item.get("failure").and_then(|failure| {
                                    failure
                                        .get("message")
                                        .and_then(Value::as_str)
                                        .map(str::to_owned)
                                        .or_else(|| {
                                            (!failure.is_null()).then(|| failure.to_string())
                                        })
                                }),
                            });
                        }
                        _ => {}
                    }
                }

                if method == Some("turn/completed") {
                    let status = event
                        .pointer("/params/turn/status")
                        .and_then(Value::as_str)
                        .unwrap_or("completed")
                        .to_owned();

                    if status == "failed" {
                        let message = event
                            .pointer("/params/turn/error/message")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown Codex error")
                            .to_owned();
                        return Err(CodexError::TurnFailed(message));
                    }

                    return Ok(TurnCompleted {
                        thread_id: thread_id.to_owned(),
                        turn_id: turn_id.clone(),
                        status,
                        text: final_text,
                        generated_images,
                    });
                }
            }
        };

        timeout(self.config.turn_timeout, wait_for_turn)
            .await
            .map_err(|_| CodexError::TurnTimeout(turn_id.clone()))?
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, CodexError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().await.insert(id, sender);

        if let Err(error) = self
            .write_message(json!({
                "method": method,
                "id": id,
                "params": params
            }))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }

        let response = timeout(REQUEST_TIMEOUT, receiver)
            .await
            .map_err(|_| CodexError::RequestTimeout(id))?
            .map_err(|_| CodexError::RequestCancelled(id))?;

        if let Some(error) = response.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| error.to_string());
            return Err(CodexError::Rpc(message));
        }

        response
            .get("result")
            .cloned()
            .ok_or(CodexError::MissingField("result"))
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), CodexError> {
        self.write_message(json!({ "method": method, "params": params }))
            .await
    }

    async fn write_message(&self, message: Value) -> Result<(), CodexError> {
        let mut stdin = self.stdin.lock().await;
        let mut bytes = serde_json::to_vec(&message)?;
        bytes.push(b'\n');
        stdin.write_all(&bytes).await?;
        stdin.flush().await?;
        debug!(method = ?message.get("method"), "sent Codex app-server message");
        Ok(())
    }
}

fn ensure_runtime_files(config: &CodexConfig) -> Result<(), CodexError> {
    if !config.binary.is_file() {
        return Err(CodexError::MissingExecutable(config.binary.clone()));
    }
    let credential = config.home.join("auth.json");
    if !credential.is_file() {
        return Err(CodexError::MissingCredential(credential));
    }
    Ok(())
}

fn spawn_stdout_reader(
    stdout: tokio::process::ChildStdout,
    pending: PendingRequests,
    events: broadcast::Sender<Value>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                    Ok(message) => {
                        if let Some(id) = message.get("id").and_then(Value::as_u64) {
                            if let Some(sender) = pending.lock().await.remove(&id) {
                                let _ = sender.send(message);
                            }
                        } else {
                            let _ = events.send(message);
                        }
                    }
                    Err(error) => warn!(%error, "ignored invalid Codex app-server JSON"),
                },
                Ok(None) => break,
                Err(error) => {
                    error!(%error, "failed reading Codex app-server stdout");
                    break;
                }
            }
        }
    });
}

fn spawn_stderr_reader(stderr: tokio::process::ChildStderr) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            debug!(target: "codex_app_server", "{line}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn runtime_validation_rejects_missing_binary() {
        let config = CodexConfig {
            binary: Path::new("/definitely/missing/codex").to_path_buf(),
            home: Path::new("/tmp").to_path_buf(),
            workspace: Path::new("/tmp").to_path_buf(),
            model: "test".to_owned(),
            network_access: false,
            hyperframes_browser: None,
            turn_timeout: Duration::from_secs(300),
        };

        assert!(matches!(
            ensure_runtime_files(&config),
            Err(CodexError::MissingExecutable(_))
        ));
    }
}
