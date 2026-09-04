use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::{Deserialize, Serialize};
use tokio::{fs, sync::Mutex};
use uuid::Uuid;

const MAX_RENDER_JOBS: usize = 50;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RenderJobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Interrupted,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderJob {
    pub id: String,
    pub version_id: String,
    pub status: RenderJobStatus,
    pub quality: String,
    pub resolution: String,
    pub fps: u16,
    pub progress: u8,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub started_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<u64>,
}

impl RenderJob {
    pub fn queued(id: String, version_id: String, resolution: String, fps: u16, now: u64) -> Self {
        Self {
            id,
            version_id,
            status: RenderJobStatus::Queued,
            quality: "high".to_owned(),
            resolution,
            fps,
            progress: 0,
            message: "等待开始渲染".to_owned(),
            output_path: None,
            error: None,
            started_at: now,
            updated_at: now,
            ended_at: None,
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self.status,
            RenderJobStatus::Queued | RenderJobStatus::Running
        )
    }
}

#[derive(Clone)]
pub struct RenderJobStore {
    projects_root: Arc<PathBuf>,
    locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl RenderJobStore {
    pub fn new(projects_root: PathBuf) -> Self {
        Self {
            projects_root: Arc::new(projects_root),
            locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn project_lock(&self, project_id: &str) -> Result<Arc<Mutex<()>>, String> {
        self.jobs_path(project_id)?;
        let mut locks = self.locks.lock().await;
        Ok(locks
            .entry(project_id.to_owned())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone())
    }

    fn jobs_path(&self, project_id: &str) -> Result<PathBuf, String> {
        Uuid::parse_str(project_id).map_err(|_| "invalid project id".to_owned())?;
        Ok(self
            .projects_root
            .join(project_id)
            .join(".yingya/render-jobs.json"))
    }

    pub async fn list(&self, project_id: &str, limit: usize) -> Result<Vec<RenderJob>, String> {
        let mut jobs = read_jobs(&self.jobs_path(project_id)?).await?;
        jobs.sort_by_key(|job| std::cmp::Reverse(job.started_at));
        jobs.truncate(limit.min(MAX_RENDER_JOBS));
        Ok(jobs)
    }

    pub async fn create(&self, project_id: &str, job: RenderJob) -> Result<(), String> {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let path = self.jobs_path(project_id)?;
        let mut jobs = read_jobs(&path).await?;
        jobs.retain(|existing| existing.id != job.id);
        jobs.push(job);
        jobs.sort_by_key(|item| std::cmp::Reverse(item.started_at));
        jobs.truncate(MAX_RENDER_JOBS);
        write_jobs(&path, &jobs).await
    }

    pub async fn update<F>(
        &self,
        project_id: &str,
        job_id: &str,
        update: F,
    ) -> Result<RenderJob, String>
    where
        F: FnOnce(&mut RenderJob),
    {
        let lock = self.project_lock(project_id).await?;
        let _guard = lock.lock().await;
        let path = self.jobs_path(project_id)?;
        let mut jobs = read_jobs(&path).await?;
        let job = jobs
            .iter_mut()
            .find(|job| job.id == job_id)
            .ok_or_else(|| "render job not found".to_owned())?;
        update(job);
        let updated = job.clone();
        write_jobs(&path, &jobs).await?;
        Ok(updated)
    }

    pub async fn reconcile_interrupted(
        &self,
        now: u64,
    ) -> Result<Vec<(String, RenderJob)>, String> {
        let mut directory = match fs::read_dir(self.projects_root.as_ref()).await {
            Ok(directory) => directory,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(error) => return Err(error.to_string()),
        };
        let mut interrupted = Vec::new();
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
            let project_id = entry.file_name().to_string_lossy().to_string();
            if Uuid::parse_str(&project_id).is_err() {
                continue;
            }
            let path = entry.path().join(".yingya/render-jobs.json");
            let mut jobs = read_jobs(&path).await?;
            let mut changed = false;
            let mut temporary_outputs = Vec::new();
            for job in &mut jobs {
                if job.is_active() {
                    temporary_outputs.push(
                        entry
                            .path()
                            .join(".yingya/exports/.tmp")
                            .join(format!("{}.partial.mp4", job.id)),
                    );
                    job.status = RenderJobStatus::Interrupted;
                    job.progress = 0;
                    job.message = "服务重启导致渲染中断，可按原设置重试".to_owned();
                    job.error = Some("渲染服务已重启".to_owned());
                    job.updated_at = now;
                    job.ended_at = Some(now);
                    interrupted.push((project_id.clone(), job.clone()));
                    changed = true;
                }
            }
            if changed {
                write_jobs(&path, &jobs).await?;
                for temporary in temporary_outputs {
                    match fs::remove_file(temporary).await {
                        Ok(()) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                        Err(error) => return Err(error.to_string()),
                    }
                }
            }
        }
        Ok(interrupted)
    }
}

async fn read_jobs(path: &Path) -> Result<Vec<RenderJob>, String> {
    match fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(error) => Err(error.to_string()),
    }
}

async fn write_jobs(path: &Path, jobs: &[RenderJob]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .map_err(|error| error.to_string())?;
    }
    let bytes = serde_json::to_vec_pretty(jobs).map_err(|error| error.to_string())?;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, bytes)
        .await
        .map_err(|error| error.to_string())?;
    if let Err(error) = fs::rename(&temporary, path).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn persists_updates_and_keeps_latest_fifty_jobs() {
        let root = std::env::temp_dir().join(format!("yingya-render-jobs-{}", Uuid::new_v4()));
        let project_id = Uuid::new_v4().to_string();
        fs::create_dir_all(root.join(&project_id)).await.unwrap();
        let store = RenderJobStore::new(root.clone());
        for index in 0..55_u64 {
            store
                .create(
                    &project_id,
                    RenderJob::queued(
                        format!("job-{index}"),
                        "draft-1".to_owned(),
                        "1920x1080".to_owned(),
                        30,
                        index,
                    ),
                )
                .await
                .unwrap();
        }
        let jobs = store.list(&project_id, 100).await.unwrap();
        assert_eq!(jobs.len(), 50);
        assert_eq!(jobs[0].id, "job-54");
        assert_eq!(jobs.last().unwrap().id, "job-5");

        let updated = store
            .update(&project_id, "job-54", |job| {
                job.status = RenderJobStatus::Completed;
                job.progress = 100;
            })
            .await
            .unwrap();
        assert_eq!(updated.status, RenderJobStatus::Completed);
        assert_eq!(store.list(&project_id, 1).await.unwrap()[0].progress, 100);
        let _ = fs::remove_dir_all(root).await;
    }

    #[tokio::test]
    async fn reconciles_active_jobs_after_restart() {
        let root = std::env::temp_dir().join(format!("yingya-render-reconcile-{}", Uuid::new_v4()));
        let project_id = Uuid::new_v4().to_string();
        fs::create_dir_all(root.join(&project_id)).await.unwrap();
        let store = RenderJobStore::new(root.clone());
        store
            .create(
                &project_id,
                RenderJob::queued(
                    "job".to_owned(),
                    "draft-1".to_owned(),
                    "1080x1920".to_owned(),
                    60,
                    1,
                ),
            )
            .await
            .unwrap();
        let temporary = root
            .join(&project_id)
            .join(".yingya/exports/.tmp/job.partial.mp4");
        fs::create_dir_all(temporary.parent().unwrap())
            .await
            .unwrap();
        fs::write(&temporary, b"incomplete video").await.unwrap();
        let interrupted = store.reconcile_interrupted(20).await.unwrap();
        assert_eq!(interrupted.len(), 1);
        assert_eq!(interrupted[0].1.status, RenderJobStatus::Interrupted);
        assert_eq!(interrupted[0].1.ended_at, Some(20));
        assert!(!fs::try_exists(temporary).await.unwrap());
        let _ = fs::remove_dir_all(root).await;
    }
}
