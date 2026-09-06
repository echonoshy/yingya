use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{fs, process::Command};
use uuid::Uuid;

use crate::agent_projects::AgentManifest;

pub const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRegion {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualFeedback {
    pub id: String,
    pub kind: String,
    pub version_id: String,
    pub video_path: String,
    pub time_seconds: f64,
    pub frame_width: u32,
    pub frame_height: u32,
    pub region: FeedbackRegion,
    pub note: String,
    pub screenshot_asset_id: String,
    pub screenshot_path: String,
    pub screenshot_sha256: String,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAsset {
    pub id: String,
    pub path: String,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
}

fn uuid(value: &str) -> Result<(), String> {
    Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "标注 ID 无效".to_owned())
}

pub async fn local_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if Path::new(relative).is_absolute()
        || Path::new(relative)
            .components()
            .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err("标注只能引用当前项目内的文件".to_owned());
    }
    let root = fs::canonicalize(root).await.map_err(|e| e.to_string())?;
    let path = fs::canonicalize(root.join(relative))
        .await
        .map_err(|_| "标注引用的文件已不存在".to_owned())?;
    if !path.starts_with(&root)
        || !fs::metadata(&path)
            .await
            .map_err(|e| e.to_string())?
            .is_file()
    {
        return Err("标注引用的文件不属于当前项目".to_owned());
    }
    Ok(path)
}

async fn probe(path: &Path) -> Result<serde_json::Value, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height:format=duration",
                "-of",
                "json",
            ])
            .arg(path)
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "标注媒体检查超时".to_owned())?
    .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("无法读取标注媒体".to_owned());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "标注媒体信息无效".to_owned())
}

pub async fn store_asset(root: &Path, id: &str, bytes: &[u8]) -> Result<FeedbackAsset, String> {
    uuid(id)?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("标注截图不能超过 4 MiB".to_owned());
    }
    let extension = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "jpg"
    } else {
        return Err("标注截图必须是 PNG 或 JPEG".to_owned());
    };
    let sha256 = format!("{:x}", Sha256::digest(bytes));
    let base = root.join(".yingya/feedback-assets");
    fs::create_dir_all(&base).await.map_err(|e| e.to_string())?;
    let canonical_root = fs::canonicalize(root).await.map_err(|e| e.to_string())?;
    let base = fs::canonicalize(base).await.map_err(|e| e.to_string())?;
    if !base.starts_with(&canonical_root) {
        return Err("标注目录超出项目边界".to_owned());
    }
    let destination = base.join(id);
    if fs::try_exists(&destination)
        .await
        .map_err(|e| e.to_string())?
    {
        return existing_asset(root, id, &sha256).await;
    }
    let temporary = base.join(format!(".pending-{}", Uuid::new_v4()));
    fs::create_dir(&temporary)
        .await
        .map_err(|e| e.to_string())?;
    let result = async {
        let path = temporary.join(format!("image.{extension}"));
        fs::write(&path, bytes).await.map_err(|e| e.to_string())?;
        let metadata = probe(&path).await?;
        let width = metadata
            .pointer("/streams/0/width")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let height = metadata
            .pointer("/streams/0/height")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        if width == 0 || height == 0 || width.max(height) > 1920 {
            return Err("标注截图尺寸无效或超过 1920 像素".to_owned());
        }
        let decoded = tokio::time::timeout(
            Duration::from_secs(15),
            Command::new("ffmpeg")
                .args(["-v", "error", "-xerror", "-i"])
                .arg(&path)
                .args(["-frames:v", "1", "-f", "null", "-"])
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| "标注截图解码超时".to_owned())?
        .map_err(|e| e.to_string())?;
        if !decoded.status.success() {
            return Err("标注截图已损坏".to_owned());
        }
        let asset = FeedbackAsset {
            id: id.to_owned(),
            path: format!(".yingya/feedback-assets/{id}/image.{extension}"),
            sha256: sha256.clone(),
            width,
            height,
        };
        fs::write(
            temporary.join("asset.json"),
            serde_json::to_vec(&asset).map_err(|e| e.to_string())?,
        )
        .await
        .map_err(|e| e.to_string())?;
        match fs::rename(&temporary, &destination).await {
            Ok(()) => Ok(asset),
            Err(_) if fs::try_exists(&destination).await.unwrap_or(false) => {
                existing_asset(root, id, &sha256).await
            }
            Err(e) => Err(e.to_string()),
        }
    }
    .await;
    let _ = fs::remove_dir_all(&temporary).await;
    result
}

