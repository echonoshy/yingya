use super::*;
use crate::editorial;

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkbenchQuery {
    version_id: Option<String>,
}

pub(super) async fn workbench(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Query(query): Query<WorkbenchQuery>,
) -> Result<Json<Value>, ApiError> {
    let _gate = state.agent_jobs.lock(&project_id).await;
    let manifest = state
        .agent_projects
        .manifest(&project_id)
        .await
        .map_err(ApiError::Project)?;
    let root = state
        .agent_projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    let workspace = editorial::scene_data(&root, ".", &project_id)
        .await
        .map_err(ApiError::Project)?;
    let version_id = query.version_id.as_deref();
    let mut result = if let Some(version_id) = version_id {
        let source = editorial::version_source(&root, &manifest, version_id)
            .await
            .map_err(ApiError::Validation)?;
        editorial::scene_data(&root, &source, &project_id)
            .await
            .map_err(ApiError::Project)?
    } else {
        workspace.clone()
    };
    let can_edit = manifest.current_draft.is_some()
        && (version_id.is_none() || manifest.current_draft.as_deref() == version_id)
        && workspace["scenesRevision"].is_string()
        && workspace["sourceBindings"].is_object();
    result["versionId"] = json!(query.version_id);
    result["currentVersionId"] = json!(manifest.current_draft);
    result["workspace"] = workspace;
    result["requirements"] = manifest
        .output_spec
        .get("requirements")
        .cloned()
        .unwrap_or_else(|| json!(editorial::Requirements::default()));
    result["assetRoles"] = json!(
        editorial::asset_roles(&root)
            .await
            .map_err(ApiError::Project)?
    );
    result["recipeCatalog"] =
        editorial::read_json(state.root.as_ref(), "runtime/editorial/catalog.json")
            .await
            .map_err(ApiError::Project)?
            .unwrap_or_else(|| json!({"schemaVersion":1,"recipes":[]}));
    result["editable"] = json!(can_edit);
    result["dirty"] = json!(manifest.dirty);
    result["editReason"] = if can_edit {
        Value::Null
    } else {
        json!(if manifest.current_draft.is_none() {
            "完成首版制作后可直接修改镜头"
        } else if version_id.is_some() && manifest.current_draft.as_deref() != version_id {
            "此为历史版本，请切换到当前版本或先回退后修改"
        } else {
            "当前工程未接入可直接修改的镜头，请通过对话调整"
        })
    };
    match editorial::content_index(&root).await {
        Ok(index) => {
            if index.is_some() {
                result["contentIndexValidation"] =
                    json!({"sourceHashesVerified":false,"semanticClaimsVerified":false});
                result["warnings"] = json!([
                    "内容证据来自已有观察记录；本次读取未重新核验来源指纹，修改过原素材时请重新分析"
                ]);
            }
            result["contentIndex"] = json!(index);
        }
        Err(error) => {
            result["contentIndex"] = Value::Null;
            result["warnings"] = json!([error]);
        }
    }
    Ok(Json(result))
}

async fn is_busy(state: &AppState, project_id: &str) -> Result<bool, ApiError> {
    Ok(state.agent_jobs.contains(project_id).await
        || state.agent_jobs.active_render(project_id).await.is_some()
        || state
            .agent_projects
            .read_project(project_id)
            .await
            .map_err(ApiError::Project)?
            .active_turn_id
            .is_some()
        || state
            .render_jobs
            .list(project_id, 50)
            .await
            .map_err(ApiError::Project)?
            .iter()
            .any(RenderJob::is_active))
}

async fn reject_busy(state: &AppState, project_id: &str) -> Result<(), ApiError> {
    if is_busy(state, project_id).await? {
        return Err(ApiError::Conflict(
            "当前制作或导出完成后才能修改镜头和素材用途".into(),
        ));
    }
    Ok(())
}

