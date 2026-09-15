use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

use serde::Serialize;
use serde_json::{Value, json};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{Mutex, Notify, broadcast, mpsc, oneshot},
    time::{Instant, timeout, timeout_at},
};
use tracing::{debug, error, warn};

#[cfg(not(test))]
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(test)]
const REQUEST_TIMEOUT: Duration = Duration::from_secs(1);
const STATUS_PROBE_INTERVAL: Duration = REQUEST_TIMEOUT;
const MODEL_OVERLOAD_RETRIES: usize = 5;
const MODEL_RETRY_PROMPT: &str = "上一次执行因模型服务暂时繁忙而结束。继续本会话中尚未完成的用户请求，先核对已有对话、项目文件、manifest、检查点和外部任务记录，只完成剩余步骤。不要重复已完成的生成、付费调用或导出；外部请求结果不明确且无法查询时停止并说明需要核对的信息。";

fn model_retry_delay(attempt: usize) -> Duration {
    // Like Codex's backoff: exponential delay with jitter to spread retries.
    let base = [5_000, 10_000, 20_000, 40_000, 60_000][attempt - 1];
    let jitter = 90 + (uuid::Uuid::new_v4().as_u128() % 21) as u64;
    Duration::from_millis((base * jitter / 100).min(60_000))
}

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
    #[error("Codex transport is unavailable or its write timed out; restart required")]
    TransportUnavailable,
    #[error("Codex request {0} was cancelled")]
    RequestCancelled(u64),
    #[error("Codex app-server rejected the request: {0}")]
    Rpc(String),
    #[error("Codex response did not contain {0}")]
    MissingField(&'static str),
    #[error("Codex turn {0} timed out")]
    TurnTimeout(String),
    #[error("Codex turn {0} was interrupted")]
    TurnInterrupted(String),
    #[error("Codex turn {0} did not stop within the interrupt grace period")]
    InterruptTimeout(String),
    #[error("Codex event stream closed")]
    EventStreamClosed,
    #[error("Codex turn failed: {0}")]
    TurnFailed(String),
    #[error("当前模型繁忙，请稍后再试或切换模型：{message}")]
    TurnOverloaded { turn_id: String, message: String },
    #[error("Codex image generation completed without a saved image: {0}")]
    MissingGeneratedImage(String),
}

#[derive(Clone)]
pub struct CodexConfig {
    pub sandbox: Option<crate::sandbox::Sandbox>,
    pub accounting: Option<(crate::accounts::Accounts, String)>,
    pub binary: PathBuf,
    pub home: PathBuf,
    pub workspace: PathBuf,
    pub model: String,
    pub network_access: bool,
    pub hyperframes_browser: Option<PathBuf>,
    pub video_agent_skill: Option<PathBuf>,
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

#[derive(Clone, Default)]
pub struct TurnOptions<'a> {
    pub use_imagegen: bool,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
    pub cancellation: Option<&'a TurnCancellation>,
    pub use_video_agent: bool,
    pub event_tx: Option<mpsc::UnboundedSender<Value>>,
}

#[derive(Clone, Default)]
pub struct TurnCancellation {
    cancelled: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl TurnCancellation {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub async fn cancelled(&self) {
        let notified = self.notify.notified();
        if self.is_cancelled() {
            return;
        }
        notified.await;
    }
}

pub struct CodexClient {
    config: CodexConfig,
    stdin: Mutex<ChildStdin>,
    write_incomplete: AtomicBool,
    pending: PendingRequests,
    events: broadcast::Sender<Value>,
    next_id: AtomicU64,
    generation: AtomicU64,
    _child: Mutex<Child>,
    loaded_threads: Mutex<std::collections::HashSet<String>>,
}

impl CodexClient {
    pub async fn spawn(config: CodexConfig) -> Result<Arc<Self>, CodexError> {
        ensure_runtime_files(&config)?;
        let pending = PendingRequests::default();
        let (events, _) = broadcast::channel(2_048);
        let (child, stdin) = spawn_app_server(&config, Arc::clone(&pending), events.clone())?;

        let client = Arc::new(Self {
            config,
            stdin: Mutex::new(stdin),
            write_incomplete: AtomicBool::new(false),
            pending,
            events,
            next_id: AtomicU64::new(1),
            generation: AtomicU64::new(0),
            _child: Mutex::new(child),
            loaded_threads: Mutex::new(Default::default()),
        });

        client.initialize().await?;

        Ok(client)
    }