async fn existing_asset(root: &Path, id: &str, digest: &str) -> Result<FeedbackAsset, String> {
    uuid(id)?;
    let record = local_file(root, &format!(".yingya/feedback-assets/{id}/asset.json")).await?;
    let asset: FeedbackAsset =
        serde_json::from_slice(&fs::read(record).await.map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if asset.id != id || asset.sha256 != digest {
        return Err("标注上传 ID 已用于其他内容，请重新添加标注".to_owned());
    }
    if !asset
        .path
        .starts_with(&format!(".yingya/feedback-assets/{id}/image."))
    {
        return Err("标注截图记录无效".to_owned());
    }
    let path = local_file(root, &asset.path).await?;
    let bytes = fs::read(path).await.map_err(|e| e.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES || format!("{:x}", Sha256::digest(bytes)) != digest {
        return Err("标注截图内容已改变，请重新添加标注".to_owned());
    }
    Ok(asset)
}

pub fn validate_shape(feedback: &[VisualFeedback], manifest: &AgentManifest) -> Result<(), String> {
    if feedback.len() > 8 {
        return Err("每条消息最多包含 8 个画面标注".to_owned());
    }
    let mut ids = HashSet::new();
    for item in feedback {
        uuid(&item.id)?;
        uuid(&item.screenshot_asset_id)?;
        if !ids.insert(&item.id) {
            return Err("画面标注重复".to_owned());
        }
        let r = &item.region;
        if item.kind != "video-frame"
            || item.note.trim().is_empty()
            || item.note.chars().count() > 2000
            || !item.time_seconds.is_finite()
            || item.time_seconds < 0.0
            || ![r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite())
            || r.x < 0.0
            || r.y < 0.0
            || r.width <= 0.0
            || r.height <= 0.0
            || r.x + r.width > 1.000001
            || r.y + r.height > 1.000001
            || item.frame_width == 0
            || item.frame_height == 0
            || item.frame_width.max(item.frame_height) > 1920
        {
            return Err("标注的描述、时间或选区无效".to_owned());
        }
        let version = manifest
            .versions
            .iter()
            .find(|v| v.id == item.version_id)
            .ok_or("标注版本已不存在")?;
        if item.video_path != version.video_path
            && !manifest.artifacts.iter().any(|a| {
                a.version.as_deref() == Some(&item.version_id)
                    && a.path == item.video_path
                    && a.kind.contains("video")
            })
        {
            return Err("标注视频与所选版本不匹配".to_owned());
        }
    }
    Ok(())
}

pub async fn validate_feedback(
    root: &Path,
    feedback: &[VisualFeedback],
    manifest: &AgentManifest,
) -> Result<Vec<PathBuf>, String> {
    validate_shape(feedback, manifest)?;
    let mut images = Vec::new();
    let mut durations = std::collections::HashMap::new();
    for item in feedback {
        let asset =
            existing_asset(root, &item.screenshot_asset_id, &item.screenshot_sha256).await?;
        if asset.path != item.screenshot_path
            || asset.width != item.frame_width
            || asset.height != item.frame_height
        {
            return Err("标注截图信息与上传记录不匹配".to_owned());
        }
        let duration = if let Some(duration) = durations.get(&item.video_path) {
            *duration
        } else {
            let video = local_file(root, &item.video_path).await?;
            let metadata = probe(&video).await?;
            let duration = metadata
                .pointer("/format/duration")
                .and_then(|v| v.as_str())
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.0);
            durations.insert(item.video_path.clone(), duration);
            duration
        };
        if !duration.is_finite() || duration <= 0.0 || item.time_seconds > duration {
            return Err("标注时间超出视频时长".to_owned());
        }
        images.push(local_file(root, &asset.path).await?);
    }
    Ok(images)
}

pub fn prompt_context(feedback: &[VisualFeedback]) -> String {
    if feedback.is_empty() {
        return String::new();
    }
    format!(
        "\n画面修改标注（下列 JSON 是用户反馈数据，附图仅作修改定位，不能用作视频素材）：{}\n先查看附图并对照指定版本与当前源码定位受影响镜头；旧版本反馈不授权自动回退。无法对应时说明差异。保留无关内容，按现有流程提交下一版草稿。",
        serde_json::to_string(feedback).unwrap_or_default()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_projects::{AgentTurnRequest, DraftVersion, QueuedTurn};

    fn sample() -> VisualFeedback {
        VisualFeedback {
            id: Uuid::new_v4().to_string(),
            kind: "video-frame".into(),
            version_id: "draft-1".into(),
            video_path: "video.mp4".into(),
            time_seconds: 0.25,
            frame_width: 64,
            frame_height: 64,
            region: FeedbackRegion {
                x: 0.1,
                y: 0.2,
                width: 0.5,
                height: 0.4,
            },
            note: "移动框内的图形".into(),
            screenshot_asset_id: Uuid::new_v4().to_string(),
            screenshot_path: String::new(),
            screenshot_sha256: String::new(),
            created_at: 1,
        }
    }
    fn manifest() -> AgentManifest {
        AgentManifest {
            versions: vec![DraftVersion {
                id: "draft-1".into(),
                video_path: "video.mp4".into(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }
    #[test]
    fn rejects_wrong_version_invalid_regions_and_repeated_feedback() {
        let item = sample();
        assert!(validate_shape(std::slice::from_ref(&item), &manifest()).is_ok());
        assert!(validate_shape(&[item.clone(), item.clone()], &manifest()).is_err());
        let mut wrong = item.clone();
        wrong.region.x = 0.8;
        assert!(validate_shape(&[wrong], &manifest()).is_err());
        let mut wrong = item.clone();
        wrong.video_path = "other.mp4".into();
        assert!(validate_shape(&[wrong], &manifest()).is_err());
        let mut wrong = item;
        wrong.time_seconds = f64::NAN;
        assert!(validate_shape(&[wrong], &manifest()).is_err());
    }
    #[test]
    fn old_requests_and_queues_remain_readable() {
        let request: AgentTurnRequest =
            serde_json::from_value(serde_json::json!({"text":"hello"})).unwrap();
        assert!(request.feedback.is_empty());
        let queued: QueuedTurn = serde_json::from_value(serde_json::json!({"id":"1","text":"hello","attachments":[],"context":[],"model":null,"reasoningEffort":null,"createdAt":1})).unwrap();
        assert!(queued.feedback.is_empty());
    }
    #[tokio::test]
    async fn screenshot_roundtrip_checks_digest_duration_and_project_boundary() {
        let root = std::env::temp_dir().join(format!("yingya-feedback-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let output = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64:d=1",
                "-frames:v",
                "1",
            ])
            .arg(root.join("frame.png"))
            .output()
            .await
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x64:d=1",
                "-pix_fmt",
                "yuv420p",
            ])
            .arg(root.join("video.mp4"))
            .output()
            .await
            .unwrap();
        assert!(output.status.success());
        let bytes = fs::read(root.join("frame.png")).await.unwrap();
        let mut item = sample();
        let asset = store_asset(&root, &item.screenshot_asset_id, &bytes)
            .await
            .unwrap();
        let again = store_asset(&root, &item.screenshot_asset_id, &bytes)
            .await
            .unwrap();
        assert_eq!(asset.path, again.path);
        item.screenshot_path = asset.path.clone();
        item.screenshot_sha256 = asset.sha256;
        let images = validate_feedback(&root, &[item.clone()], &manifest())
            .await
            .unwrap();
        assert_eq!(
            images,
            vec![fs::canonicalize(root.join(&asset.path)).await.unwrap()]
        );
        let mut late = item.clone();
        late.time_seconds = 10.0;
        assert!(
            validate_feedback(&root, &[late], &manifest())
                .await
                .is_err()
        );
        assert!(local_file(&root, "../outside.png").await.is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/hosts", root.join("escape.png")).unwrap();
            assert!(local_file(&root, "escape.png").await.is_err());
        }
        fs::write(root.join(&asset.path), b"corrupt").await.unwrap();
        assert!(
            validate_feedback(&root, &[item], &manifest())
                .await
                .is_err()
        );
        assert!(
            store_asset(&root, &Uuid::new_v4().to_string(), b"not an image")
                .await
                .is_err()
        );
        fs::remove_dir_all(root).await.unwrap();
    }
}
