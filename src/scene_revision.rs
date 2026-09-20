//! Version-bound single-scene revisions. Context is persisted with the normal turn journal.
use crate::{agent_projects::AgentManifest, editorial};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

const PREFIX: &str = "YINGYA_SCENE_REVISION ";
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub scene_id: String,
    pub version_id: String,
    pub scenes_revision: String,
    pub kind: String,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replacement_path: Option<String>,
}

pub struct Guard {
    request: Request,
    scenes: Vec<Value>,
    assets: Vec<Value>,
    protected_files: BTreeMap<String, String>,
}

pub fn parse(context: &[String]) -> Result<Option<Request>, String> {
    let values: Vec<_> = context
        .iter()
        .filter_map(|s| s.strip_prefix(PREFIX))
        .collect();
    if values.len() > 1 {
        return Err("每条消息只能修改一个镜头，请分次提交".into());
    }
    values
        .first()
        .map(|v| serde_json::from_str(v).map_err(|_| "镜头修改信息无效，请重新选择镜头".into()))
        .transpose()
}

pub async fn prepare(
    root: &Path,
    manifest: &AgentManifest,
    base: Option<&str>,
    context: &[String],
    attachments: &[String],
) -> Result<Option<Guard>, String> {
    let Some(request) = parse(context)? else {
        return Ok(None);
    };
    if base != Some(request.version_id.as_str()) || manifest.current_draft.as_deref() != base {
        return Err("镜头对应的版本已经变化，请切到当前版本后重新选择".into());
    }
    if !["text", "image", "duration", "narration"].contains(&request.kind.as_str())
        || request.value.chars().count() > 5000
    {
        return Err("镜头修改类型或内容无效".into());
    }
    if request.kind == "duration"
        && !request
            .value
            .parse::<f64>()
            .is_ok_and(|v| v.is_finite() && (1.0..=3600.0).contains(&v))
    {
        return Err("单镜时长须在 1 至 3600 秒之间".into());
    }
    if ["text", "narration"].contains(&request.kind.as_str()) && request.value.trim().is_empty() {
        return Err("请填写新的文字或旁白".into());
    }
    if request.kind == "image" {
        let path = request
            .replacement_path
            .as_ref()
            .ok_or("请附加要替换的截图")?;
        if !attachments.contains(path) || !path.starts_with("assets/") {
            return Err("替换截图须来自本次上传的项目附件".into());
        }
        editorial::project_file(root, path).await?;
    }
    let data = editorial::scene_data(root, ".", "revision").await?;
    if data["scenesRevision"].as_str() != Some(request.scenes_revision.as_str()) {
        return Err("镜头内容已经变化，请刷新后重新选择要修改的镜头".into());
    }
    let scenes = data["scenes"].as_array().ok_or("镜头资料无效")?.clone();
    if !scenes.iter().any(|s| s["id"] == request.scene_id) {
        return Err("要修改的镜头已不存在".into());
    }
    let assets = data["assets"].as_array().cloned().unwrap_or_default();
    // Revisions create new media; existing versions keep their original files.
    let mut protected_files = BTreeMap::new();
    for asset in &assets {
        if let Some(path) = asset["hyperframesPath"].as_str() {
            protected_files.insert(path.into(), file_hash(root, path).await?);
        }
    }
    if let Some(path) = &request.replacement_path {
        protected_files.insert(path.clone(), file_hash(root, path).await?);
    }
    Ok(Some(Guard {
        request,
        scenes,
        assets,
        protected_files,
    }))
}
async fn file_hash(root: &Path, path: &str) -> Result<String, String> {
    let path = editorial::project_file(root, path).await?;
    let bytes = tokio::fs::read(path).await.map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
impl Guard {
    pub fn prompt(&self) -> String {
        format!(
            "\n这是受控单镜修改，范围：{}。按 references/product-video.md 的局部修改规则执行。服务会核对镜头结构与未授权素材变化；保留其他镜头的叙事、文字、设计、素材和音轨，只同步必要的时间偏移。完成后明确报告改动与复用内容。",
            serde_json::to_string(&self.request).unwrap_or_default()
        )
    }
    pub async fn audit(&self, root: &Path, manifest: &AgentManifest) -> Result<(), String> {
        // An unchanged draft cannot prove that the requested edit was delivered.
        if manifest.current_draft.as_deref() == Some(&self.request.version_id) {
            return Err("镜头修改尚未生成新草稿，请完成修改并预览后再提交".into());
        }
        let data = editorial::scene_data(root, ".", "revision").await?;
        let after = data["scenes"].as_array().ok_or("修改后镜头资料无效")?;
        check_scenes(&self.request, &self.scenes, after)?;
        self.check_assets(&data)?;
        // Also check the newly published source snapshot; checking only workspace is insufficient.
        let version = manifest
            .current_draft
            .as_deref()
            .ok_or("修改后缺少草稿版本")?;
        let source = editorial::version_source(root, manifest, version).await?;
        let snapshot = editorial::scene_data(root, &source, "revision").await?;
        check_scenes(
            &self.request,
            &self.scenes,
            snapshot["scenes"].as_array().ok_or("新草稿缺少镜头资料")?,
        )?;
        self.check_assets(&snapshot)?;
        for (path, hash) in &self.protected_files {
            if file_hash(root, path).await? != *hash
                || file_hash(root, &format!("{source}/{path}")).await? != *hash
            {
                return Err(format!("未授权的素材发生变化：{path}"));
            }
        }
        Ok(())
    }
    fn check_assets(&self, data: &Value) -> Result<(), String> {
        let before = self
            .scenes
            .iter()
            .find(|s| s["id"] == self.request.scene_id)
            .ok_or("原镜头不存在")?;
        let after = data["scenes"]
            .as_array()
            .and_then(|scenes| scenes.iter().find(|s| s["id"] == self.request.scene_id))
            .ok_or("修改后镜头不存在")?;
        let assets = data["assets"].as_array().ok_or("修改后素材索引无效")?;
        for old in &self.assets {
            let new = assets
                .iter()
                .find(|a| a["id"] == old["id"])
                .ok_or("原素材登记被删除")?;
            if old["hyperframesPath"] != new["hyperframesPath"]
                || old["mediaType"] != new["mediaType"]
            {
                return Err("原素材路径或类型被修改，请为替换素材登记新 ID".into());
            }
        }
        check_asset_references(&self.request, before, after, &self.assets, assets)
    }
}

fn check_asset_references(
    request: &Request,
    before: &Value,
    after: &Value,
    old_assets: &[Value],
    new_assets: &[Value],
) -> Result<(), String> {
    let replaceable_type = match request.kind.as_str() {
        "image" => "image/",
        "narration" => "audio/",
        _ => return Ok(()),
    };
    let ids = |scene: &Value| scene["assetIds"].as_array().cloned().unwrap_or_default();
    let old_ids = ids(before);
    let new_ids = ids(after);
    let retained: Vec<_> = old_ids
        .iter()
        .filter(|id| {
            !old_assets.iter().any(|a| {
                a["id"] == **id
                    && a["mediaType"]
                        .as_str()
                        .is_some_and(|t| t.starts_with(replaceable_type))
            })
        })
        .collect();
    let current: Vec<_> = new_ids
        .iter()
        .filter(|id| {
            !new_assets.iter().any(|a| {
                a["id"] == **id
                    && a["mediaType"]
                        .as_str()
                        .is_some_and(|t| t.starts_with(replaceable_type))
            })
        })
        .collect();
    if retained != current {
        return Err("镜头修改更换了范围外的素材引用".into());
    }
    for id in retained {
        let old = old_assets
            .iter()
            .find(|a| a["id"] == *id)
            .ok_or("原素材引用无效")?;
        let new = new_assets
            .iter()
            .find(|a| a["id"] == *id)
            .ok_or("原素材引用丢失")?;
        if old["hyperframesPath"] != new["hyperframesPath"] || old["mediaType"] != new["mediaType"]
        {
            return Err("未授权的素材引用发生变化".into());
        }
    }
    if request.kind == "image"
        && !new_assets.iter().any(|a| {
            new_ids.contains(&a["id"])
                && a["hyperframesPath"].as_str() == request.replacement_path.as_deref()
                && a["mediaType"]
                    .as_str()
                    .is_some_and(|t| t.starts_with("image/"))
        })
    {
        return Err("新镜头未使用本次上传的替换截图".into());
    }
    Ok(())
}

fn normalized(scene: &Value, request: &Request, selected: bool) -> Value {
    let mut scene = scene.clone();
    if let Some(object) = scene.as_object_mut() {
        object.remove("status");
        if ["duration", "narration"].contains(&request.kind.as_str()) {
            object.remove("startSeconds");
        }
        if selected {
            let allowed: &[&str] = match request.kind.as_str() {
                "text" => &["onScreenText", "title"],
                "image" => &["assetIds"],
                "duration" => &["durationSeconds", "timingBasis"],
                "narration" => &[
                    "narration",
                    "durationSeconds",
                    "timingBasis",
                    "assetIds",
                    "captions",
                ],
                _ => &[],
            };
            for key in allowed {
                object.remove(*key);
            }
        }
    }
    scene
}
fn check_scenes(request: &Request, before: &[Value], after: &[Value]) -> Result<(), String> {
    if before.len() != after.len() {
        return Err("单镜修改改变了镜头数量".into());
    }
    let selected_index = before
        .iter()
        .position(|s| s["id"] == request.scene_id)
        .ok_or("原镜头不存在")?;
    if ["duration", "narration"].contains(&request.kind.as_str()) {
        let old_duration = before[selected_index]["durationSeconds"]
            .as_f64()
            .ok_or("原镜头时长无效")?;
        let new_duration = after[selected_index]["durationSeconds"]
            .as_f64()
            .filter(|v| v.is_finite() && *v > 0.0)
            .ok_or("新镜头时长无效")?;
        let delta = new_duration - old_duration;
        for (index, (old, new)) in before.iter().zip(after).enumerate() {
            let expected = old["startSeconds"].as_f64().ok_or("原镜头开始时间无效")?
                + if index > selected_index { delta } else { 0.0 };
            if !new["startSeconds"]
                .as_f64()
                .is_some_and(|start| (start - expected).abs() < 0.05)
            {
                return Err("镜头开始时间超出了必要的顺延范围".into());
            }
        }
    }
    for (old, new) in before.iter().zip(after) {
        let selected = old["id"] == request.scene_id;
        if normalized(old, request, selected) != normalized(new, request, selected) {
            return Err(format!("镜头 {} 出现了修改范围外的变化", old["id"]));
        }
        if selected {
            let correct = match request.kind.as_str() {
                "text" => new["onScreenText"] == request.value || new["title"] == request.value,
                "narration" => new["narration"] == request.value,
                "duration" => new["durationSeconds"]
                    .as_f64()
                    .zip(request.value.parse::<f64>().ok())
                    .is_some_and(|(a, b)| (a - b).abs() < 0.05),
                "image" => new["assetIds"] != old["assetIds"],
                _ => false,
            };
            if !correct {
                return Err("新草稿的镜头资料未体现请求的修改".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn request(kind: &str, value: &str) -> Request {
        Request {
            scene_id: "s1".into(),
            version_id: "v1".into(),
            scenes_revision: "a".repeat(64),
            kind: kind.into(),
            value: value.into(),
            replacement_path: None,
        }
    }
    #[test]
    fn unrelated_content_is_protected_but_timing_can_shift() {
        let before = vec![
            json!({"id":"s1","durationSeconds":4,"onScreenText":"A","startSeconds":0}),
            json!({"id":"s2","durationSeconds":3,"onScreenText":"B","startSeconds":4}),
        ];
        let mut after = before.clone();
        after[0]["durationSeconds"] = json!(6);
        after[1]["startSeconds"] = json!(6);
        assert!(check_scenes(&request("duration", "6"), &before, &after).is_ok());
        after[1]["onScreenText"] = json!("changed");
        assert!(check_scenes(&request("duration", "6"), &before, &after).is_err());
    }
    #[test]
    fn visual_edits_preserve_narration_and_reject_noop() {
        let before =
            vec![json!({"id":"s1","onScreenText":"A","narration":"voice","durationSeconds":4})];
        assert!(check_scenes(&request("text", "B"), &before, &before).is_err());
        let mut after = before.clone();
        after[0]["onScreenText"] = json!("B");
        assert!(check_scenes(&request("text", "B"), &before, &after).is_ok());
        after[0]["narration"] = json!("new voice");
        assert!(check_scenes(&request("text", "B"), &before, &after).is_err());
    }
    #[test]
    fn multiple_scopes_are_rejected() {
        let value = format!(
            "{PREFIX}{}",
            serde_json::to_string(&request("text", "B")).unwrap()
        );
        assert!(parse(&[value.clone(), value]).is_err());
        assert!(parse(&["ordinary context".into()]).unwrap().is_none());
    }

    #[test]
    fn duration_changes_preserve_prior_starts_and_exact_downstream_offset() {
        let before = vec![
            json!({"id":"intro","durationSeconds":2,"startSeconds":0}),
            json!({"id":"s1","durationSeconds":4,"startSeconds":2}),
            json!({"id":"outro","durationSeconds":3,"startSeconds":6}),
        ];
        let mut after = before.clone();
        after[1]["durationSeconds"] = json!(6);
        after[2]["startSeconds"] = json!(8);
        assert!(check_scenes(&request("duration", "6"), &before, &after).is_ok());
        after[2]["startSeconds"] = json!(9);
        assert!(check_scenes(&request("duration", "6"), &before, &after).is_err());
        after[2]["startSeconds"] = json!(8);
        after[0]["startSeconds"] = json!(1);
        assert!(check_scenes(&request("duration", "6"), &before, &after).is_err());
    }

    #[test]
    fn image_replacement_must_use_the_attachment_and_preserve_audio() {
        let old = json!({"assetIds":["image","voice"]});
        let new = json!({"assetIds":["replacement","voice"]});
        let assets = vec![
            json!({"id":"image","mediaType":"image/png","hyperframesPath":"assets/old.png"}),
            json!({"id":"voice","mediaType":"audio/wav","hyperframesPath":"assets/voice.wav"}),
            json!({"id":"replacement","mediaType":"image/png","hyperframesPath":"assets/new.png"}),
        ];
        let mut req = request("image", "new.png");
        req.replacement_path = Some("assets/new.png".into());
        assert!(check_asset_references(&req, &old, &new, &assets, &assets).is_ok());
        req.replacement_path = Some("assets/different.png".into());
        assert!(check_asset_references(&req, &old, &new, &assets, &assets).is_err());
        req.replacement_path = Some("assets/new.png".into());
        assert!(
            check_asset_references(
                &req,
                &old,
                &json!({"assetIds":["replacement"]}),
                &assets,
                &assets
            )
            .is_err()
        );
        let mut redirected = assets.clone();
        redirected[1]["hyperframesPath"] = json!("assets/new-voice.wav");
        assert!(check_asset_references(&req, &old, &new, &assets, &redirected).is_err());
    }

    #[tokio::test]
    async fn audit_requires_new_snapshot_and_unchanged_original_media() {
        use crate::agent_projects::DraftVersion;
        let root = std::env::temp_dir().join(format!("yingya-revision-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(root.join("assets"))
            .await
            .unwrap();
        tokio::fs::write(root.join("assets/image.png"), b"original")
            .await
            .unwrap();
        let before = vec![json!({"id":"s1","onScreenText":"A","assetIds":["image"]})];
        let after = vec![json!({"id":"s1","onScreenText":"B","assetIds":["image"]})];
        let assets = vec![
            json!({"id":"image","mediaType":"image/png","hyperframesPath":"assets/image.png"}),
        ];
        let guard = Guard {
            request: request("text", "B"),
            scenes: before,
            assets: assets.clone(),
            protected_files: BTreeMap::from([(
                "assets/image.png".into(),
                file_hash(&root, "assets/image.png").await.unwrap(),
            )]),
        };
        let mut manifest = AgentManifest {
            current_draft: Some("v1".into()),
            ..Default::default()
        };
        assert!(guard.audit(&root, &manifest).await.is_err());
        let snapshot = root.join(".yingya/versions/v2");
        tokio::fs::create_dir_all(snapshot.join("assets"))
            .await
            .unwrap();
        for dir in [&root, &snapshot] {
            tokio::fs::write(dir.join("scenes.json"), serde_json::to_vec(&after).unwrap())
                .await
                .unwrap();
            tokio::fs::write(
                dir.join("assets.json"),
                serde_json::to_vec(&assets).unwrap(),
            )
            .await
            .unwrap();
            tokio::fs::write(dir.join("assets/image.png"), b"original")
                .await
                .unwrap();
        }
        manifest.current_draft = Some("v2".into());
        manifest.versions.push(DraftVersion {
            id: "v2".into(),
            source_path: ".yingya/versions/v2".into(),
            ..Default::default()
        });
        assert!(guard.audit(&root, &manifest).await.is_ok());
        tokio::fs::write(snapshot.join("assets/image.png"), b"changed")
            .await
            .unwrap();
        assert!(guard.audit(&root, &manifest).await.is_err());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}
