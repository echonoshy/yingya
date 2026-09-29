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
    result["recipeCatalog"] = json!({"schemaVersion":1,"recipes":[]});
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
                    .get("projectPath")
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
