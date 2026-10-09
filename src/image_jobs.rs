//! Durable per-user image generation records. The runtime guard outlives the
//! HTTP request, so closing a browser and rolling releases cannot drop a turn.
use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ImageJob {
    id: String,
    prompt: String,
    reference_images: Vec<String>,
    model: String,
    reasoning_effort: String,
    status: String,
    #[serde(default)]
    dismissed: bool,
    created_at: u64,
    updated_at: u64,
    images: Vec<ImageAsset>,
    error: Option<String>,
}

#[derive(Clone)]
pub(super) struct ImageJobs {
    root: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

impl ImageJobs {
    pub(super) async fn new(root: PathBuf) -> Result<Self, ApiError> {
        agent_projects::reject_symlink_components(&root).map_err(ApiError::BadRequest)?;
        fs::create_dir_all(&root).await?;
        let store = Self {
            root: Arc::new(root),
            lock: Arc::new(Mutex::new(())),
        };
        // A new worker owns this user exclusively. Unknown external work must
        // not be submitted twice after a crash; preserve the input for retry.
        for mut job in store.list().await? {
            if job.status == "running" {
                job.status = "failed".into();
                job.updated_at = agent_projects::now_millis();
                job.error = Some("图片生成已中断，请先查看素材库是否已有结果，再重新生成。".into());
                store.write(&job).await?;
            }
        }
        Ok(store)
    }

    fn path(&self, id: &str) -> Result<PathBuf, ApiError> {
        let id =
            Uuid::parse_str(id).map_err(|_| ApiError::BadRequest("无效的生成记录编号".into()))?;
        let path = self.root.join(format!("{id}.json"));
        agent_projects::reject_symlink_components(&path).map_err(ApiError::BadRequest)?;
        Ok(path)
    }

    async fn read(&self, id: &str) -> Result<ImageJob, ApiError> {
        let bytes = fs::read(self.path(id)?).await?;
        serde_json::from_slice(&bytes)
            .map_err(|_| ApiError::External("生成记录读取失败，请重试。".into()))
    }

    async fn write(&self, job: &ImageJob) -> Result<(), ApiError> {
        let path = self.path(&job.id)?;
        let temporary = self.root.join(format!("{}.tmp", Uuid::new_v4()));
        let bytes =
            serde_json::to_vec(job).map_err(|_| ApiError::External("生成记录保存失败".into()))?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .await?;
        file.write_all(&bytes).await?;
        file.sync_all().await?;
        fs::rename(temporary, path).await?;
        Ok(())
    }

    async fn list(&self) -> Result<Vec<ImageJob>, ApiError> {
        let mut entries = fs::read_dir(&*self.root).await?;
        let mut jobs = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                jobs.push(
                    self.read(
                        path.file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or_default(),
                    )
                    .await?,
                );
            }
        }
        jobs.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| b.id.cmp(&a.id))
        });
        jobs.retain(|job| !job.dismissed);
        Ok(jobs)
    }

    // Keep the private receipt so a delayed retry cannot regenerate or charge twice.
    // History cleanup never touches the library asset or voice profile.
    async fn dismiss(&self, id: Option<&str>) -> Result<Vec<String>, ApiError> {
        let _lock = self.lock.lock().await;
        let records = if let Some(id) = id {
            let job = self.read(id).await.map_err(|error| match error {
                ApiError::Io(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    ApiError::NotFound("任务记录不存在".into())
                }
                error => error,
            })?;
            if job.status == "running" {
                return Err(ApiError::Conflict("进行中的任务不能删除".into()));
            }
            vec![job]
        } else {
            self.list()
                .await?
                .into_iter()
                .filter(|job| job.status == "completed")
                .collect()
        };
        let mut removed = Vec::new();
        for mut job in records {
            job.dismissed = true;
            self.write(&job).await?;
            removed.push(job.id);
        }
        Ok(removed)
    }

    async fn create(&self, job: ImageJob) -> Result<(ImageJob, bool), ApiError> {
        let _lock = self.lock.lock().await;
        match self.read(&job.id).await {
            Ok(existing) => {
                if existing.dismissed {
                    return Err(ApiError::Conflict("记录已清理，请新建生成任务。".into()));
                }
                if existing.prompt != job.prompt
                    || existing.reference_images != job.reference_images
                    || existing.model != job.model
                    || existing.reasoning_effort != job.reasoning_effort
                {
                    return Err(ApiError::Conflict(
                        "请求编号已用于其他图片，请重新提交。".into(),
                    ));
                }
                Ok((existing, false))
            }
            Err(ApiError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                self.write(&job).await?;
                Ok((job, true))
            }
            Err(error) => Err(error),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateImageJob {
    client_request_id: String,
    #[serde(flatten)]
    request: TurnRequest,
}

pub(super) async fn clear_completed(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(state.image_jobs.dismiss(None).await?))
}
pub(super) async fn dismiss(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(state.image_jobs.dismiss(Some(&id)).await?))
}

