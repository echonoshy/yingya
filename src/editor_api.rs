use super::*;

async fn editor_command(
    state: &AppState,
    project_id: &str,
    action: &str,
    request: &Value,
) -> Result<Value, ApiError> {
    // Resolving the record first prevents implicitly creating a missing project.
    state
        .agent_projects
        .read_project(project_id)
        .await
        .map_err(ApiError::Project)?;
    let root = state
        .agent_projects
        .project_dir(project_id)
        .map_err(ApiError::Project)?;
    let input = serde_json::to_vec(request).map_err(|e| ApiError::Validation(e.to_string()))?;
    if input.len() > 3_000_000 {
        return Err(ApiError::Validation("请求内容过大".into()));
    }
    let mut child = state
        .sandbox
        .command("node")
        .arg(state.root.join("runtime/editor/cli.mjs"))
        .arg("--project")
        .arg(root)
        .args(["--action", action])
        .arg("--library")
        .arg(state.user_root.join("editor-library"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| ApiError::External(e.to_string()))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(&input)
            .await
            .map_err(|e| ApiError::External(e.to_string()))?;
    }
    let output = tokio::time::timeout(Duration::from_secs(120), child.wait_with_output())
        .await
        .map_err(|_| ApiError::External("工程保存超时，请刷新检查保存状态".into()))?
        .map_err(|e| ApiError::External(e.to_string()))?;
    let result: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| ApiError::External("工程服务返回了无效响应".into()))?;
    if !output.status.success() || result["ok"] != true {
        let message = result["error"].as_str().unwrap_or("工程操作失败");
        return Err(
            if message.contains("REVISION_CONFLICT") || message.contains("EDIT_BUSY") {
                ApiError::Conflict(message.into())
            } else {
                ApiError::Validation(message.into())
            },
        );
    }
    Ok(result)
}

async fn reject_busy(state: &AppState, id: &str) -> Result<(), ApiError> {
    if state.agent_jobs.contains(id).await
        || state.agent_jobs.active_render(id).await.is_some()
        || state
            .agent_projects
            .read_project(id)
            .await
            .map_err(ApiError::Project)?
            .active_turn_id
            .is_some()
        || state
            .render_jobs
            .list(id, 50)
            .await
            .map_err(ApiError::Project)?
            .iter()
            .any(RenderJob::is_active)
    {
        return Err(ApiError::Conflict(
            "当前制作或导出完成后可保存手动修改".into(),
        ));
    }
    Ok(())
}

pub(super) async fn get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    // Atomic state-file replacement makes readers independent of long-running task locks.
    Ok(Json(editor_command(&state, &id, "read", &json!({})).await?))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EditorRequest {
    action: String,
    request: Value,
}

pub(super) async fn mutate(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<EditorRequest>,
) -> Result<Json<Value>, ApiError> {
    if ![
        "init",
        "command",
        "checkpoint",
        "restore",
        "library-list",
        "brand-save",
        "brand-load",
        "library-delete",
        "template-save",
        "template-load",
    ]
    .contains(&input.action.as_str())
    {
        return Err(ApiError::Validation("未知工程操作".into()));
    }
    if input.action == "library-list" {
        return Ok(Json(
            editor_command(&state, &id, &input.action, &input.request).await?,
        ));
    }
    let _gate = state.agent_jobs.lock(&id).await;
    reject_busy(&state, &id).await?;
    if input.action.starts_with("library-")
        || input.action.starts_with("brand-")
        || input.action.starts_with("template-")
    {
        return Ok(Json(
            editor_command(&state, &id, &input.action, &input.request).await?,
        ));
    }
    let mut manifest = state
        .agent_projects
        .manifest(&id)
        .await
        .map_err(ApiError::Project)?;
    // Mark before mutation: crashes must never label an old render as current.
    manifest.dirty = true;
    state
        .agent_projects
        .write_manifest(&id, &manifest)
        .await
        .map_err(ApiError::Project)?;
    let result = editor_command(&state, &id, &input.action, &input.request).await?;
    let dimensions = if input.action == "checkpoint" {
        &result
    } else {
        &result["document"]
    };
    let aspect = dimensions["width"]
        .as_u64()
        .zip(dimensions["height"].as_u64())
        .map(|(w, h)| {
            if w == h {
                "1:1"
            } else if w > h {
                "16:9"
            } else {
                "9:16"
            }
        });
    if let Some(aspect) = aspect {
        manifest.output_spec["aspectRatio"] = json!(aspect);
        manifest.output_spec["width"] = dimensions["width"].clone();
        manifest.output_spec["height"] = dimensions["height"].clone();
        manifest.output_spec["fps"] = dimensions["fps"].clone();
    }
    if input.action == "checkpoint" {
        let version_id = result["versionId"]
            .as_str()
            .ok_or_else(|| ApiError::External("缺少版本标识".into()))?;
        let source = result["sourcePath"]
            .as_str()
            .ok_or_else(|| ApiError::External("缺少版本目录".into()))?;
        if !manifest.versions.iter().any(|v| v.id == version_id) {
            manifest.versions.push(agent_projects::DraftVersion {
                id: version_id.into(),
                label: format!("手动编辑 · 修订 {}", result["revision"]),
                source_path: source.into(),
                video_path: format!("{source}/preview.mp4"),
                report_path: None,
                created_at: result["createdAt"]
                    .as_u64()
                    .unwrap_or_else(agent_projects::now_millis),
            });
        }
        manifest.current_draft = Some(version_id.into());
        manifest.studio_entry = format!("{source}/index.html");
        manifest.phase = "draft_review".into();
        state
            .agent_projects
            .write_manifest(&id, &manifest)
            .await
            .map_err(ApiError::Project)?;
    }
    state
        .agent_projects
        .write_manifest(&id, &manifest)
        .await
        .map_err(ApiError::Project)?;
    state
        .agent_projects
        .update_project(&id, |record| {
            if let Some(aspect) = aspect {
                record.aspect_ratio = aspect.into();
            }
            record.status = "draft_review".into();
            record.status_label = "修改已保存，可继续编辑或导出".into();
        })
        .await
        .map_err(ApiError::Project)?;
    emit_agent_state_event(&state, &id, None, "project/updated").await;
    Ok(Json(result))
}