pub(super) async fn set_asset_role(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(role): Json<editorial::AssetRole>,
) -> Result<Json<Value>, ApiError> {
    let _gate = state.agent_jobs.lock(&project_id).await;
    let root = state
        .agent_projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    editorial::validate_asset_role(&root, &role)
        .await
        .map_err(ApiError::Validation)?;
    let mut roles = editorial::asset_roles(&root)
        .await
        .map_err(ApiError::Project)?;
    if roles
        .iter()
        .any(|existing| existing.path == role.path && existing.role == role.role)
    {
        return Ok(Json(json!({"assetRoles":roles})));
    }
    if is_busy(&state, &project_id).await? {
        let detail = state
            .agent_projects
            .get(&project_id)
            .await
            .map_err(ApiError::Project)?;
        let scenes = editorial::read_json(&root, "scenes.json")
            .await
            .map_err(ApiError::Project)?
            .unwrap_or(Value::Null);
        let bindings = editorial::read_json(&root, "source-bindings.json")
            .await
            .map_err(ApiError::Project)?
            .unwrap_or(Value::Null);
        let assets = editorial::read_json(&root, "assets.json")
            .await
            .map_err(ApiError::Project)?
            .unwrap_or_else(|| json!([]));
        let used = assets.as_array().is_some_and(|assets| {
            assets.iter().any(|asset| {
                asset
                    .get("hyperframesPath")
                    .or_else(|| asset.get("path"))
                    .and_then(Value::as_str)
                    == Some(role.path.as_str())
                    && asset["id"]
                        .as_str()
                        .is_some_and(|id| references(&scenes, id))
            })
        });
        if roles.iter().any(|existing| existing.path == role.path)
            || detail
                .messages
                .iter()
                .any(|message| message.attachments.contains(&role.path))
            || references(&scenes, &role.path)
            || references(&bindings, &role.path)
            || used
        {
            return Err(ApiError::Conflict(
                "当前任务完成后才能更改已使用素材的用途；新上传素材仍可加入排队消息".into(),
            ));
        }
    }
    roles.retain(|item| item.path != role.path);
    roles.push(role);
    roles.sort_by(|a, b| a.path.cmp(&b.path));
    atomic_write_bytes(
        &root.join(".yingya/asset-roles.json"),
        &serde_json::to_vec_pretty(&json!({"schemaVersion":1,"assets":roles}))
            .map_err(|e| ApiError::Project(e.to_string()))?,
    )
    .await
    .map_err(ApiError::Project)?;
    emit_agent_state_event(&state, &project_id, None, "project/updated").await;
    Ok(Json(json!({"assetRoles":roles})))
}