pub(super) async fn list(State(state): State<AppState>) -> Result<Json<Vec<ImageJob>>, ApiError> {
    Ok(Json(state.image_jobs.list().await?))
}

pub(super) async fn create(
    State(state): State<AppState>,
    Json(input): Json<CreateImageJob>,
) -> Result<Json<ImageJob>, ApiError> {
    let (job, _) = start(state, input.client_request_id, None, input.request).await?;
    Ok(Json(job))
}

type ImageTask = tokio::task::JoinHandle<Result<Json<TurnResponse>, ApiError>>;
pub(super) async fn start(
    state: AppState,
    id: String,
    thread_id: Option<String>,
    request: TurnRequest,
) -> Result<(ImageJob, Option<ImageTask>), ApiError> {
    let prompt = request.prompt.trim().to_owned();
    if prompt.is_empty() {
        return Err(ApiError::BadRequest("请填写画面描述".into()));
    }
    let model = request
        .model
        .clone()
        .unwrap_or_else(|| state.codex.model().into());
    let effort = request
        .reasoning_effort
        .clone()
        .unwrap_or_else(|| "auto".into());
    validate_model_settings(&model, &effort).map_err(ApiError::Validation)?;
    for reference in &request.reference_images {
        state.assets.resolve(reference).await?;
    }
    if thread_id
        .as_ref()
        .is_some_and(|id| !state.accounts.owns_thread(id, &state.user.id))
    {
        return Err(ApiError::BadRequest("会话不存在".into()));
    }
    let work = state
        .control
        .enter()
        .ok_or_else(|| ApiError::Conflict("服务正在更新，请稍后重试。".into()))?;
    let now = agent_projects::now_millis();
    let (job, created) = state
        .image_jobs
        .create(ImageJob {
            id,
            prompt,
            reference_images: request.reference_images.clone(),
            model,
            reasoning_effort: effort,
            status: "running".into(),
            dismissed: false,
            created_at: now,
            updated_at: now,
            images: Vec::new(),
            error: None,
        })
        .await?;
    if !created {
        return Ok((job, None));
    }
    let mut running = job.clone();
    let task = tokio::spawn(async move {
        let _work = work;
        let result = async {
            let thread_id = match thread_id {
                Some(id) => id,
                None => state.codex.start_thread().await?.thread_id,
            };
            execute_turn(state.clone(), thread_id, request, true).await
        }
        .await;
        running.updated_at = agent_projects::now_millis();
        match &result {
            Ok(Json(turn)) => {
                running.status = "completed".into();
                running.images = turn.images.clone();
            }
            Err(error) => {
                running.status = "failed".into();
                running.error = Some(match error {
                    ApiError::BadRequest(message)
                    | ApiError::Validation(message)
                    | ApiError::External(message) => message.clone(),
                    ApiError::Codex(error) => image_generation_error(error).into(),
                    _ => "图片生成未完成，请先查看素材库是否已有结果，再重新生成。".into(),
                });
            }
        }
        if let Err(error) = state.image_jobs.write(&running).await {
            warn!(%error, job=%running.id, "image job final state could not be saved");
        }
        result
    });
    Ok((job, Some(task)))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn job() -> ImageJob {
        ImageJob {
            id: Uuid::new_v4().to_string(),
            prompt: "一只猫".into(),
            reference_images: vec!["/assets/uploads/ref.png".into()],
            model: "gpt-6-astra".into(),
            reasoning_effort: "medium".into(),
            status: "running".into(),
            dismissed: false,
            created_at: 1,
            updated_at: 1,
            images: vec![],
            error: None,
        }
    }
    #[tokio::test]
    async fn image_job_deduplicates_and_recovers_without_resubmitting() {
        let root = env::temp_dir().join(format!("yingya-image-jobs-{}", Uuid::new_v4()));
        let store = ImageJobs::new(root.clone()).await.unwrap();
        let input = job();
        assert!(store.create(input.clone()).await.unwrap().1);
        assert!(!store.create(input.clone()).await.unwrap().1);
        let mut different = input.clone();
        different.prompt = "另一张".into();
        assert!(matches!(
            store.create(different).await,
            Err(ApiError::Conflict(_))
        ));
        let mut completed = job();
        completed.status = "completed".into();
        store.create(completed).await.unwrap();
        let recovered = ImageJobs::new(root.clone()).await.unwrap();
        let jobs = recovered.list().await.unwrap();
        assert_eq!(jobs.len(), 2);
        let interrupted = recovered.read(&input.id).await.unwrap();
        assert_eq!(interrupted.status, "failed");
        assert_eq!(interrupted.reference_images, input.reference_images);
        assert!(interrupted.error.unwrap().contains("已中断"));
        assert!(jobs.iter().any(|j| j.status == "completed"));
        assert!(recovered.read("../outside").await.is_err());
        let other = ImageJobs::new(root.join("other-user")).await.unwrap();
        assert!(other.list().await.unwrap().is_empty());
        assert!(other.read(&input.id).await.is_err());
        fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn image_history_cleanup_preserves_receipts_and_running_jobs() {
        let root = env::temp_dir().join(format!("yingya-image-cleanup-{}", Uuid::new_v4()));
        let store = ImageJobs::new(root.clone()).await.unwrap();
        let running = job();
        let mut completed = job();
        completed.status = "completed".into();
        let mut failed = job();
        failed.status = "failed".into();
        for input in [&running, &completed, &failed] {
            store.create(input.clone()).await.unwrap();
        }
        assert!(matches!(
            store.dismiss(Some(&running.id)).await,
            Err(ApiError::Conflict(_))
        ));
        assert_eq!(
            store.dismiss(None).await.unwrap(),
            vec![completed.id.clone()]
        );
        assert_eq!(store.list().await.unwrap().len(), 2);
        assert!(store.dismiss(None).await.unwrap().is_empty());
        assert!(matches!(
            store.create(completed.clone()).await,
            Err(ApiError::Conflict(_))
        ));
        store.dismiss(Some(&failed.id)).await.unwrap();
        store.dismiss(Some(&failed.id)).await.unwrap(); // Lost DELETE receipt can be retried.
        assert!(matches!(
            store.dismiss(Some(&Uuid::new_v4().to_string())).await,
            Err(ApiError::NotFound(_))
        ));
        let reopened = ImageJobs::new(root.clone()).await.unwrap();
        assert_eq!(reopened.list().await.unwrap().len(), 1);
        assert!(reopened.read(&completed.id).await.unwrap().dismissed);
        let mut legacy = serde_json::to_value(job()).unwrap();
        legacy.as_object_mut().unwrap().remove("dismissed");
        assert!(
            !serde_json::from_value::<ImageJob>(legacy)
                .unwrap()
                .dismissed
        );
        fs::remove_dir_all(root).await.unwrap();
    }
    #[tokio::test]
    async fn image_job_rejects_symlink_record() {
        let root = env::temp_dir().join(format!("yingya-image-jobs-{}", Uuid::new_v4()));
        let store = ImageJobs::new(root.clone()).await.unwrap();
        let id = Uuid::new_v4().to_string();
        std::os::unix::fs::symlink("/etc/passwd", root.join(format!("{id}.json"))).unwrap();
        assert!(store.list().await.is_err());
        fs::remove_dir_all(root).await.unwrap();
    }
}
