//! Evidence for local production jobs. A successful job permits continuation,
//! never workflow completion or implicit approval of a draft.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
};

pub const MAX_CONTINUATIONS: usize = 2;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProductionJob {
    pub id: String,
    pub request_id: String,
    pub kind: String,
    pub key: String,
    #[serde(default)]
    pub started_at: f64,
    #[serde(default)]
    pub continue_workflow: bool,
    pub status: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub output: String,
    #[serde(default)]
    pub output_sha256: Option<String>,
    #[serde(default)]
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub stdout: String,
    #[serde(default)]
    pub stderr: String,
}

fn checked_path(project: &Path, path: PathBuf) -> Result<PathBuf, String> {
    let mut ancestor = path.as_path();
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or("执行记录路径无效")?;
    }
    let project = project.canonicalize().map_err(|e| e.to_string())?;
    if !ancestor
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(project)
    {
        return Err("执行记录路径超出项目范围".into());
    }
    Ok(path)
}

fn directory(project: &Path) -> Result<PathBuf, String> {
    checked_path(project, project.join(".yingya/production-jobs"))
}

pub fn read(project: &Path, request_id: &str) -> Result<Vec<ProductionJob>, String> {
    let directory = directory(project)?;
    if !directory.exists() {
        return Ok(vec![]);
    }
    let lock = OpenOptions::new()
        .create(true)
        .append(true)
        .open(checked_path(project, directory.join("run.lock"))?)
        .map_err(|e| e.to_string())?;
    let running = match lock.try_lock_exclusive() {
        Ok(()) => false,
        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => true,
        Err(error) => return Err(error.to_string()),
    };
    let active_id = fs::read_to_string(directory.join("run.lock")).unwrap_or_default();
    let mut jobs = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json")
            || !path
                .file_stem()
                .and_then(|x| x.to_str())
                .is_some_and(|id| id.len() == 32 && id.bytes().all(|c| c.is_ascii_hexdigit()))
            || checked_path(project, path.clone()).is_err()
            || fs::metadata(&path).is_ok_and(|metadata| metadata.len() > 128 * 1024)
        {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let Ok(mut job) = serde_json::from_slice::<ProductionJob>(&bytes) else {
            continue;
        };
        if job.request_id != request_id
            || path.file_stem().and_then(|x| x.to_str()) != Some(&job.id)
        {
            continue;
        }
        if matches!(job.status.as_str(), "running" | "publishing")
            && (!running || active_id.trim() != job.id)
        {
            let output = project
                .join(&job.output)
                .canonicalize()
                .ok()
                .filter(|p| p.starts_with(project));
            let recovered = job.status == "publishing"
                && output.and_then(|path| {
                    let mut file = fs::File::open(path).ok()?;
                    let mut hash = Sha256::new();
                    std::io::copy(&mut file, &mut hash).ok()?;
                    Some(format!("{:x}", hash.finalize()))
                }) == job.output_sha256
                && job.output_sha256.is_some();
            job.status = if recovered { "succeeded" } else { "lost" }.into();
            job.message = if recovered {
                "完成结果已恢复。"
            } else {
                "执行进程已退出，尚未记录完整结果。请检查原日志。"
            }
            .into();
        }
        jobs.push(job);
    }
    jobs.sort_by(|a, b| a.started_at.total_cmp(&b.started_at).then(a.id.cmp(&b.id)));
    Ok(jobs)
}

pub fn cancel(project: &Path, request_id: &str) -> Result<(), String> {
    let directory = directory(project)?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join(format!("cancel-{request_id}")))
    {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn pause_reason(project: &Path, request_id: &str) -> Option<String> {
    let path = checked_path(project, project.join(".yingya/turn-result.json")).ok()?;
    let value: Value = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    (value["requestId"] == request_id
        && matches!(
            value["disposition"].as_str(),
            Some("blocked" | "needs_input")
        ))
    .then(|| {
        value["reason"]
            .as_str()
            .unwrap_or("需要补充信息后继续。")
            .chars()
            .take(2000)
            .collect()
    })
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinuationJournal {
    pub attempts: usize,
    pub consumed: Vec<String>,
}

impl ContinuationJournal {
    pub fn load(project: &Path, request_id: &str) -> Result<Self, String> {
        let path = checked_path(
            project,
            directory(project)?.join(format!("continuation-{request_id}.json")),
        )?;
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn reserve(
        &mut self,
        project: &Path,
        request_id: &str,
        evidence: Vec<String>,
    ) -> Result<bool, String> {
        if self.attempts >= MAX_CONTINUATIONS
            || !evidence.iter().any(|key| !self.consumed.contains(key))
        {
            return Ok(false);
        }
        self.attempts += 1;
        self.consumed.extend(evidence);
        let directory = directory(project)?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join(format!("continuation-{request_id}.json"));
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        fs::write(
            &temporary,
            serde_json::to_vec(self).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(temporary, path).map_err(|e| e.to_string())?;
        Ok(true)
    }
}

pub fn successful_evidence(jobs: &[ProductionJob]) -> Vec<String> {
    jobs.iter()
        .filter(|job| job.status == "succeeded" && job.continue_workflow)
        .map(|job| {
            format!(
                "{}:{}",
                job.key,
                job.output_sha256.as_deref().unwrap_or_default()
            )
        })
        .collect()
}

pub fn eligible(phase: &str, needs_recovery: bool, paused: bool, requested_input: bool) -> bool {
    needs_recovery && matches!(phase, "production" | "final_render") && !paused && !requested_input
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continuation_requires_progress_and_is_durable_and_bounded() {
        let project =
            std::env::temp_dir().join(format!("yingya-continuation-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&project).unwrap();
        let mut journal = ContinuationJournal::default();
        assert!(!journal.reserve(&project, "request", vec![]).unwrap());
        assert!(
            journal
                .reserve(&project, "request", vec!["check".into()])
                .unwrap()
        );
        let mut restored = ContinuationJournal::load(&project, "request").unwrap();
        assert!(
            !restored
                .reserve(&project, "request", vec!["check".into()])
                .unwrap()
        );
        assert!(
            restored
                .reserve(&project, "request", vec!["render".into()])
                .unwrap()
        );
        assert!(
            !restored
                .reserve(&project, "request", vec!["another".into()])
                .unwrap()
        );
        fs::remove_dir_all(project).unwrap();
    }

    #[test]
    fn checkpoints_stops_and_questions_prevent_continuation() {
        assert!(eligible("production", true, false, false));
        assert!(eligible("final_render", true, false, false));
        for phase in ["briefing", "plan_review", "draft_review", "completed"] {
            assert!(!eligible(phase, true, false, false));
        }
        assert!(!eligible("production", false, false, false));
        assert!(!eligible("production", true, true, false));
        assert!(!eligible("production", true, false, true));
    }
}