    pub fn model(&self) -> &str {
        &self.config.model
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub async fn restart(&self) -> Result<(), CodexError> {
        self.generation.fetch_add(1, Ordering::AcqRel);
        self.pending.lock().await.clear();
        self.loaded_threads.lock().await.clear();
        {
            let mut current = self._child.lock().await;
            current.kill().await?;
        }
        let (child, stdin) =
            spawn_app_server(&self.config, Arc::clone(&self.pending), self.events.clone())?;
        *self._child.lock().await = child;
        {
            let mut current = self.stdin.lock().await;
            *current = stdin;
            self.write_incomplete.store(false, Ordering::Release);
        }
        self.initialize().await
    }

    async fn initialize(&self) -> Result<(), CodexError> {
        self.request(
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
        self.notify("initialized", json!({})).await
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

    pub async fn list_models(&self) -> Result<Value, CodexError> {
        self.request(
            "model/list",
            json!({
                "limit": 100,
                "includeHidden": false
            }),
        )
        .await
    }

    pub async fn respond_to_server_request(
        &self,
        id: Value,
        result: Value,
    ) -> Result<(), CodexError> {
        self.write_message(json!({ "id": id, "result": result }))
            .await
    }

    pub async fn start_thread(&self) -> Result<ThreadStarted, CodexError> {
        self.start_thread_at(&self.config.workspace, None).await
    }

    pub async fn start_thread_at(
        &self,
        cwd: &Path,
        model: Option<&str>,
    ) -> Result<ThreadStarted, CodexError> {
        self.start_thread_at_with_persistence(cwd, model, true)
            .await
    }

    pub async fn start_ephemeral_thread_at(
        &self,
        cwd: &Path,
        model: Option<&str>,
    ) -> Result<ThreadStarted, CodexError> {
        self.start_thread_at_with_persistence(cwd, model, false)
            .await
    }

    async fn start_thread_at_with_persistence(
        &self,
        cwd: &Path,
        model: Option<&str>,
        persist: bool,
    ) -> Result<ThreadStarted, CodexError> {
        let model = model.unwrap_or(&self.config.model);
        let result = self
            .request(
                "thread/start",
                json!({
                    "model": model,
                    "cwd": cwd,
                    "approvalPolicy": "never",
                    "sandbox": "danger-full-access",
                    "ephemeral": !persist,
                    "serviceName": "yingya"
                }),
            )
            .await?;

        let thread_id = result
            .pointer("/thread/id")
            .and_then(Value::as_str)
            .ok_or(CodexError::MissingField("thread.id"))?
            .to_owned();

        if let Some((accounts, user)) = &self.config.accounting {
            let project = cwd
                .file_name()
                .and_then(|v| v.to_str())
                .filter(|v| uuid::Uuid::parse_str(v).is_ok());
            accounts
                .thread(
                    &thread_id,
                    user,
                    model,
                    project,
                    if !persist {
                        "title"
                    } else if project.is_some() {
                        "agent"
                    } else {
                        "image"
                    },
                )
                .map_err(CodexError::Rpc)?;
        }
        self.loaded_threads.lock().await.insert(thread_id.clone());
        Ok(ThreadStarted { thread_id })
    }

    pub async fn run_turn(
        &self,
        thread_id: &str,
        prompt: &str,
        reference_images: &[PathBuf],
        options: TurnOptions<'_>,
    ) -> Result<TurnCompleted, CodexError> {
        self.run_turn_with_retry_delays(
            thread_id,
            prompt,
            reference_images,
            options,
            model_retry_delay,
            Duration::from_secs(300),
        )
        .await
    }

    async fn run_turn_with_retry_delays(
        &self,
        thread_id: &str,
        prompt: &str,
        reference_images: &[PathBuf],
        options: TurnOptions<'_>,
        delay_for: fn(usize) -> Duration,
        recovery_budget: Duration,
    ) -> Result<TurnCompleted, CodexError> {
        let mut result = self
            .run_turn_once(thread_id, prompt, reference_images, options.clone())
            .await;
        // Only project creation runs opt in. Image generation and other callers
        // keep their existing behavior; Codex owns HTTP/stream-level retries.
        if !options.use_video_agent {
            return result;
        }
        let retry_id = uuid::Uuid::new_v4().to_string();
        // Bound starting additional recovery turns, including native retries
        // spent in previous continuations. Never kill a productive turn on a timer.
        let recovery_started = tokio::time::Instant::now();
        let mut attempt = 0;
        loop {
            let cancelled = options
                .cancellation
                .is_some_and(TurnCancellation::is_cancelled);
            let overloaded_turn = match &result {
                Err(CodexError::TurnOverloaded { turn_id, .. }) => Some(turn_id.clone()),
                _ => None,
            };
            let next_delay = if attempt < MODEL_OVERLOAD_RETRIES {
                delay_for(attempt + 1)
            } else {
                Duration::ZERO
            };
            let retry = overloaded_turn.is_some()
                && !cancelled
                && attempt < MODEL_OVERLOAD_RETRIES
                && recovery_started.elapsed().saturating_add(next_delay) < recovery_budget;
            let status = if retry {
                "waiting"
            } else if cancelled {
                "interrupted"
            } else if result.is_ok() {
                "completed"
            } else {
                "failed"
            };
            if retry {
                attempt += 1;
            }
            let delay = if retry { next_delay } else { Duration::ZERO };
            let emit = |status: &str| {
                if let Some(sender) = &options.event_tx {
                    let _ = sender.send(json!({"method":"project/modelRetry","params":{
                        "threadId":thread_id,"retryId":retry_id,"failedTurnId":overloaded_turn,
                        "status":status,"attempt":attempt,"maxAttempts":MODEL_OVERLOAD_RETRIES,
                        "delaySeconds":delay.as_secs_f64().ceil() as u64
                    }}));
                }
            };
            if attempt > 0 {
                emit(status);
            }
            if !retry {
                return if cancelled {
                    Err(CodexError::TurnInterrupted(thread_id.to_owned()))
                } else {
                    result
                };
            }
            // A stop during backoff must not start another turn or interrupt an
            // already completed turn. Keep the project's active job registered.
            if let Some(cancellation) = options.cancellation {
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => {
                        emit("interrupted");
                        return Err(CodexError::TurnInterrupted(thread_id.to_owned()));
                    }
                    _ = tokio::time::sleep(delay) => {}
                }
            } else {
                tokio::time::sleep(delay).await;
            }
            emit("running");
            // The failed turn is persisted in the same thread. Continue it;
            // never replay the original prompt/attachments or an uncertain RPC.
            result = self
                .run_turn_once(thread_id, MODEL_RETRY_PROMPT, &[], options.clone())
                .await;
        }
    }

    async fn run_turn_once(
        &self,
        thread_id: &str,
        prompt: &str,
        reference_images: &[PathBuf],
        options: TurnOptions<'_>,
    ) -> Result<TurnCompleted, CodexError> {
        if options
            .cancellation
            .is_some_and(TurnCancellation::is_cancelled)
        {
            return Err(CodexError::TurnInterrupted(thread_id.to_owned()));
        }
        let mut events = self.events.subscribe();
        let mut input = Vec::with_capacity(reference_images.len() + 2);
        if options.use_imagegen {
            input.push(json!({
                "type": "skill",
                "name": "imagegen",
                "path": self.config.home.join("skills/.system/imagegen/SKILL.md")
            }));
        }
        if options.use_video_agent
            && let Some(path) = &self.config.video_agent_skill
        {
            input.push(json!({
                "type": "skill",
                "name": "yingya-video-agent",
                "path": path
            }));
        }
        let prompt = if let Some(sandbox) = &self.config.sandbox {
            format!("{prompt}{}", sandbox.tool_instructions())
        } else {
            prompt.to_owned()
        };
        input.extend(turn_user_input(&prompt, reference_images));

        let mut params = json!({
            "threadId": thread_id,
            "input": input,
            // Override persisted permissions too: existing projects must receive
            // the same full access as newly created conversations.
            "approvalPolicy": "never",
            "sandboxPolicy": { "type": "dangerFullAccess" }
        });
        if let Some(model) = options.model {
            params["model"] = json!(model);
        }
        if let Some(effort) = options.effort.filter(|value| *value != "auto") {
            params["effort"] = json!(effort);
        }
        if let Some((accounts, user)) = &self.config.accounting {
            if !accounts.owns_thread(thread_id, user) {
                return Err(CodexError::Rpc("会话不存在".into()));
            }
            accounts.check_quota(user).map_err(CodexError::Rpc)?;
            accounts
                .set_model(thread_id, options.model.unwrap_or(&self.config.model))
                .map_err(CodexError::Rpc)?;
        }
        // A restarted app-server must load the persisted conversation before
        // turn/start. Keep the existing thread instead of silently losing history.
        {
            let mut loaded = self.loaded_threads.lock().await;
            if !loaded.contains(thread_id) {
                self.request("thread/resume", json!({
                    "threadId": thread_id, "approvalPolicy": "never", "sandbox": "danger-full-access"
                })).await?;
                loaded.insert(thread_id.to_owned());
            }
        }
        let submitted_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut recovered = VecDeque::new();
        let result = match self.request("turn/start", params).await {
            Ok(result) => result,
            Err(error @ CodexError::RequestTimeout(_)) => {
                // A missing acknowledgement does not mean the request was rejected.
                // Read back this submission; never retry turn/start blindly.
                let snapshot = self.read_thread(thread_id).await?;
                let Some(turn) = submitted_turn(&snapshot, submitted_at, &prompt) else {
                    return Err(error);
                };
                recovered = snapshot_events(thread_id, turn);
                json!({"turn": turn})
            }
            Err(error) => return Err(error),
        };
        let turn_id = result
            .pointer("/turn/id")
            .and_then(Value::as_str)
            .ok_or(CodexError::MissingField("turn.id"))?
            .to_owned();

        let wait_for_turn = async {
            let mut final_text = String::new();
            let mut generated_images = Vec::new();
            let mut interrupt_sent = false;
            let mut inactivity_deadline = Instant::now() + self.config.turn_timeout;
            let mut interrupt_deadline = None;
            let mut probe_deadline = Instant::now() + STATUS_PROBE_INTERVAL;

            loop {
                let receive_event = async {
                    if let Some(event) = recovered.pop_front() {
                        return Some(Ok(event));
                    }
                    if !interrupt_sent {
                        if let Some(cancellation) = options.cancellation {
                            tokio::select! {
                                result = events.recv() => Some(result),
                                _ = cancellation.cancelled() => None,
                            }
                        } else {
                            Some(events.recv().await)
                        }
                    } else {
                        Some(events.recv().await)
                    }
                };

                let deadline = interrupt_deadline
                    .map_or(inactivity_deadline, |deadline: Instant| {
                        deadline.min(inactivity_deadline)
                    });
                let remaining = deadline
                    .min(probe_deadline)
                    .saturating_duration_since(Instant::now());
                let event_result = match timeout(remaining, receive_event).await {
                    Ok(result) => result,
                    Err(_) => {
                        if probe_deadline < deadline {
                            let snapshot = self.read_thread(thread_id).await?;
                            if let Some(turn) = snapshot
                                .pointer("/thread/turns")
                                .and_then(Value::as_array)
                                .and_then(|turns| turns.iter().find(|turn| turn["id"] == turn_id))
                                && matches!(
                                    turn["status"].as_str(),
                                    Some("completed" | "failed" | "interrupted")
                                )
                            {
                                recovered = snapshot_events(thread_id, turn);
                            }
                            probe_deadline = Instant::now() + STATUS_PROBE_INTERVAL;
                            continue;
                        }
                        if interrupt_deadline.is_some_and(|deadline| deadline <= Instant::now()) {
                            return Err(CodexError::InterruptTimeout(turn_id.clone()));
                        }
                        let _ = self
                            .request(
                                "turn/interrupt",
                                json!({ "threadId": thread_id, "turnId": turn_id }),
                            )
                            .await;
                        return Err(CodexError::TurnTimeout(turn_id.clone()));
                    }
                };

                let Some(event_result) = event_result else {
                    self.request(
                        "turn/interrupt",
                        json!({ "threadId": thread_id, "turnId": turn_id }),
                    )
                    .await?;
                    interrupt_sent = true;
                    interrupt_deadline = Some(Instant::now() + Duration::from_secs(10));
                    continue;
                };

                let event = match event_result {
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
                let event_thread_id = event
                    .pointer("/params/threadId")
                    .or_else(|| event.pointer("/params/thread/id"))
                    .and_then(Value::as_str);

                if event_turn_id.is_some_and(|id| id != turn_id) {
                    continue;
                }
                if event_thread_id.is_some_and(|id| id != thread_id) {
                    continue;
                }
                if event_turn_id.is_none() && event_thread_id.is_none() {
                    continue;
                }

                // Only activity from this turn renews the deadline. Events from
                // concurrent turns must not keep an otherwise stalled turn alive.
                inactivity_deadline = Instant::now() + self.config.turn_timeout;
                probe_deadline = Instant::now() + STATUS_PROBE_INTERVAL;

                if let Some(sender) = &options.event_tx {
                    let _ = sender.send(event.clone());
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

                    if status == "interrupted" {
                        return Err(CodexError::TurnInterrupted(turn_id.clone()));
                    }

                    if status == "failed" {
                        let message = event
                            .pointer("/params/turn/error/message")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown Codex error")
                            .to_owned();
                        if event
                            .pointer("/params/turn/error/codexErrorInfo")
                            .and_then(Value::as_str)
                            == Some("serverOverloaded")
                        {
                            return Err(CodexError::TurnOverloaded {
                                turn_id: turn_id.clone(),
                                message,
                            });
                        }
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

        wait_for_turn.await
    }

    async fn read_thread(&self, thread_id: &str) -> Result<Value, CodexError> {
        self.request(
            "thread/read",
            json!({"threadId": thread_id, "includeTurns": true}),
        )
        .await
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, CodexError> {
        let deadline = Instant::now() + REQUEST_TIMEOUT;
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

        let response = match timeout_at(deadline, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&id);
                return Err(CodexError::RequestCancelled(id));
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                return Err(CodexError::RequestTimeout(id));
            }
        };

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
        let mut bytes = serde_json::to_vec(&message)?;
        bytes.push(b'\n');
        timeout(REQUEST_TIMEOUT, async {
            let mut stdin = self.stdin.lock().await;
            if self.write_incomplete.load(Ordering::Acquire) {
                return Err(CodexError::TransportUnavailable);
            }
            // Cancellation or a partial write leaves the transport poisoned. Never
            // append a new JSON frame to an incomplete one, or resend a turn blindly.
            self.write_incomplete.store(true, Ordering::Release);
            stdin.write_all(&bytes).await?;
            stdin.flush().await?;
            self.write_incomplete.store(false, Ordering::Release);
            debug!(method = ?message.get("method"), "sent Codex app-server message");
            Ok(())
        })
        .await
        .map_err(|_| CodexError::TransportUnavailable)?
    }
}

// Match both the submission time and text so an older successful turn cannot
// accidentally be used as the acknowledgement of a different request.
fn submitted_turn<'a>(snapshot: &'a Value, submitted_at: u64, prompt: &str) -> Option<&'a Value> {
    snapshot
        .pointer("/thread/turns")?
        .as_array()?
        .iter()
        .rev()
        .find(|turn| {
            turn["startedAt"]
                .as_u64()
                .is_some_and(|time| time >= submitted_at)
                && turn["items"].as_array().is_some_and(|items| {
                    items.iter().any(|item| {
                        item["type"] == "userMessage"
                            && item["content"].as_array().is_some_and(|content| {
                                content
                                    .iter()
                                    .any(|part| part["type"] == "text" && part["text"] == prompt)
                            })
                    })
                })
        })
}

fn snapshot_events(thread_id: &str, turn: &Value) -> VecDeque<Value> {
    let mut events = VecDeque::new();
    events.push_back(json!({"method":"turn/started", "params":{"threadId":thread_id,"turn":turn}}));
    if let Some(items) = turn["items"].as_array() {
        for item in items {
            let method = if item["status"] == "inProgress" {
                "item/started"
            } else {
                "item/completed"
            };
            events.push_back(json!({"method":method,"params":{"threadId":thread_id,"turnId":turn["id"],"item":item}}));
        }
    }
    if matches!(
        turn["status"].as_str(),
        Some("completed" | "failed" | "interrupted")
    ) {
        events.push_back(
            json!({"method":"turn/completed","params":{"threadId":thread_id,"turn":turn}}),
        );
    }
    events
}

impl CodexError {
    pub fn execution_uncertain(&self) -> bool {
        matches!(
            self,
            Self::RequestTimeout(_)
                | Self::TransportUnavailable
                | Self::RequestCancelled(_)
                | Self::Io(_)
                | Self::EventStreamClosed
                | Self::InterruptTimeout(_)
                | Self::TurnTimeout(_)
        )
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

fn spawn_app_server(
    config: &CodexConfig,
    pending: PendingRequests,
    events: broadcast::Sender<Value>,
) -> Result<(Child, ChildStdin), CodexError> {
    let mut command = config.sandbox.as_ref().map_or_else(
        || Command::new(&config.binary),
        |sandbox| sandbox.command(&config.binary),
    );
    command
        .arg("app-server")
        // Codex runs with full access inside Yingya's per-user OS sandbox.
        // Keep Sandbox::command above as the filesystem/network boundary.
        .arg("-c")
        .arg("approval_policy=\"never\"")
        .arg("-c")
        .arg("sandbox_mode=\"danger-full-access\"")
        .arg("-c")
        .arg(format!(
            "sandbox_workspace_write.network_access={}",
            config.network_access
        ))
        .current_dir(&config.workspace)
        .env("CODEX_HOME", &config.home)
        .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
        .env("HYPERFRAMES_SKIP_SKILLS", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if config.sandbox.is_some() {
        // Keep the OpenAI capability name, but use HTTP/SSE through the host
        // relay so no provider bearer token enters the sandbox.
        for setting in [
            "model_provider=\"yingya\"",
            "model_providers.yingya.name=\"OpenAI\"",
            "model_providers.yingya.base_url=\"http://127.0.0.1:8797/api/internal/model/backend-api/codex\"",
            "model_providers.yingya.wire_api=\"responses\"",
            "model_providers.yingya.requires_openai_auth=true",
            "model_providers.yingya.supports_websockets=false",
            // The relay does not implement standalone search or Apps MCP.
            "model_providers.yingya.supports_standalone_web_search=false",
            "web_search=\"disabled\"",
            "features.apps=false",
            "chatgpt_base_url=\"http://127.0.0.1:8797/api/internal/model/backend-api\"",
        ] {
            command.arg("-c").arg(setting);
        }
    }
    if config.sandbox.is_none()
        && let Some(browser) = &config.hyperframes_browser
    {
        command.env("HYPERFRAMES_BROWSER_PATH", browser);
    }
    let mut child = command.spawn().map_err(CodexError::Spawn)?;
    let stdin = child.stdin.take().ok_or(CodexError::MissingStdin)?;
    let stdout = child.stdout.take().ok_or(CodexError::MissingStdout)?;
    let stderr = child.stderr.take();
    spawn_stdout_reader(stdout, pending, events, config.accounting.clone());
    if let Some(stderr) = stderr {
        spawn_stderr_reader(stderr);
    }
    Ok((child, stdin))
}

fn spawn_stdout_reader(
    stdout: tokio::process::ChildStdout,
    pending: PendingRequests,
    events: broadcast::Sender<Value>,
    accounting: Option<(crate::accounts::Accounts, String)>,
) {
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                    Ok(message) => {
                        if let Some((accounts, _)) = &accounting
                            && let Err(error) = accounts.event(&message)
                        {
                            tracing::error!(%error, "usage persistence failed");
                        }
                        if message.get("method").is_some() {
                            let _ = events.send(message);
                        } else if let Some(id) = message.get("id").and_then(Value::as_u64) {
                            if let Some(sender) = pending.lock().await.remove(&id) {
                                let _ = sender.send(message);
                            } else {
                                let _ = events.send(message);
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

fn turn_user_input(prompt: &str, images: &[PathBuf]) -> Vec<Value> {
    let mut input = vec![json!({ "type": "text", "text": prompt })];
    input.extend(
        images
            .iter()
            .map(|path| json!({ "type": "localImage", "path": path, "detail": "original" })),
    );
    input
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[tokio::test]
    async fn full_access_applies_to_new_ephemeral_loaded_and_resumed_threads() {
        use std::os::unix::fs::PermissionsExt;
        let root =
            std::env::temp_dir().join(format!("yingya-codex-permissions-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("auth.json"), "{}").unwrap();
        let script = root.join("mock.py");
        std::fs::write(&script, r#"#!/usr/bin/python3
import json,sys,pathlib
def send(x):print(json.dumps(x),flush=True)
for line in sys.stdin:
 r=json.loads(line); method=r.get('method'); p=r.get('params',{})
 if 'id' not in r:continue
 pathlib.Path('requests').open('a').write(json.dumps(r)+'\n')
 error=None
 if method=='initialize':
  if 'approval_policy="never"' not in sys.argv or 'sandbox_mode="danger-full-access"' not in sys.argv:error='process defaults missing'
 elif method in ('thread/start','thread/resume','turn/start'):
  if p.get('approvalPolicy')!='never':error='approval would block execution'
  if method=='turn/start':
   if p.get('sandboxPolicy')!={'type':'dangerFullAccess'}:error='turn retains old sandbox'
  elif p.get('sandbox')!='danger-full-access':error='thread retains old sandbox'
 if error:
  send({'id':r['id'],'error':{'code':-1,'message':error}});continue
 if method=='thread/start':send({'id':r['id'],'result':{'thread':{'id':'ephemeral' if p['ephemeral'] else 'persisted'}}})
 elif method=='turn/start':
  send({'id':r['id'],'result':{'turn':{'id':'turn'}}})
  send({'method':'turn/completed','params':{'threadId':p['threadId'],'turn':{'id':'turn','status':'completed'}}})
 else:send({'id':r['id'],'result':{}})
"#).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let client = CodexClient::spawn(CodexConfig {
            binary: script,
            home: root.clone(),
            workspace: root.clone(),
            model: "test".into(),
            network_access: false,
            sandbox: None,
            accounting: None,
            hyperframes_browser: None,
            video_agent_skill: None,
            turn_timeout: Duration::from_secs(10),
        })
        .await
        .unwrap();
        let thread = client.start_thread().await.unwrap();
        client.start_ephemeral_thread_at(&root, None).await.unwrap();
        // A loaded thread skips resume, so turn/start must still override policy.
        client
            .run_turn(&thread.thread_id, "continue", &[], TurnOptions::default())
            .await
            .unwrap();
        client.restart().await.unwrap();
        client
            .run_turn(
                &thread.thread_id,
                "continue after restart",
                &[],
                TurnOptions::default(),
            )
            .await
            .unwrap();
        let requests: Vec<Value> = std::fs::read_to_string(root.join("requests"))
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        let methods: Vec<_> = requests
            .iter()
            .map(|r| r["method"].as_str().unwrap())
            .collect();
        assert_eq!(
            methods,
            [
                "initialize",
                "thread/start",
                "thread/start",
                "turn/start",
                "initialize",
                "thread/resume",
                "turn/start"
            ]
        );
        client._child.lock().await.kill().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn overload_backoff_is_bounded_and_increases() {
        for (attempt, base) in [5_000, 10_000, 20_000, 40_000, 60_000]
            .into_iter()
            .enumerate()
        {
            let ms = model_retry_delay(attempt + 1).as_millis();
            assert!(ms >= base * 90 / 100 && ms <= (base * 110 / 100).min(60_000));
        }
    }

    #[tokio::test]
    async fn overload_retry_preserves_thread_and_respects_limits_and_stop() {
        use std::os::unix::fs::PermissionsExt;
        for (mode, expected_starts) in [
            ("success", 2),
            ("exhausted", 6),
            ("stop", 1),
            ("context", 1),
            ("native", 1),
            ("image", 1),
            ("other_error", 2),
            ("budget", 1),
        ] {
            let root =
                std::env::temp_dir().join(format!("yingya-overload-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(root.join("auth.json"), "{}").unwrap();
            std::fs::write(root.join("mode"), mode).unwrap();
            let script = root.join("mock.py");
            std::fs::write(&script, r#"#!/usr/bin/python3
import json,sys,pathlib
mode=pathlib.Path('mode').read_text()
count=0
def send(x):print(json.dumps(x),flush=True)
for line in sys.stdin:
 r=json.loads(line); method=r.get('method'); p=r.get('params',{})
 if 'id' not in r:continue
 if method!='turn/start':
  send({'id':r['id'],'result':{}});continue
 count+=1
 pathlib.Path('starts').open('a').write(json.dumps(p)+'\n')
 turn='turn-'+str(count)
 send({'id':r['id'],'result':{'turn':{'id':turn}}})
 def emit(m,p):send({'method':m,'params':dict(threadId='thread',**p)})
 emit('turn/started',{'turn':{'id':turn,'status':'inProgress'}})
 error={'message':'Selected model is at capacity. Please try a different model.','codexErrorInfo':'serverOverloaded'}
 if mode=='context' or (mode=='other_error' and count>1):error={'message':'context too long','codexErrorInfo':'contextWindowExceeded'}
 if mode=='native':emit('error',{'turnId':turn,'error':error,'willRetry':True})
 if (mode=='success' and count>1) or mode=='native':
  emit('item/completed',{'turnId':turn,'item':{'id':'reply','type':'agentMessage','text':'draft ready'}})
  emit('turn/completed',{'turn':{'id':turn,'status':'completed'}})
 else:
  emit('error',{'turnId':turn,'error':error,'willRetry':False})
  emit('turn/completed',{'turn':{'id':turn,'status':'failed','error':error}})
"#).unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            let client = CodexClient::spawn(CodexConfig {
                sandbox: None,
                accounting: None,
                binary: script,
                home: root.clone(),
                workspace: root.clone(),
                model: "test".into(),
                network_access: false,
                hyperframes_browser: None,
                video_agent_skill: None,
                turn_timeout: Duration::from_secs(10),
            })
            .await
            .unwrap();
            let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
            let cancellation = TurnCancellation::default();
            let cancel = cancellation.clone();
            let stop = mode == "stop";
            let collector = tokio::spawn(async move {
                let mut events = Vec::new();
                while let Some(event) = rx.recv().await {
                    if stop
                        && event["method"] == "project/modelRetry"
                        && event["params"]["status"] == "waiting"
                    {
                        cancel.cancel();
                    }
                    events.push(event);
                }
                events
            });
            let result = client
                .run_turn_with_retry_delays(
                    "thread",
                    "make video",
                    &[root.join("reference.png")],
                    TurnOptions {
                        model: Some("gpt-6-astra"),
                        effort: Some("medium"),
                        use_video_agent: mode != "image",
                        cancellation: Some(&cancellation),
                        event_tx: Some(tx),
                        ..Default::default()
                    },
                    |_| Duration::from_millis(20),
                    if mode == "budget" {
                        Duration::ZERO
                    } else {
                        Duration::from_secs(300)
                    },
                )
                .await;
            let events = collector.await.unwrap();
            let starts: Vec<Value> = std::fs::read_to_string(root.join("starts"))
                .unwrap()
                .lines()
                .map(|s| serde_json::from_str(s).unwrap())
                .collect();
            assert_eq!(starts.len(), expected_starts, "{mode}");
            assert_eq!(starts[0]["input"][1]["type"], "localImage");
            for start in &starts[1..] {
                assert_eq!(start["threadId"], "thread");
                assert_eq!(start["model"], "gpt-6-astra");
                assert_eq!(start["effort"], "medium");
                assert_eq!(start["input"].as_array().unwrap().len(), 1);
                assert_eq!(start["input"][0]["text"], MODEL_RETRY_PROMPT);
            }
            let retries: Vec<_> = events
                .iter()
                .filter(|e| e["method"] == "project/modelRetry")
                .collect();
            match mode {
                "success" => {
                    assert_eq!(result.unwrap().text, "draft ready");
                    assert_eq!(retries.last().unwrap()["params"]["status"], "completed");
                }
                "exhausted" => {
                    assert!(matches!(result, Err(CodexError::TurnOverloaded { .. })));
                    assert_eq!(retries.last().unwrap()["params"]["attempt"], 5);
                    assert_eq!(retries.last().unwrap()["params"]["status"], "failed");
                }
                "stop" => {
                    assert!(matches!(result, Err(CodexError::TurnInterrupted(_))));
                    assert_eq!(retries.last().unwrap()["params"]["status"], "interrupted");
                }
                "native" => {
                    assert!(result.is_ok());
                    assert!(retries.is_empty());
                }
                "context" => {
                    assert!(matches!(result, Err(CodexError::TurnFailed(_))));
                    assert!(retries.is_empty());
                }
                "image" | "budget" => {
                    assert!(matches!(result, Err(CodexError::TurnOverloaded { .. })));
                    assert!(retries.is_empty());
                }
                "other_error" => {
                    assert!(matches!(result, Err(CodexError::TurnFailed(_))));
                    assert_eq!(retries.last().unwrap()["params"]["status"], "failed");
                }
                _ => unreachable!(),
            }
            client._child.lock().await.kill().await.unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn recovery_matches_only_the_current_submission() {
        let snapshot = json!({"thread":{"turns":[{"id":"old","startedAt":100,"items":[
            {"type":"userMessage","content":[{"type":"text","text":"make video"}]}]}]}});
        assert!(submitted_turn(&snapshot, 101, "make video").is_none());
        assert!(submitted_turn(&snapshot, 100, "different request").is_none());
        assert_eq!(
            submitted_turn(&snapshot, 100, "make video").unwrap()["id"],
            "old"
        );
    }

    #[tokio::test]
    async fn recovers_missing_receipt_and_completion_without_resubmitting() {
        use std::os::unix::fs::PermissionsExt;
        for acknowledge in [false, true] {
            let root = std::env::temp_dir()
                .join(format!("yingya-codex-recovery-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(root.join("auth.json"), "{}").unwrap();
            let script = root.join("mock.py");
            std::fs::write(
                &script,
                format!(
                    r#"#!/usr/bin/python3
import json,sys,time,pathlib
turn=None
for line in sys.stdin:
 r=json.loads(line); method=r.get('method'); result={{}}
 if method=='initialized':continue
 if method=='turn/start':
  pathlib.Path('starts').open('a').write('start\n')
  turn={{'id':'actual-turn','status':'completed','startedAt':int(time.time()),'items':[
   {{'id':'input','type':'userMessage','content':[{{'type':'text','text':'make video'}}]}},
   {{'id':'reply','type':'agentMessage','text':'draft ready'}}]}}
  if not {acknowledge}:continue
  result={{'turn':{{'id':'actual-turn','status':'inProgress'}}}}
 elif method=='thread/read':result={{'thread':{{'turns':[turn]}}}}
 print(json.dumps({{'id':r['id'],'result':result}}),flush=True)
"#,
                    acknowledge = if acknowledge { "True" } else { "False" }
                ),
            )
            .unwrap();
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            let config = CodexConfig {
                sandbox: None,
                accounting: None,
                binary: script,
                home: root.clone(),
                workspace: root.clone(),
                model: "test".into(),
                network_access: false,
                hyperframes_browser: None,
                video_agent_skill: None,
                turn_timeout: Duration::from_secs(10),
            };
            let client = CodexClient::spawn(config).await.unwrap();
            let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
            let result = client
                .run_turn(
                    "thread",
                    "make video",
                    &[],
                    TurnOptions {
                        event_tx: Some(tx),
                        ..Default::default()
                    },
                )
                .await
                .unwrap();
            assert_eq!(result.turn_id, "actual-turn");
            assert_eq!(result.text, "draft ready");
            assert_eq!(
                std::fs::read_to_string(root.join("starts"))
                    .unwrap()
                    .lines()
                    .count(),
                1
            );
            let mut completed = false;
            while let Ok(event) = rx.try_recv() {
                completed |= event["method"] == "turn/completed";
            }
            assert!(completed);
            client._child.lock().await.kill().await.unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn feedback_screenshots_are_visual_inputs_not_only_prompt_paths() {
        let path = PathBuf::from("/tmp/project/.yingya/feedback-assets/frame.png");
        let input = turn_user_input("把标记中的形状改成圆形", std::slice::from_ref(&path));
        assert_eq!(input[0]["type"], "text");
        assert_eq!(
            input[1],
            json!({"type":"localImage","path":path,"detail":"original"})
        );
        assert_eq!(turn_user_input("普通消息", &[]).len(), 1);
    }

    #[test]
    fn runtime_validation_rejects_missing_binary() {
        let config = CodexConfig {
            sandbox: None,
            accounting: None,
            binary: Path::new("/definitely/missing/codex").to_path_buf(),
            home: Path::new("/tmp").to_path_buf(),
            workspace: Path::new("/tmp").to_path_buf(),
            model: "test".to_owned(),
            network_access: false,
            hyperframes_browser: None,
            video_agent_skill: None,
            turn_timeout: Duration::from_secs(300),
        };

        assert!(matches!(
            ensure_runtime_files(&config),
            Err(CodexError::MissingExecutable(_))
        ));
    }
}

#[cfg(test)]
mod write_regression {
    use super::*;
    #[tokio::test]
    async fn blocked_stdin_times_out_and_poisoned_transport_rejects_new_frames() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!(
            "yingya-blocked-write-audit-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("auth.json"), "{}").unwrap();
        let script = root.join("mock.py");
        std::fs::write(
            &script,
            r#"#!/usr/bin/python3
import sys,json,time
for line in sys.stdin:
 r=json.loads(line)
 if r.get('method')=='initialized':time.sleep(30);continue
 print(json.dumps({'id':r['id'],'result':{}}),flush=True)
"#,
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let config = CodexConfig {
            sandbox: None,
            accounting: None,
            binary: script,
            home: root.clone(),
            workspace: root.clone(),
            model: "audit".into(),
            network_access: false,
            hyperframes_browser: None,
            video_agent_skill: None,
            turn_timeout: Duration::from_secs(10),
        };
        let client = CodexClient::spawn(config).await.unwrap();
        let result = timeout(
            REQUEST_TIMEOUT * 3,
            client.request("turn/start", json!({"text":"x".repeat(2*1024*1024)})),
        )
        .await;
        assert!(matches!(
            result.unwrap(),
            Err(CodexError::TransportUnavailable)
        ));
        assert!(client.pending.lock().await.is_empty());
        let started = Instant::now();
        assert!(matches!(
            client.request("thread/read", json!({})).await,
            Err(CodexError::TransportUnavailable)
        ));
        assert!(started.elapsed() < REQUEST_TIMEOUT);
        client.restart().await.unwrap();
        assert!(!client.write_incomplete.load(Ordering::Acquire));
        client._child.lock().await.kill().await.unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
