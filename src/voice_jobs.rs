//! Durable, account-scoped voice creation. Accepted work owns a runtime guard
//! independently of the HTTP connection and is never replayed after a crash.
use super::*;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VoiceJob {
    id: String,
    voice_id: String,
    mode: String,
    name: String,
    description: String,
    ref_text: String,
    reference_name: Option<String>,
    reference_mime: Option<String>,
    reference_hash: Option<String>,
    status: String,
    #[serde(default)]
    dismissed: bool,
    created_at: u64,
    updated_at: u64,
    voice: Option<UploadedVoice>,
    error: Option<String>,
}

impl VoiceJob {
    fn same_input(&self, other: &Self) -> bool {
        self.mode == other.mode
            && self.name == other.name
            && self.description == other.description
            && self.ref_text == other.ref_text
            && self.reference_hash == other.reference_hash
    }
}

#[derive(Clone)]
pub(super) struct VoiceJobs {
    root: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}
impl VoiceJobs {
    pub(super) async fn new(root: PathBuf) -> Result<Self, ApiError> {
        agent_projects::reject_symlink_components(&root).map_err(ApiError::BadRequest)?;
        fs::create_dir_all(&root).await?;
        let store = Self {
            root: Arc::new(root),
            lock: Arc::new(Mutex::new(())),
        };
        for mut job in store.list().await? {
            if job.status == "running" {
                job.status = "failed".into();
                job.error = Some("音色创建已中断，请先查看音色库是否已有结果，再编辑重试。".into());
                job.updated_at = agent_projects::now_millis();
                store.write(&job).await?;
            }
        }
        Ok(store)
    }
    fn path(&self, id: &str, extension: &str) -> Result<PathBuf, ApiError> {
        let id =
            Uuid::parse_str(id).map_err(|_| ApiError::Validation("无效的音色任务编号".into()))?;
        let path = self.root.join(format!("{id}.{extension}"));
        agent_projects::reject_symlink_components(&path).map_err(ApiError::BadRequest)?;
        Ok(path)
    }
    async fn read(&self, id: &str) -> Result<VoiceJob, ApiError> {
        let bytes = fs::read(self.path(id, "json")?).await?;
        serde_json::from_slice(&bytes).map_err(|_| ApiError::External("音色记录读取失败".into()))
    }
    async fn write(&self, job: &VoiceJob) -> Result<(), ApiError> {
        let bytes =
            serde_json::to_vec(job).map_err(|_| ApiError::External("音色记录保存失败".into()))?;
        let temporary = self.path(&Uuid::new_v4().to_string(), "tmp")?;
        private_write(&temporary, &bytes).await?;
        fs::rename(temporary, self.path(&job.id, "json")?).await?;
        Ok(())
    }
    async fn list(&self) -> Result<Vec<VoiceJob>, ApiError> {
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

    async fn existing(&self, job: &VoiceJob) -> Result<Option<VoiceJob>, ApiError> {
        match self.read(&job.id).await {
            Ok(existing) if existing.dismissed => {
                Err(ApiError::Conflict("记录已清理，请新建生成任务。".into()))
            }
            Ok(existing) if existing.same_input(job) => Ok(Some(existing)),
            Ok(_) => Err(ApiError::Conflict(
                "请求编号已用于其他音色，请重新提交。".into(),
            )),
            Err(ApiError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
}
async fn private_write(path: &FilePath, bytes: &[u8]) -> Result<(), ApiError> {
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .await?;
    file.write_all(bytes).await?;
    file.sync_all().await?;
    Ok(())
}

pub(super) async fn clear_completed(
    State(state): State<AppState>,
) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(state.voice_jobs.dismiss(None).await?))
}
pub(super) async fn dismiss(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    Ok(Json(state.voice_jobs.dismiss(Some(&id)).await?))
}

pub(super) async fn list(State(state): State<AppState>) -> Result<Json<Vec<VoiceJob>>, ApiError> {
    Ok(Json(state.voice_jobs.list().await?))
}
pub(super) async fn reference(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    let job = state.voice_jobs.read(&id).await?;
    if job.dismissed {
        return Err(ApiError::NotFound("任务记录已清理".into()));
    }
    if job.reference_hash.is_none() {
        return Err(ApiError::NotFound("此任务没有参考音频".into()));
    }
    let bytes = fs::read(state.voice_jobs.path(&id, "audio")?).await?;
    Ok((
        [
            (
                CONTENT_TYPE,
                job.reference_mime.unwrap_or_else(|| "audio/wav".into()),
            ),
            (
                axum::http::header::CACHE_CONTROL,
                "private, no-store".into(),
            ),
        ],
        bytes,
    )
        .into_response())
}

pub(super) async fn create(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<VoiceJob>, ApiError> {
    let mut values = std::collections::HashMap::new();
    let mut audio = None;
    while let Some(field) = multipart.next_field().await.map_err(bad_multipart)? {
        if field.name() == Some("audio") {
            let name = field.file_name().unwrap_or("reference.wav").to_owned();
            let mime = field.content_type().unwrap_or("audio/wav").to_owned();
            audio = Some((
                name,
                mime,
                field.bytes().await.map_err(bad_multipart)?.to_vec(),
            ));
        } else if let Some(key) = field.name().map(str::to_owned) {
            values.insert(key, field.text().await.map_err(bad_multipart)?);
        }
    }
    let get = |key: &str| values.get(key).map(|s| s.trim()).unwrap_or_default();
    let id = Uuid::parse_str(get("clientRequestId"))
        .map_err(|_| ApiError::Validation("无效的请求编号".into()))?
        .to_string();
    let mode = get("mode");
    if !["design", "clone"].contains(&mode) {
        return Err(ApiError::Validation("请选择音色创建方式".into()));
    }
    let name = validate_voice_name(get("name"))?;
    let description = get("description");
    if description.chars().count() > 200 || (mode == "design" && description.chars().count() < 4) {
        return Err(ApiError::Validation(
            "描述生成需要 4–200 个字符，克隆说明最多 200 个字符".into(),
        ));
    }
    let ref_text = if mode == "clone" { get("refText") } else { "" };
    if mode == "clone"
        && (get("authorized") != "true" || ref_text.is_empty() || ref_text.chars().count() > 500)
    {
        return Err(ApiError::Validation(
            "请填写参考音频原文（最多 500 个字符），并确认声音所有者授权".into(),
        ));
    }
    if mode == "design" {
        audio = None;
    }
    if mode == "clone"
        && audio
            .as_ref()
            .is_none_or(|a| a.2.is_empty() || a.2.len() > 10 * 1024 * 1024)
    {
        return Err(ApiError::Validation(
            "请选择 1–30 秒且不超过 10 MB 的参考音频".into(),
        ));
    }
    let now = agent_projects::now_millis();
    let mut job = VoiceJob {
        id,
        voice_id: format!("voice-{}", &Uuid::new_v4().simple().to_string()[..20]),
        mode: mode.into(),
        name,
        description: description.into(),
        ref_text: ref_text.into(),
        reference_name: audio.as_ref().map(|a| a.0.clone()),
        reference_mime: audio.as_ref().map(|a| a.1.clone()),
        reference_hash: audio
            .as_ref()
            .map(|a| format!("{:x}", Sha256::digest(&a.2))),
        status: "running".into(),
        dismissed: false,
        created_at: now,
        updated_at: now,
        voice: None,
        error: None,
    };
    let _lock = state.voice_jobs.lock.lock().await;
    if let Some(existing) = state.voice_jobs.existing(&job).await? {
        return Ok(Json(existing));
    }
    if state
        .voice_jobs
        .list()
        .await?
        .iter()
        .any(|j| j.status == "running" && j.name.to_lowercase() == job.name.to_lowercase())
    {
        return Err(ApiError::Conflict(
            "同名音色正在创建，请在任务记录查看。".into(),
        ));
    }
    check_voice_label(&state, &job.name, None).await?;
    if let Some((_, _, bytes)) = &audio {
        state
            .voices
            .validate_sample(bytes)
            .await
            .map_err(ApiError::Validation)?;
    }
    let work = state
        .control
        .enter()
        .ok_or_else(|| ApiError::Conflict("服务正在更新，请稍后重试。".into()))?;
    if let Some((_, _, bytes)) = &audio {
        let path = state.voice_jobs.path(&job.id, "audio")?;
        // A failed record write may leave an unaccepted sample. Its checksum must match.
        if fs::try_exists(&path).await? {
            if Sha256::digest(fs::read(&path).await?) != Sha256::digest(bytes) {
                return Err(ApiError::Conflict("请求编号已用于其他参考音频".into()));
            }
        } else {
            private_write(&path, bytes).await?;
        }
    }
    state.voice_jobs.write(&job).await?;
    if let Err(error) = state.accounts.consume_media(&state.user.id) {
        job.status = "failed".into();
        job.error = Some(error);
        state.voice_jobs.write(&job).await?;
        return Ok(Json(job));
    }
    let accepted = job.clone();
    let task_state = state.clone();
    tokio::spawn(async move {
        let _work = work;
        let result: Result<UploadedVoice, ApiError> = async {
            let _catalog = task_state.voices.catalog_lock.lock().await;
            check_voice_label(&task_state, &job.name, None).await?;
            // Provider IDs are server-assigned; a caller-chosen request ID must
            // never be able to overwrite an existing voice profile.
            let voice_id = &job.voice_id;
            task_state
                .voices
                .save_profile(voice_id, &job.name, &job.description, false)
                .await?;
            let mut voice = if let Some((filename, mime, bytes)) = audio {
                task_state
                    .voices
                    .upload(
                        voice_id,
                        &job.description,
                        &job.ref_text,
                        "yingya-user-authorized",
                        &filename,
                        &mime,
                        bytes,
                    )
                    .await?
            } else {
                task_state
                    .voices
                    .create_design(voice_id, &job.description)
                    .await?
            };
            voice.display_name = Some(job.name.clone());
            Ok(voice)
        }
        .await;
        job.updated_at = agent_projects::now_millis();
        match result {
            Ok(voice) => {
                job.status = "completed".into();
                job.voice = Some(voice);
            }
            Err(error) => {
                job.status = "failed".into();
                job.error = Some(match error {
                    ApiError::Validation(s) | ApiError::Conflict(s) | ApiError::External(s) => s,
                    _ => "音色创建未完成，请先查看音色库是否已有结果，再编辑重试。".into(),
                });
            }
        }
        if let Err(error) = task_state.voice_jobs.write(&job).await {
            warn!(%error, job=%job.id, "voice job final state could not be saved");
        }
    });
    Ok(Json(accepted))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn voice_jobs_recover_isolate_and_reject_conflicting_retries() {
        let root = env::temp_dir().join(format!("yingya-voice-jobs-{}", Uuid::new_v4()));
        let store = VoiceJobs::new(root.clone()).await.unwrap();
        let input = VoiceJob {
            id: Uuid::new_v4().to_string(),
            voice_id: "voice-server-assigned".into(),
            mode: "clone".into(),
            name: "测试音色".into(),
            description: "清晰".into(),
            ref_text: "你好".into(),
            reference_name: Some("sample.wav".into()),
            reference_mime: Some("audio/wav".into()),
            reference_hash: Some("checksum".into()),
            status: "running".into(),
            dismissed: false,
            created_at: 1,
            updated_at: 1,
            voice: None,
            error: None,
        };
        assert!(store.existing(&input).await.unwrap().is_none());
        store.write(&input).await.unwrap();
        assert!(store.existing(&input).await.unwrap().is_some());
        let mut changed = input.clone();
        changed.reference_hash = Some("different".into());
        assert!(matches!(
            store.existing(&changed).await,
            Err(ApiError::Conflict(_))
        ));
        assert!(matches!(
            store.dismiss(Some(&input.id)).await,
            Err(ApiError::Conflict(_))
        ));
        let mut done = input.clone();
        done.id = Uuid::new_v4().to_string();
        done.status = "completed".into();
        store.write(&done).await.unwrap();
        assert_eq!(store.dismiss(None).await.unwrap(), vec![done.id.clone()]);
        assert!(store.dismiss(None).await.unwrap().is_empty());
        assert!(matches!(
            store.existing(&done).await,
            Err(ApiError::Conflict(_))
        ));
        assert_eq!(store.list().await.unwrap().len(), 1);
        let recovered = VoiceJobs::new(root.clone()).await.unwrap();
        let saved = recovered.read(&input.id).await.unwrap();
        assert_eq!(saved.status, "failed");
        assert_eq!(saved.ref_text, "你好");
        assert!(saved.error.unwrap().contains("已中断"));
        assert!(recovered.read("../outside").await.is_err());
        let other = VoiceJobs::new(root.join("other")).await.unwrap();
        assert!(other.read(&input.id).await.is_err());
        assert!(recovered.read(&done.id).await.unwrap().dismissed);
        recovered.dismiss(Some(&input.id)).await.unwrap();
        recovered.dismiss(Some(&input.id)).await.unwrap();
        assert!(recovered.list().await.unwrap().is_empty());
        assert!(matches!(
            other.dismiss(Some(&input.id)).await,
            Err(ApiError::NotFound(_))
        ));
        let mut legacy = serde_json::to_value(&input).unwrap();
        legacy.as_object_mut().unwrap().remove("dismissed");
        assert!(
            !serde_json::from_value::<VoiceJob>(legacy)
                .unwrap()
                .dismissed
        );
        let link = root.join(format!("{}.json", Uuid::new_v4()));
        std::os::unix::fs::symlink("/etc/passwd", link).unwrap();
        assert!(recovered.list().await.is_err());
        fs::remove_dir_all(root).await.unwrap();
    }
}