fn references(value: &Value, target: &str) -> bool {
    match value {
        Value::String(value) => value == target,
        Value::Array(values) => values.iter().any(|value| references(value, target)),
        Value::Object(values) => values.values().any(|value| references(value, target)),
        _ => false,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct EditSceneRequest {
    base_version_id: String,
    expected_scenes_revision: String,
    patch: ScenePatch,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct ScenePatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    recipe: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    focus: Option<Value>,
}

pub(super) async fn edit_scene(
    State(state): State<AppState>,
    Path((project_id, scene_id)): Path<(String, String)>,
    Json(request): Json<EditSceneRequest>,
) -> Result<Json<Value>, ApiError> {
    let _gate = state.agent_jobs.lock(&project_id).await;
    reject_busy(&state, &project_id).await?;
    let mut manifest = state
        .agent_projects
        .manifest(&project_id)
        .await
        .map_err(ApiError::Project)?;
    editorial::validate_base_version(Some(&request.base_version_id), &manifest)
        .map_err(ApiError::Conflict)?;
    if request.expected_scenes_revision.len() != 64
        || !request
            .expected_scenes_revision
            .bytes()
            .all(|b| b.is_ascii_hexdigit())
    {
        return Err(ApiError::Validation(
            "缺少有效镜头修订号，请刷新后再修改".into(),
        ));
    }
    if request.patch.recipe.is_none()
        && request.patch.title.is_none()
        && request.patch.focus.is_none()
    {
        return Err(ApiError::Validation("没有镜头修改内容".into()));
    }
    let root = state
        .agent_projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    let patch =
        serde_json::to_string(&request.patch).map_err(|e| ApiError::Validation(e.to_string()))?;
    let original = manifest.clone();
    manifest.dirty = true;
    // Persist dirtiness before mutation so a worker crash cannot label changed
    // source as matching the previously rendered MP4.
    state
        .agent_projects
        .write_manifest(&project_id, &manifest)
        .await
        .map_err(ApiError::Project)?;
    let result = tokio::time::timeout(
        Duration::from_secs(180),
        state
            .sandbox
            .command("node")
            .arg(state.root.join("runtime/editorial/edit-scene.mjs"))
            .arg("--project")
            .arg(&root)
            .args([
                "--scene-id",
                &scene_id,
                "--expected-revision",
                &request.expected_scenes_revision,
                "--patch-json",
                &patch,
            ])
            .current_dir(&root)
            .kill_on_drop(true)
            .output(),
    )
    .await;
    let output = match result {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Err(ApiError::External(format!(
                "镜头修改未完成，请检查当前工作区：{error}"
            )));
        }
        Err(_) => {
            return Err(ApiError::External(
                "镜头修改超时，工作区保留待检查状态".into(),
            ));
        }
    };
    let mut value = scene_command_report(&output.stdout, &output.stderr);
    if !output.status.success() || value["ok"] != true {
        // Known refusal codes happen before mutation, or after a completed
        // transaction rollback. Unknown process failure keeps dirty=true.
        if matches!(
            value["code"].as_str(),
            Some(
                "REVISION_CONFLICT"
                    | "MANUAL_EDIT_CONFLICT"
                    | "INVALID_PATCH"
                    | "SCENE_NOT_FOUND"
                    | "EDIT_BUSY"
            )
        ) {
            state
                .agent_projects
                .write_manifest(&project_id, &original)
                .await
                .map_err(ApiError::Project)?;
        }
        return Err(ApiError::Conflict(
            value["error"]
                .as_str()
                .unwrap_or("镜头修改未完成，请检查工作区")
                .into(),
        ));
    }
    if value["changedSceneIds"]
        .as_array()
        .is_some_and(Vec::is_empty)
    {
        state
            .agent_projects
            .write_manifest(&project_id, &original)
            .await
            .map_err(ApiError::Project)?;
        value["dirty"] = json!(original.dirty);
        return Ok(Json(value));
    }
    value["dirty"] = json!(true);
    state
        .agent_projects
        .update_project(&project_id, |record| {
            record.status = "draft_review".into();
            record.status_label = "镜头已修改，待生成新版预览".into();
        })
        .await
        .map_err(ApiError::Project)?;
    emit_agent_state_event(&state, &project_id, None, "project/updated").await;
    Ok(Json(value))
}

fn scene_command_report(stdout: &[u8], stderr: &[u8]) -> Value {
    serde_json::from_slice::<Value>(stdout)
        .or_else(|_| serde_json::from_slice::<Value>(stderr))
        .unwrap_or_else(
            |_| json!({"ok":false,"error":truncate_status(&String::from_utf8_lossy(stderr),320)}),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editorial_patch_rejects_source_and_timing_changes() {
        for field in ["sourceIn", "sourceOut", "audioMode", "source", "assetIds"] {
            let value = json!({"baseVersionId":"v1","expectedScenesRevision":"a".repeat(64),"patch":{field:"unexpected"}});
            assert!(serde_json::from_value::<EditSceneRequest>(value).is_err());
        }
        assert!(serde_json::from_value::<EditSceneRequest>(json!({"baseVersionId":"v1","expectedScenesRevision":"a".repeat(64),"patch":{"title":"新标题","recipe":"screen-overview"}})).is_ok());
    }

    #[test]
    fn editorial_cli_refusal_on_stderr_keeps_machine_readable_reason() {
        let report = scene_command_report(
            b"",
            br#"{"ok":false,"code":"REVISION_CONFLICT","error":"refresh"}"#,
        );
        assert_eq!(report["code"], "REVISION_CONFLICT");
        assert_eq!(report["error"], "refresh");
        assert_eq!(scene_command_report(b"unexpected", b"failed")["ok"], false);
    }

    #[test]
    fn editorial_asset_use_checks_nested_scene_ids_and_source_paths() {
        let scenes =
            json!([{"assetIds":["asset-1"],"sourceClip":{"source":"assets/recording.mp4"}}]);
        assert!(references(&scenes, "asset-1"));
        assert!(references(&scenes, "assets/recording.mp4"));
        assert!(!references(&scenes, "assets/new.mp4"));
    }
}
