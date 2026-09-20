//! Project-owned editing contracts and read-only, version-bound workbench data.
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::fs;

use crate::agent_projects::{AgentManifest, reject_symlink_components};

fn auto() -> String {
    "auto".into()
}
fn target() -> String {
    "target".into()
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationChoice {
    pub capability_id: String,
    pub variant: String,
}

impl PresentationChoice {
    pub fn validate(&self) -> Result<(), String> {
        let variants: &[&str] = match self.capability_id.as_str() {
            "model-stage" => &["turntable", "orbit", "still"],
            "flow-path" => &["three-steps", "four-steps", "five-steps"],
            "infographic" => &["structure", "hierarchy", "comparison"],
            "title-reveal" => &["opening", "chapter", "closing"],
            "number-compare" => &["before-after", "metrics", "change"],
            "beam-network" => &["converge", "branch", "system"],
            _ => return Err("不支持的表现方式，请重新选择".into()),
        };
        if !variants.contains(&self.variant.as_str()) {
            return Err("表现方式与呈现选项不匹配，请重新选择".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Requirements {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creation_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aspect_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_example: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<PresentationChoice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_duration_seconds: Option<f64>,
    #[serde(default = "target")]
    pub duration_mode: String,
    #[serde(default)]
    pub audience: String,
    #[serde(default)]
    pub style_notes: String,
    #[serde(default = "auto")]
    pub subtitles: String,
    #[serde(default = "auto")]
    pub music: String,
    #[serde(default = "auto")]
    pub audio_mode: String,
}

impl Default for Requirements {
    fn default() -> Self {
        Self {
            creation_mode: None,
            style_id: None,
            review_mode: None,
            aspect_mode: None,
            workflow: None,
            reference_example: None,
            presentation: None,
            target_duration_seconds: None,
            duration_mode: target(),
            audience: String::new(),
            style_notes: String::new(),
            subtitles: auto(),
            music: auto(),
            audio_mode: auto(),
        }
    }
}

impl Requirements {
    pub fn validate(&self) -> Result<(), String> {
        for (value, allowed) in [
            (
                &self.creation_mode,
                &["motion", "single", "edit", "ai-video"][..],
            ),
            (
                &self.style_id,
                &[
                    "minimal-product",
                    "editorial",
                    "kinetic-type",
                    "data-story",
                    "field-notes",
                    "map-story",
                ][..],
            ),
            (&self.review_mode, &["auto", "review"][..]),
            (&self.aspect_mode, &["auto", "fixed"][..]),
        ] {
            if value
                .as_ref()
                .is_some_and(|value| !allowed.contains(&value.as_str()))
            {
                return Err("不支持的制作方式或风格设置".into());
            }
        }
        for value in [&self.workflow, &self.reference_example]
            .into_iter()
            .flatten()
        {
            if ![
                "product-intro",
                "feature-launch",
                "walkthrough",
                "knowledge-explainer",
            ]
            .contains(&value.as_str())
            {
                return Err("不支持的视频用途或样片，请重新选择".into());
            }
        }
        if self.reference_example.is_some() && self.reference_example != self.workflow {
            return Err("样片与视频用途不匹配，请重新选择".into());
        }
        if let Some(choice) = &self.presentation {
            choice.validate()?;
        }
        if self
            .target_duration_seconds
            .is_some_and(|n| !n.is_finite() || !(1.0..=3600.0).contains(&n))
        {
            return Err("目标时长须在 1 至 3600 秒之间".into());
        }
        if !["target", "exact", "max"].contains(&self.duration_mode.as_str())
            || !["auto", "zh", "zh-en", "none"].contains(&self.subtitles.as_str())
            || !["auto", "on", "off"].contains(&self.music.as_str())
            || !["auto", "preserve", "narration", "replace", "mute"]
                .contains(&self.audio_mode.as_str())
        {
            return Err("创作要求包含不支持的选项".into());
        }
        if self.audience.chars().count() > 300 || self.style_notes.chars().count() > 500 {
            return Err("受众或风格补充过长".into());
        }
        if self.duration_mode != "target" && self.target_duration_seconds.is_none() {
            return Err("请先选择目标时长，再设置精确时长或时长上限".into());
        }
        if self.audio_mode == "mute" && self.music == "on" {
            return Err("静音视频不能同时要求添加配乐，请调整音频处理或配乐要求".into());
        }
        Ok(())
    }
}

pub fn validate_base_version(base: Option<&str>, manifest: &AgentManifest) -> Result<(), String> {
    if let Some(base) = base
        && manifest.current_draft.as_deref() != Some(base)
    {
        return Err(
            "正在查看的版本不是当前编辑版本；请切换到当前版本，或先回退该版本后再修改".into(),
        );
    }
    Ok(())
}

pub fn relative_path(value: &str) -> Result<&Path, String> {
    let path = Path::new(value);
    if value.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("路径必须指向项目内的文件".into());
    }
    Ok(path)
}

pub async fn project_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let path = root.join(relative_path(relative)?);
    reject_symlink_components(&path)?;
    let canonical_root = fs::canonicalize(root).await.map_err(|e| e.to_string())?;
    let canonical = fs::canonicalize(&path)
        .await
        .map_err(|_| "项目文件不存在".to_owned())?;
    if !canonical.starts_with(canonical_root)
        || !fs::metadata(&canonical)
            .await
            .map_err(|e| e.to_string())?
            .is_file()
    {
        return Err("路径必须指向项目内的真实文件".into());
    }
    Ok(canonical)
}

pub async fn read_json(root: &Path, relative: &str) -> Result<Option<Value>, String> {
    Ok(read_json_revision(root, relative)
        .await?
        .map(|(value, _)| value))
}

async fn read_json_revision(
    root: &Path,
    relative: &str,
) -> Result<Option<(Value, String)>, String> {
    let path = root.join(relative_path(relative)?);
    reject_symlink_components(&path)?;
    match fs::metadata(&path).await {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
        Ok(meta) if !meta.is_file() || meta.len() > 8 * 1024 * 1024 => {
            return Err("项目索引文件无效或过大".into());
        }
        Ok(_) => {}
    }
    let bytes = fs::read(path).await.map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes)
        .map(|value| Some((value, format!("{:x}", Sha256::digest(&bytes)))))
        .map_err(|_| format!("项目索引格式无效：{relative}"))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AssetRole {
    pub path: String,
    pub role: String,
}

pub async fn validate_asset_role(root: &Path, role: &AssetRole) -> Result<(), String> {
    if ![
        "auto",
        "source",
        "required",
        "supplement",
        "brand",
        "reference",
    ]
    .contains(&role.role.as_str())
    {
        return Err("不支持的素材用途".into());
    }
    let path = relative_path(&role.path)?;
    if !path.starts_with("assets") {
        return Err("只能设置项目 assets 目录内真实素材的用途".into());
    }
    project_file(root, &role.path).await?;
    Ok(())
}

pub async fn asset_roles(root: &Path) -> Result<Vec<AssetRole>, String> {
    let value = read_json(root, ".yingya/asset-roles.json").await?;
    let roles = value
        .and_then(|v| v.get("assets").cloned())
        .unwrap_or_else(|| json!([]));
    serde_json::from_value(roles).map_err(|_| "素材用途记录无效".into())
}

pub async fn scene_data(root: &Path, source_path: &str, project_id: &str) -> Result<Value, String> {
    let prefix = if source_path == "." {
        String::new()
    } else {
        format!("{}/", source_path.trim_end_matches('/'))
    };
    let bindings = read_json(root, &format!("{prefix}source-bindings.json")).await?;
    let scenes_path = format!("{prefix}scenes.json");
    let scenes = read_json_revision(root, &scenes_path).await?;
    let (scenes, revision) = if let Some((value, revision)) = scenes {
        (value, Some(revision))
    } else {
        // Immutable assembled versions retain an evidence snapshot, not always
        // the editable root file. It is safe to display, never to edit in place.
        (
            read_json(
                root,
                &format!("{prefix}assets/editorial/scenes.snapshot.json"),
            )
            .await?
            .unwrap_or_else(|| json!([])),
            None,
        )
    };
    if !scenes.is_array() {
        return Err("场景索引必须为数组".into());
    }
    let mut assets = read_json(root, &format!("{prefix}assets.json"))
        .await?
        .unwrap_or_else(|| json!([]));
    let array = assets
        .as_array_mut()
        .ok_or_else(|| "素材索引必须为数组".to_owned())?;
    for asset in array {
        if let Some(path) = asset
            .get("hyperframesPath")
            .or_else(|| asset.get("path"))
            .and_then(Value::as_str)
            .map(str::to_owned)
        {
            relative_path(&path)?;
            asset["hyperframesPath"] = json!(path);
            asset["url"] = json!(format!(
                "/api/agent-projects/{project_id}/files/{prefix}{path}"
            ));
            if asset.get("name").is_none() {
                asset["name"] = json!(
                    Path::new(&path)
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("素材")
                );
            }
            if asset.get("source").is_none() {
                asset["source"] = json!("project");
            }
            if asset.get("createdAt").is_none() {
                asset["createdAt"] = json!(0);
            }
        }
    }
    Ok(
        json!({"sourcePath":source_path,"scenes":scenes,"scenesRevision":revision,"sourceBindings":bindings,"assets":assets}),
    )
}

pub async fn version_source(
    root: &Path,
    manifest: &AgentManifest,
    version_id: &str,
) -> Result<String, String> {
    let version = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| "视频版本不存在".to_owned())?;
    let relative = relative_path(&version.source_path)?;
    let path = root.join(relative);
    reject_symlink_components(&path)?;
    let path = fs::canonicalize(path)
        .await
        .map_err(|_| "版本源码不存在".to_owned())?;
    let canonical_root = fs::canonicalize(root).await.map_err(|e| e.to_string())?;
    if !path.starts_with(&canonical_root) {
        return Err("版本源码越出项目目录".into());
    }
    let path = if path.is_file() {
        path.parent().ok_or("版本源码目录无效")?.to_path_buf()
    } else {
        path
    };
    let relative = path
        .strip_prefix(canonical_root)
        .map_err(|e| e.to_string())?;
    Ok(if relative.as_os_str().is_empty() {
        ".".into()
    } else {
        relative.to_string_lossy().into()
    })
}

pub async fn content_index(root: &Path) -> Result<Option<Value>, String> {
    let Some(index) = read_json(root, ".yingya/content-index.json").await? else {
        return Ok(None);
    };
    if index["schemaVersion"] != 1 {
        return Err("内容索引版本无效".into());
    }
    let sources = index["sources"].as_array().ok_or("内容索引缺少来源")?;
    if sources.len() > 100 {
        return Err("内容索引来源过多".into());
    }
    for source in sources {
        project_file(root, source["path"].as_str().ok_or("内容索引来源无效")?).await?;
        let hash = source["sha256"].as_str().ok_or("内容索引缺少来源指纹")?;
        if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("内容索引指纹无效".into());
        }
        let observations = source["observations"]
            .as_array()
            .ok_or("内容索引缺少观察记录")?;
        if observations.len() > 1000 {
            return Err("内容索引观察记录过多".into());
        }
        for observation in observations {
            let start = observation["startSeconds"].as_f64().ok_or("观察时间无效")?;
            let end = observation["endSeconds"].as_f64().ok_or("观察时间无效")?;
            if !start.is_finite()
                || !end.is_finite()
                || start < 0.0
                || end < start
                || end > 86400.0
                || !matches!(
                    observation["confidence"].as_str(),
                    Some("confirmed" | "uncertain")
                )
            {
                return Err("观察时间或确认状态无效".into());
            }
            for frame in observation["evidenceFrames"]
                .as_array()
                .ok_or("观察缺少证据帧")?
            {
                project_file(root, frame.as_str().ok_or("证据帧路径无效")?).await?;
            }
        }
    }
    Ok(Some(index))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_projects::DraftVersion;

    async fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("yingya-editorial-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("assets")).await.unwrap();
        fs::create_dir_all(root.join(".yingya")).await.unwrap();
        root
    }

    #[test]
    fn presentation_requires_a_known_capability_and_matching_variant() {
        for (id, variant) in [
            ("model-stage", "orbit"),
            ("flow-path", "four-steps"),
            ("infographic", "hierarchy"),
            ("title-reveal", "chapter"),
            ("number-compare", "metrics"),
            ("beam-network", "branch"),
        ] {
            let requirements: Requirements = serde_json::from_value(
                json!({"presentation": {"capabilityId": id, "variant": variant}}),
            )
            .unwrap();
            assert!(requirements.validate().is_ok());
        }
        for (id, variant) in [
            ("unknown", "orbit"),
            ("model-stage", "branch"),
            ("infographic", ""),
        ] {
            let requirements: Requirements = serde_json::from_value(
                json!({"presentation": {"capabilityId": id, "variant": variant}}),
            )
            .unwrap();
            assert!(requirements.validate().is_err());
        }
        let legacy: Requirements = serde_json::from_value(json!({})).unwrap();
        assert!(legacy.validate().is_ok());
        assert!(legacy.presentation.is_none());
        assert!(
            serde_json::to_value(legacy)
                .unwrap()
                .get("presentation")
                .is_none()
        );
    }

    #[test]
    fn product_workflow_suggestions_do_not_replace_explicit_requirements() {
        let value = json!({"workflow":"feature-launch","referenceExample":"feature-launch","targetDurationSeconds":60,"durationMode":"max","audioMode":"preserve","subtitles":"none"});
        let requirements: Requirements = serde_json::from_value(value).unwrap();
        assert!(requirements.validate().is_ok());
        assert_eq!(requirements.target_duration_seconds, Some(60.0));
        assert_eq!(requirements.audio_mode, "preserve");
        assert_eq!(requirements.subtitles, "none");
        for invalid in [
            json!({"workflow":"unknown"}),
            json!({"referenceExample":"product-intro"}),
            json!({"workflow":"walkthrough","referenceExample":"product-intro"}),
        ] {
            let requirements: Requirements = serde_json::from_value(invalid).unwrap();
            assert!(requirements.validate().is_err());
        }
    }

    #[test]
    fn requirements_reject_invalid_modes_and_duration_without_losing_auto_defaults() {
        let defaults: Requirements = serde_json::from_value(json!({})).unwrap();
        defaults.validate().unwrap();
        assert_eq!(defaults.audio_mode, "auto");
        assert_eq!(defaults.duration_mode, "target");
        for value in [
            json!({"targetDurationSeconds":0}),
            json!({"targetDurationSeconds":3601}),
            json!({"audioMode":"generate-anything"}),
            json!({"subtitles":"yes"}),
            json!({"music":"loud"}),
            json!({"durationMode":"stretch"}),
            json!({"durationMode":"exact"}),
            json!({"durationMode":"max"}),
            json!({"audioMode":"mute","music":"on"}),
        ] {
            assert!(
                serde_json::from_value::<Requirements>(value)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }
        assert!(serde_json::from_value::<Requirements>(json!({"duration":30})).is_err());
    }

    #[test]
    fn editorial_base_version_never_silently_retargets_old_drafts() {
        let mut manifest = AgentManifest::default();
        assert!(validate_base_version(None, &manifest).is_ok());
        assert!(validate_base_version(Some("old"), &manifest).is_err());
        manifest.current_draft = Some("current".into());
        assert!(validate_base_version(Some("current"), &manifest).is_ok());
        assert!(validate_base_version(Some("old"), &manifest).is_err());
    }

    #[tokio::test]
    async fn editorial_asset_roles_require_real_project_assets() {
        let root = fixture().await;
        fs::write(root.join("assets/source.mp4"), "fixture")
            .await
            .unwrap();
        for role in [
            "auto",
            "source",
            "required",
            "supplement",
            "brand",
            "reference",
        ] {
            validate_asset_role(
                &root,
                &AssetRole {
                    path: "assets/source.mp4".into(),
                    role: role.into(),
                },
            )
            .await
            .unwrap();
        }
        for path in [
            "../outside.mp4",
            "/tmp/outside.mp4",
            "assets/missing.mp4",
            "assets",
            ".yingya/project.json",
        ] {
            assert!(
                validate_asset_role(
                    &root,
                    &AssetRole {
                        path: path.into(),
                        role: "source".into()
                    }
                )
                .await
                .is_err()
            );
        }
        assert!(
            validate_asset_role(
                &root,
                &AssetRole {
                    path: "assets/source.mp4".into(),
                    role: "generate".into()
                }
            )
            .await
            .is_err()
        );
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                root.join("assets/source.mp4"),
                root.join("assets/link.mp4"),
            )
            .unwrap();
            assert!(
                validate_asset_role(
                    &root,
                    &AssetRole {
                        path: "assets/link.mp4".into(),
                        role: "source".into()
                    }
                )
                .await
                .is_err()
            );
        }
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn editorial_version_scenes_do_not_fall_back_to_current_workspace() {
        let root = fixture().await;
        let version = root.join(".yingya/versions/v1");
        fs::create_dir_all(version.join("assets/editorial"))
            .await
            .unwrap();
        fs::write(root.join("scenes.json"), r#"[{"id":"new","order":1}]"#)
            .await
            .unwrap();
        fs::write(
            version.join("assets/editorial/scenes.snapshot.json"),
            r#"[{"id":"old","order":1}]"#,
        )
        .await
        .unwrap();
        fs::write(
            root.join("assets.json"),
            r#"[{"id":"current-only","path":"assets/source.mp4","kind":"video"}]"#,
        )
        .await
        .unwrap();
        let mut manifest = AgentManifest::default();
        manifest.versions.push(DraftVersion {
            id: "v1".into(),
            source_path: ".yingya/versions/v1".into(),
            ..Default::default()
        });
        let source = version_source(&root, &manifest, "v1").await.unwrap();
        let old = scene_data(&root, &source, "project").await.unwrap();
        let current = scene_data(&root, ".", "project").await.unwrap();
        assert_eq!(old["scenes"][0]["id"], "old");
        assert_eq!(old["assets"], json!([]));
        assert!(old["scenesRevision"].is_null());
        assert_eq!(current["scenes"][0]["id"], "new");
        assert_eq!(current["scenesRevision"].as_str().unwrap().len(), 64);
        assert_eq!(
            current["assets"][0]["url"],
            "/api/agent-projects/project/files/assets/source.mp4"
        );
        assert!(version_source(&root, &manifest, "missing").await.is_err());
        fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn editorial_content_evidence_requires_bounded_times_and_local_files() {
        let root = fixture().await;
        fs::write(root.join("assets/source.mp4"), "fixture")
            .await
            .unwrap();
        fs::write(root.join("assets/frame.jpg"), "fixture")
            .await
            .unwrap();
        let mut value = json!({"schemaVersion":1,"sources":[{"path":"assets/source.mp4","sha256":"a".repeat(64),"observations":[{"id":"action-1","startSeconds":0,"endSeconds":2,"summary":"search","result":"results","confidence":"confirmed","evidenceFrames":["assets/frame.jpg"]}]}]});
        fs::write(
            root.join(".yingya/content-index.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .await
        .unwrap();
        assert!(content_index(&root).await.unwrap().is_some());
        value["sources"][0]["observations"][0]["endSeconds"] = json!(-1);
        fs::write(
            root.join(".yingya/content-index.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .await
        .unwrap();
        assert!(content_index(&root).await.is_err());
        value["sources"][0]["observations"][0]["endSeconds"] = json!(2);
        value["sources"][0]["observations"][0]["evidenceFrames"] = json!(["../outside.jpg"]);
        fs::write(
            root.join(".yingya/content-index.json"),
            serde_json::to_vec(&value).unwrap(),
        )
        .await
        .unwrap();
        assert!(content_index(&root).await.is_err());
        fs::remove_dir_all(root).await.unwrap();
    }
}
