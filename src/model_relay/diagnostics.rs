//! Only typed metadata is persisted: never headers, auth, prompts or error text.
use fs2::FileExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::OpenOptions,
    io::Write,
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

pub(super) fn fingerprint(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))[..32].to_owned()
}
pub(super) fn code(value: Option<&str>) -> Option<String> {
    value
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 128
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
        })
        .map(str::to_owned)
}
pub(super) fn tier(value: Option<&str>) -> Option<String> {
    value
        .filter(|s| {
            matches!(
                *s,
                "auto" | "default" | "priority" | "fast" | "flex" | "scale" | "ultrafast"
            )
        })
        .map(str::to_owned)
}
#[derive(Serialize)]
pub(super) struct Record {
    pub id: String,
    pub created_at_ms: u64,
    pub account_model: Option<String>,
    pub model: Option<String>,
    pub request_fingerprint: Option<String>,
    pub requested_tier: Option<String>,
    pub actual_tier: Option<String>,
    pub status: Option<u16>,
    pub outcome: &'static str,
    pub error_code: Option<String>,
    pub upstream_request_id: Option<String>,
    pub retry_after_secs: Option<u64>,
    pub queue_ms: u64,
    pub headers_ms: Option<u64>,
    pub first_byte_ms: Option<u64>,
    pub total_ms: u64,
    pub tokens: Option<i64>,
}
pub(super) struct Diagnostic {
    pub record: Record,
    pub started: Instant,
    root: PathBuf,
}
impl Diagnostic {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            started: Instant::now(),
            record: Record {
                id: uuid::Uuid::new_v4().to_string(),
                created_at_ms: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis()
                    .min(u64::MAX as u128) as u64,
                account_model: None,
                model: None,
                request_fingerprint: None,
                requested_tier: None,
                actual_tier: None,
                status: None,
                outcome: "cancelled",
                error_code: None,
                upstream_request_id: None,
                retry_after_secs: None,
                queue_ms: 0,
                headers_ms: None,
                first_byte_ms: None,
                total_ms: 0,
                tokens: None,
            },
        }
    }
    pub fn elapsed_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
}
impl Drop for Diagnostic {
    fn drop(&mut self) {
        self.record.total_ms = self.elapsed_ms();
        tracing::info!(relay_id=%self.record.id, model=?self.record.model, status=?self.record.status, outcome=self.record.outcome,
            error_code=?self.record.error_code, queue_ms=self.record.queue_ms, total_ms=self.record.total_ms,
            "model relay request completed");
        if append(&self.root, &self.record).is_err() {
            tracing::warn!("model relay diagnostic write failed");
        }
    }
}
fn append(root: &Path, record: &Record) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .mode(0o600)
        .open(root.join("diagnostics.lock"))?;
    lock.lock_exclusive()?;
    let path = root.join("requests.jsonl");
    if std::fs::metadata(&path).is_ok_and(|m| m.len() >= 8 * 1024 * 1024) {
        let older = root.join("requests.1.jsonl");
        if older.exists() {
            std::fs::rename(&older, root.join("requests.2.jsonl"))?;
        }
        std::fs::rename(&path, older)?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(path)?;
    serde_json::to_writer(&mut file, record)?;
    file.write_all(b"\n")
}
