//! Optional Runway adapter. Only an explicitly submitted generation starts a paid job.
//! Protocol: official runwayml/sdk-node text-to-video, image-to-video and tasks resources.
use super::*;
use base64::Engine;
const PROVIDER: &str = "https://api.dev.runwayml.com/v1";

fn secret() -> Option<String> {
    env::var("YINGYA_RUNWAY_API_SECRET")
        .ok()
        .filter(|value| !value.trim().is_empty())
}
fn http() -> Result<reqwest::Client, ApiError> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ApiError::External("无法初始化视频服务".into()))
}
fn authorized(
    client: &reqwest::Client,
    method: reqwest::Method,
    path: &str,
) -> Result<reqwest::RequestBuilder, ApiError> {
    let key = secret().ok_or_else(|| {
        ApiError::Validation("视频生成服务尚未连接，可先导入已有片段或制作动画".into())
    })?;
    Ok(client
        .request(method, format!("{PROVIDER}/{path}"))
        .bearer_auth(key)
        .header("X-Runway-Version", "2024-11-06"))
}
async fn provider_json(
    response: Result<reqwest::Response, reqwest::Error>,
) -> Result<Value, ApiError> {
    let response = response
        .map_err(|_| ApiError::External("视频服务连接异常；任务状态保留，请稍后查询".into()))?;
    if !response.status().is_success() {
        return Err(ApiError::External(format!(
            "视频服务暂不可用（HTTP {}），请检查额度或稍后重试",
            response.status().as_u16()
        )));
    }
    response
        .json()
        .await
        .map_err(|_| ApiError::External("视频服务返回了无效响应".into()))
}
pub(super) async fn capabilities() -> Json<Value> {
    Json(
        json!({"provider":"runway","available":secret().is_some(),"model":"gen4.5","durations":[2,3,4,5,6,7,8,9,10],"ratios":["16:9","9:16"],"imageToVideo":true,"reason":if secret().is_some(){"视频生成服务已连接"}else{"视频生成服务尚未连接，可导入已有片段"}}),
    )
}
#[derive(Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CreateFootage {
    request_id: String,
    prompt: String,
    duration: u8,
    aspect_ratio: String,
    #[serde(default)]
    image_path: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct FootageJob {
    id: String,
    input: CreateFootage,
    provider_id: Option<String>,
    status: String,
    progress: f64,
    created_at: u64,
    checked_at: u64,
    asset_path: Option<String>,
    error: Option<String>,
    #[serde(default)]
    estimated_credits: Option<f64>,
}
fn validate(input: &CreateFootage) -> Result<(), ApiError> {
    if Uuid::parse_str(&input.request_id).is_err()
        || input.prompt.trim().is_empty()
        || input.prompt.encode_utf16().count() > 1000
        || !(2..=10).contains(&input.duration)
        || !["16:9", "9:16"].contains(&input.aspect_ratio.as_str())
    {
        return Err(ApiError::Validation(
            "请选择横屏或竖屏、2–10 秒，并输入不超过 1000 字符的描述".into(),
        ));
    }
    Ok(())
}
async fn jobs(state: &AppState, id: &str) -> Result<(PathBuf, Vec<FootageJob>), ApiError> {
    state
        .agent_projects
        .read_project(id)
        .await
        .map_err(ApiError::Project)?;
    let root = state
        .agent_projects
        .project_dir(id)
        .map_err(ApiError::Project)?;
    let filename = root.join(".yingya/footage-jobs.json");
    agent_projects::reject_symlink_components(&filename).map_err(ApiError::Project)?;
    let records = match fs::read(&filename).await {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|_| ApiError::Project("视频任务记录损坏".into()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => vec![],
        Err(e) => return Err(e.into()),
    };
    Ok((filename, records))
}
async fn save(filename: &FilePath, records: &[FootageJob]) -> Result<(), ApiError> {
    atomic_write_bytes(
        filename,
        &serde_json::to_vec_pretty(records).map_err(|e| ApiError::Project(e.to_string()))?,
    )
    .await
    .map_err(ApiError::Project)
}
pub(super) async fn create(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<CreateFootage>,
) -> Result<Json<Value>, ApiError> {
    validate(&input)?;
    let _gate = state.agent_jobs.lock(&id).await;
    let (file, mut records) = jobs(&state, &id).await?;
    if let Some(job) = records
        .iter()
        .find(|job| job.input.request_id == input.request_id)
    {
        if job.input != input {
            return Err(ApiError::Conflict("同一请求标识不能生成不同内容".into()));
        }
        return Ok(Json(json!(job)));
    }
    if records
        .iter()
        .filter(|j| {
            matches!(
                j.status.as_str(),
                "submitting" | "PENDING" | "RUNNING" | "THROTTLED"
            )
        })
        .count()
        >= 3
    {
        return Err(ApiError::Conflict(
            "当前项目已有 3 个视频任务，请等待完成后继续".into(),
        ));
    }
    let client = http()?;
    let mut body = json!({"model":"gen4.5","promptText":input.prompt.trim(),"duration":input.duration,"ratio":if input.aspect_ratio=="9:16"{"720:1280"}else{"1280:720"}});
    if let Some(relative) = &input.image_path {
        let root = state
            .agent_projects
            .project_dir(&id)
            .map_err(ApiError::Project)?;
        let source = crate::editorial::project_file(&root, relative)
            .await
            .map_err(ApiError::Validation)?;
        let mime = content_type_for_path(&source);
        if !["image/png", "image/jpeg", "image/webp"].contains(&mime)
            || fs::metadata(&source).await?.len() > 3_500_000
        {
            return Err(ApiError::Validation(
                "参考图需为小于 3.5 MB 的 PNG、JPEG 或 WebP".into(),
            ));
        }
        body["promptImage"] = json!(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(fs::read(source).await?)
        ));
    }
    let request = authorized(
        &client,
        reqwest::Method::POST,
        if input.image_path.is_some() {
            "image_to_video"
        } else {
            "text_to_video"
        },
    )?
    .json(&body);
    let mut job = FootageJob {
        id: Uuid::new_v4().to_string(),
        input,
        provider_id: None,
        status: "submitting".into(),
        progress: 0.0,
        created_at: agent_projects::now_millis(),
        checked_at: 0,
        asset_path: None,
        error: None,
        estimated_credits: None,
    };
    records.push(job.clone());
    save(&file, &records).await?;
    // Persist intent before POST. Ambiguous transport failure must not silently submit twice.
    match provider_json(request.send().await).await {
        Ok(result) => {
            job.provider_id = result["id"]
                .as_str()
                .filter(|id| Uuid::parse_str(id).is_ok())
                .map(str::to_owned);
            job.estimated_credits = result["estimatedCost"]["credits"].as_f64();
            job.status = if job.provider_id.is_some() {
                "PENDING"
            } else {
                "unknown"
            }
            .into();
        }
        Err(error) => {
            job.status = "unknown".into();
            job.error = Some(format!(
                "{error}；请在服务端核对任务后再创建新任务，避免重复计费"
            ));
        }
    }
    if let Some(last) = records.last_mut() {
        *last = job.clone();
    }
    save(&file, &records).await?;
    Ok(Json(json!(job)))
}
async fn import_output(
    state: &AppState,
    project_id: &str,
    job: &FootageJob,
    url: &str,
) -> Result<String, ApiError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| ApiError::External("生成结果地址无效".into()))?;
    let host = parsed.host_str().unwrap_or_default();
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !([".cloudfront.net", ".runwayml.com"]
            .iter()
            .any(|suffix| host.ends_with(suffix)))
    {
        return Err(ApiError::External(
            "视频服务返回了尚未支持的素材地址，请联系管理员".into(),
        ));
    }
    let provider_id = job
        .provider_id
        .as_deref()
        .ok_or_else(|| ApiError::External("视频任务标识缺失".into()))?;
    if let Some(existing) = state
        .agent_projects
        .media(project_id)
        .await
        .map_err(ApiError::Project)?
        .assets
        .into_iter()
        .find(|a| a.provider_id.as_deref() == Some(provider_id))
    {
        return Ok(existing.hyperframes_path);
    }
    let mut response = http()?
        .get(parsed)
        .send()
        .await
        .map_err(|_| ApiError::External("视频下载暂时失败，可再次查询重试".into()))?;
    if !response.status().is_success() {
        return Err(ApiError::External("视频下载暂时不可用".into()));
    }
    let relative = format!("assets/generated-video/{}.mp4", job.id);
    let destination = state
        .agent_projects
        .resolve_relative(project_id, &relative)
        .map_err(ApiError::Project)?;
    agent_projects::reject_symlink_components(&destination).map_err(ApiError::Project)?;
    fs::create_dir_all(destination.parent().expect("asset parent")).await?;
    let temporary = destination.with_extension("partial");
    agent_projects::reject_symlink_components(&temporary).map_err(ApiError::Project)?;
    let mut file = fs::File::create(&temporary).await?;
    let mut size = 0usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| ApiError::External("视频下载中断，稍后可重试".into()))?
    {
        size += chunk.len();
        if size > 512 * 1024 * 1024 {
            return Err(ApiError::External("生成视频超过 512 MB 限制".into()));
        }
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);
    let probe = tokio::time::timeout(
        Duration::from_secs(15),
        state
            .sandbox
            .command("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_type",
                "-of",
                "json",
            ])
            .arg(&temporary)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| ApiError::External("读取生成视频超时".into()))?
    .map_err(|_| ApiError::External("无法读取生成视频".into()))?;
    let measured = serde_json::from_slice::<Value>(&probe.stdout)
        .ok()
        .filter(|v| {
            probe.status.success()
                && v["streams"].as_array().is_some_and(|streams| {
                    streams.iter().any(|stream| stream["codec_type"] == "video")
                })
        })
        .and_then(|v| {
            v["format"]["duration"]
                .as_str()
                .and_then(|s| s.parse::<f32>().ok())
        })
        .filter(|n| n.is_finite() && *n > 0.0)
        .ok_or_else(|| ApiError::External("生成视频格式无效".into()))?;
    fs::rename(temporary, &destination).await?;
    state
        .agent_projects
        .append_media_asset(
            project_id,
            MediaAsset {
                id: job.id.clone(),
                name: truncate_status(&job.input.prompt, 60),
                url: format!("/api/agent-projects/{project_id}/files/{relative}"),
                hyperframes_path: relative.clone(),
                kind: "video".into(),
                source: "runway".into(),
                media_type: Some("video/mp4".into()),
                duration_seconds: Some(measured),
                provider_id: Some(provider_id.into()),
                description: Some(job.input.prompt.clone()),
                created_at: agent_projects::now_millis(),
            },
        )
        .await
        .map_err(ApiError::Project)?;
    Ok(relative)
}
pub(super) async fn list(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let _gate = state.agent_jobs.lock(&id).await;
    let (file, mut records) = jobs(&state, &id).await?;
    let now = agent_projects::now_millis();
    for job in &mut records {
        if job.status == "submitting" {
            job.status = "unknown".into();
            job.error = Some(
                "上次提交被中断，无法确认供应商是否已接收；请先核对供应商任务，避免重复计费".into(),
            );
        }
        if job.asset_path.is_some()
            || !matches!(
                job.status.as_str(),
                "PENDING" | "RUNNING" | "THROTTLED" | "SUCCEEDED"
            )
            || now.saturating_sub(job.checked_at) < 5000
        {
            continue;
        }
        let Some(provider_id) = &job.provider_id else {
            continue;
        };
        job.checked_at = now;
        let result = provider_json(
            authorized(
                &http()?,
                reqwest::Method::GET,
                &format!("tasks/{provider_id}"),
            )?
            .send()
            .await,
        )
        .await;
        match result {
            Ok(result) => {
                job.status = result["status"].as_str().unwrap_or("unknown").into();
                job.progress = result["progress"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0);
                job.error = if job.status == "FAILED" {
                    Some("视频生成未完成，请调整描述后重新生成".into())
                } else {
                    None
                };
                if job.status == "SUCCEEDED" {
                    if let Some(url) = result["output"][0].as_str() {
                        match import_output(&state, &id, job, url).await {
                            Ok(relative) => {
                                job.asset_path = Some(relative);
                                job.progress = 1.0;
                            }
                            Err(error) => job.error = Some(error.to_string()),
                        }
                    }
                }
            }
            Err(error) => job.error = Some(error.to_string()),
        }
    }
    save(&file, &records).await?;
    Ok(Json(json!({"jobs":records})))
}
pub(super) async fn cancel(
    State(state): State<AppState>,
    Path((id, job_id)): Path<(String, String)>,
) -> Result<Json<Value>, ApiError> {
    let _gate = state.agent_jobs.lock(&id).await;
    let (file, mut records) = jobs(&state, &id).await?;
    let job = records
        .iter_mut()
        .find(|j| j.id == job_id)
        .ok_or_else(|| ApiError::NotFound("视频任务不存在".into()))?;
    if !matches!(job.status.as_str(), "PENDING" | "RUNNING" | "THROTTLED") {
        return Err(ApiError::Conflict("此任务当前不能取消".into()));
    }
    let provider_id = job
        .provider_id
        .as_deref()
        .ok_or_else(|| ApiError::Conflict("任务状态尚不明确".into()))?;
    let response = authorized(
        &http()?,
        reqwest::Method::DELETE,
        &format!("tasks/{provider_id}"),
    )?
    .send()
    .await
    .map_err(|_| ApiError::External("取消请求未确认，请重新查询".into()))?;
    if !response.status().is_success() {
        return Err(ApiError::External("视频服务未确认取消，请重新查询".into()));
    }
    job.status = "CANCELLED".into();
    job.error = None;
    save(&file, &records).await?;
    Ok(Json(json!({"cancelled":true})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_generation_contract() {
        let input = CreateFootage {
            request_id: Uuid::new_v4().to_string(),
            prompt: "镜头描述".into(),
            duration: 5,
            aspect_ratio: "16:9".into(),
            image_path: None,
        };
        assert!(validate(&input).is_ok());
        let mut bad = input.clone();
        bad.duration = 11;
        assert!(validate(&bad).is_err());
        bad = input.clone();
        bad.aspect_ratio = "1:1".into();
        assert!(validate(&bad).is_err());
        bad = input;
        bad.request_id = "../outside".into();
        assert!(validate(&bad).is_err());
    }
}
