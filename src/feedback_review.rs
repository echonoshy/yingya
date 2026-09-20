//! Version-bound feedback outcomes. A model claim alone is never a completed edit.
use crate::{agent_projects::AgentProjectDetail, feedback::local_file};
use serde_json::{Value, json};
use std::path::Path;
use tokio::fs;

async fn read_json(root: &Path, path: &str) -> Option<Value> {
    let file = local_file(root, path).await.ok()?;
    serde_json::from_slice(&fs::read(file).await.ok()?).ok()
}

// Historical snapshots name either their bundle directory or its HTML entry.
async fn version_scenes(root: &Path, source: &str) -> Option<Value> {
    if let Some(value) = read_json(root, &format!("{source}/scenes.json")).await {
        return Some(value);
    }
    let entry = local_file(root, source).await.ok()?;
    let canonical_root = fs::canonicalize(root).await.ok()?;
    let parent = entry.parent()?.strip_prefix(&canonical_root).ok()?;
    read_json(root, &parent.join("scenes.json").to_string_lossy()).await
}

pub fn intervals(scenes: &Value) -> Vec<(String, f64, f64)> {
    let Some(items) = scenes.as_array().or_else(|| scenes["scenes"].as_array()) else {
        return vec![];
    };
    let mut cursor = 0.0;
    items
        .iter()
        .filter_map(|scene| {
            let id = scene["id"].as_str()?;
            let start = scene["startSeconds"].as_f64().unwrap_or(cursor);
            let duration = scene["durationSeconds"]
                .as_f64()
                .or_else(|| scene["duration"].as_f64())?;
            if !start.is_finite() || start < 0.0 || !duration.is_finite() || duration <= 0.0 {
                return None;
            }
            cursor = start + duration;
            Some((id.to_string(), start, cursor))
        })
        .collect()
}

pub async fn outcomes(root: &Path, detail: &AgentProjectDetail) -> Value {
    let claims = read_json(root, ".yingya/feedback-results.json")
        .await
        .unwrap_or(json!([]));
    let claims = claims.as_array().cloned().unwrap_or_default();
    let mut results = vec![];
    let mut seen = std::collections::HashSet::new();
    for message in detail.messages.iter().rev() {
        for feedback in &message.feedback {
            if !seen.insert(feedback.id.clone()) {
                continue;
            }
            let pending = detail
                .queue
                .iter()
                .any(|q| Some(&q.id) == message.turn_id.as_ref());
            let running = detail
                .project
                .active_turn_id
                .as_ref()
                .is_some_and(|id| Some(id) == message.turn_id.as_ref());
            let mut item = json!({"feedbackId":feedback.id,"sourceVersionId":feedback.version_id,"note":feedback.note,"status":if running {"running"} else if pending {"queued"} else {"incomplete"},"summary":if running {"正在处理"} else if pending {"等待处理"} else {"尚无可核查的修改结果"}});
            if let Some(claim) = claims.iter().rev().find(|c| c["feedbackId"] == feedback.id) {
                if let Some(summary) = claim["summary"].as_str() {
                    item["summary"] = json!(summary);
                }
                if let Some(target) = detail.manifest.versions.iter().find(|v| {
                    Some(v.id.as_str()) == claim["resultVersionId"].as_str()
                        && v.id != feedback.version_id
                }) {
                    let source = detail
                        .manifest
                        .versions
                        .iter()
                        .find(|v| v.id == feedback.version_id);
                    let video_exists = local_file(root, &target.video_path).await.is_ok();
                    let evidence = claim["evidencePath"].as_str();
                    let evidence_exists = if let Some(path) = evidence {
                        local_file(root, path).await.is_ok()
                    } else {
                        false
                    };
                    let mut report_valid = if let Some(path) = &target.report_path {
                        read_json(root, path).await.is_some_and(|r| r["ok"] == true)
                    } else {
                        false
                    };
                    // reportPath historically also names a human-readable review.
                    // Its separately registered quality check must belong to this version.
                    if !report_valid {
                        for artifact in &detail.manifest.artifacts {
                            if artifact.version.as_deref() == Some(&target.id)
                                && matches!(
                                    artifact.kind.as_str(),
                                    "check-report" | "quality-report" | "hyperframes-check"
                                )
                                && read_json(root, &artifact.path)
                                    .await
                                    .is_some_and(|r| r["ok"] == true)
                            {
                                report_valid = true;
                                break;
                            }
                        }
                    }
                    let audit = if let Some(turn) = &message.turn_id {
                        read_json(root, &format!(".yingya/feedback-audits/{turn}.json")).await
                    } else {
                        None
                    };
                    let audited = if let Some(audit) = audit {
                        if audit["versionId"] == target.id && audit["protectedScenesPassed"] == true
                        {
                            if let Ok(path) = local_file(root, &target.video_path).await {
                                digest(&path)
                                    .await
                                    .ok()
                                    .is_some_and(|hash| audit["videoSha256"] == hash)
                            } else {
                                false
                            }
                        } else {
                            false
                        }
                    } else {
                        false
                    };
                    if video_exists
                        && evidence_exists
                        && report_valid
                        && audited
                        && claim["status"] == "completed"
                    {
                        // Resolve by scene identity and scene-local offset, never by the old global timestamp.
                        if let Some(source) = source {
                            let from = version_scenes(root, &source.source_path).await;
                            let to = version_scenes(root, &target.source_path).await;
                            if let (Some(from), Some(to)) = (from, to) {
                                let old = intervals(&from);
                                let new = intervals(&to);
                                if let Some((id, start, end)) =
                                    old.iter().find(|(_, start, end)| {
                                        feedback.time_seconds >= *start
                                            && (feedback.time_seconds < *end
                                                || old.last().is_some_and(|last| {
                                                    (last.2 - feedback.time_seconds).abs()
                                                        < 0.000001
                                                        && last.2 == *end
                                                }))
                                    })
                                {
                                    if let Some((_, new_start, new_end)) =
                                        new.iter().find(|(new_id, _, _)| new_id == id)
                                    {
                                        let relative =
                                            (feedback.time_seconds - start) / (end - start);
                                        item["targetTimeSeconds"] = json!(
                                            (new_start + relative * (new_end - new_start))
                                                .min((new_end - 0.001).max(*new_start))
                                        );
                                        item["sceneId"] = json!(id);
                                    }
                                }
                            }
                        }
                        item["status"] = json!("completed");
                        item["resultVersionId"] = json!(target.id);
                        item["videoPath"] = json!(target.video_path);
                        item["evidencePath"] = json!(evidence);
                    }
                }
            }
            if item["status"] == "incomplete" {
                if let Some(turn) = &message.turn_id {
                    if let Some(audit) =
                        read_json(root, &format!(".yingya/feedback-audits/{turn}.json")).await
                    {
                        if let Some(reason) = audit["reason"].as_str() {
                            item["summary"] = json!(reason);
                        }
                    }
                }
            }
            results.push(item);
        }
    }
    results.reverse();
    json!({"items": results})
}

pub struct Guard {
    base: String,
    protected: Vec<Value>,
    targets: std::collections::HashSet<String>,
    baseline: Vec<Value>,
    original_files: Vec<(String, String)>,
}
fn scene_items(value: &Value) -> Vec<Value> {
    value
        .as_array()
        .or_else(|| value["scenes"].as_array())
        .cloned()
        .unwrap_or_default()
}
fn semantic(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.remove("startSeconds");
        object.remove("start");
    }
    value
}
async fn digest(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    Ok(format!(
        "{:x}",
        Sha256::digest(fs::read(path).await.map_err(|e| e.to_string())?)
    ))
}
impl Guard {
    pub async fn prepare(
        root: &Path,
        manifest: &crate::agent_projects::AgentManifest,
        feedback: &[crate::feedback::VisualFeedback],
    ) -> Result<Option<Self>, String> {
        if feedback.is_empty() {
            return Ok(None);
        }
        let current = manifest
            .versions
            .iter()
            .find(|v| Some(&v.id) == manifest.current_draft.as_ref())
            .ok_or("缺少当前修改版本")?;
        let baseline = scene_items(
            &version_scenes(root, &current.source_path)
                .await
                .ok_or("旧作品缺少内容定位信息，请说明需要修改的段落后继续")?,
        );
        let mut targets = std::collections::HashSet::new();
        for item in feedback {
            let source = manifest
                .versions
                .iter()
                .find(|v| v.id == item.version_id)
                .ok_or("反馈版本不存在")?;
            let scenes = version_scenes(root, &source.source_path)
                .await
                .ok_or("原视频缺少段落定位信息，请重新定位")?;
            let intervals = intervals(&scenes);
            let unique: std::collections::HashSet<_> =
                intervals.iter().map(|(id, _, _)| id).collect();
            if unique.len() != intervals.len() {
                return Err("段落身份不唯一，请重新定位反馈".into());
            }
            let end = item.end_seconds.unwrap_or(item.time_seconds + 0.0001);
            let matching: Vec<_> = intervals
                .iter()
                .filter(|(_, start, stop)| {
                    (*stop > item.time_seconds
                        || intervals.last().is_some_and(|last| {
                            last.2 == *stop && (*stop - item.time_seconds).abs() < 0.000001
                        }))
                        && *start < end
                })
                .collect();
            if matching.is_empty() {
                return Err("无法可靠定位这条反馈，请说明对应内容".into());
            }
            for (id, _, _) in matching {
                if !baseline.iter().any(|s| s["id"] == *id) {
                    return Err("新版中原段落已被替换，请重新定位反馈".into());
                }
                targets.insert(id.clone());
            }
        }
        let protected: Vec<Value> = baseline
            .iter()
            .filter(|s| !targets.contains(s["id"].as_str().unwrap_or("")))
            .cloned()
            .map(semantic)
            .collect();
        let mut original_files = vec![];
        // Protect source media too; identical scene metadata must not hide an overwritten file.
        if let Some(assets) = read_json(root, "assets.json").await {
            if let Some(assets) = assets.as_array() {
                for asset in assets {
                    if let Some(path) = asset["hyperframesPath"].as_str() {
                        if let Ok(file) = local_file(root, path).await {
                            original_files.push((path.to_string(), digest(&file).await?));
                        }
                    }
                }
            }
        }
        for version in &manifest.versions {
            if let Ok(path) = local_file(root, &version.video_path).await {
                original_files.push((version.video_path.clone(), digest(&path).await?));
            }
        }
        Ok(Some(Self {
            base: current.id.clone(),
            protected,
            targets,
            baseline,
            original_files,
        }))
    }
    pub fn prompt(&self) -> String {
        format!(
            "\n本轮定位反馈已映射到当前版本 {} 的段落 {:?}。保留其他段落的文字、素材、旁白与设计，仅同步必要的时间偏移。沿用稳定段落 ID。按 references/knowledge-video.md 写逐条反馈结果和可核查证据。",
            self.base, self.targets
        )
    }
    pub async fn audit(
        &self,
        root: &Path,
        manifest: &crate::agent_projects::AgentManifest,
        turn_id: &str,
    ) -> Result<(), String> {
        let version = manifest
            .versions
            .iter()
            .find(|v| Some(&v.id) == manifest.current_draft.as_ref() && v.id != self.base)
            .ok_or("尚未生成新的视频版本")?;
        let new = scene_items(
            &version_scenes(root, &version.source_path)
                .await
                .ok_or("新版本缺少段落记录")?,
        );
        if self.baseline.iter().map(|s| &s["id"]).collect::<Vec<_>>()
            != new.iter().map(|s| &s["id"]).collect::<Vec<_>>()
        {
            return Err("局部修改意外改变了段落身份或顺序".into());
        }
        for old in &self.protected {
            if !new
                .iter()
                .any(|s| s["id"] == old["id"] && semantic(s.clone()) == *old)
            {
                return Err(format!("未请求修改的段落 {} 发生变化", old["id"]));
            }
        }
        for (path, hash) in &self.original_files {
            if digest(&local_file(root, path).await?).await? != *hash {
                return Err("历史视频或素材被覆盖，不能完成本轮反馈".into());
            }
        }
        let video_path = local_file(root, &version.video_path).await?;
        let metadata = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            tokio::process::Command::new("ffprobe")
                .args([
                    "-v",
                    "error",
                    "-show_entries",
                    "stream=codec_type,codec_name:format=duration",
                    "-of",
                    "json",
                ])
                .arg(&video_path)
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| "新视频校验超时")?
        .map_err(|e| e.to_string())?;
        let media: Value =
            serde_json::from_slice(&metadata.stdout).map_err(|_| "新视频无法解码")?;
        let streams = media["streams"].as_array().ok_or("新视频没有有效轨道")?;
        if !metadata.status.success()
            || !streams
                .iter()
                .any(|s| s["codec_type"] == "video" && s["codec_name"] == "h264")
            || media["format"]["duration"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
                .is_none_or(|n| n <= 0.0 || !n.is_finite())
        {
            return Err("新视频缺少有效 H.264 画面".into());
        }
        if matches!(
            manifest
                .output_spec
                .pointer("/requirements/audioMode")
                .and_then(Value::as_str),
            Some("narration" | "replace")
        ) && !streams
            .iter()
            .any(|s| s["codec_type"] == "audio" && s["codec_name"] == "aac")
        {
            return Err("新视频缺少方案要求的讲解音轨".into());
        }
        let video_hash = digest(&video_path).await?;
        if self
            .original_files
            .iter()
            .any(|(path, hash)| path.ends_with(".mp4") && hash == &video_hash)
        {
            return Err("新视频与旧视频完全相同，修改尚未落实".into());
        }
        let unchanged = self
            .baseline
            .iter()
            .map(|s| semantic(s.clone()))
            .collect::<Vec<_>>()
            == new.iter().map(|s| semantic(s.clone())).collect::<Vec<_>>();
        // Layout-only edits can keep scene metadata; visual review remains required.
        let evidence = json!({"versionId":version.id,"videoSha256":video_hash,"protectedScenesPassed":true,"sceneMetadataChanged":!unchanged});
        let dir = root.join(".yingya/feedback-audits");
        fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
        let destination = dir.join(format!("{turn_id}.json"));
        let temp = dir.join(format!("{turn_id}.tmp"));
        fs::write(
            &temp,
            serde_json::to_vec_pretty(&evidence).map_err(|e| e.to_string())?,
        )
        .await
        .map_err(|e| e.to_string())?;
        fs::rename(temp, destination)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shifted_scenes_keep_identity_and_new_ranges() {
        assert_eq!(
            intervals(&json!([{"id":"a","durationSeconds":4},{"id":"b","durationSeconds":6}])),
            vec![("a".into(), 0.0, 4.0), ("b".into(), 4.0, 10.0)]
        );
        assert!(intervals(&json!([{"id":"bad","durationSeconds":-1}])).is_empty());
    }
}

#[cfg(test)]
mod audit_tests {
    use super::*;
    use crate::agent_projects::AgentManifest;
    #[tokio::test]
    async fn local_edit_protects_other_scenes_and_historical_media() {
        let root =
            std::env::temp_dir().join(format!("yingya-feedback-audit-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("v1")).await.unwrap();
        fs::create_dir_all(root.join("v2")).await.unwrap();
        let old = json!([{"id":"intro","durationSeconds":4,"text":"intro"},{"id":"core","durationSeconds":6,"text":"old"}]);
        let updated = json!([{"id":"intro","durationSeconds":4,"text":"intro"},{"id":"core","durationSeconds":8,"text":"new"}]);
        fs::write(root.join("v1/scenes.json"), old.to_string())
            .await
            .unwrap();
        fs::write(root.join("v1/index.html"), b"source")
            .await
            .unwrap();
        assert_eq!(version_scenes(&root, "v1/index.html").await.unwrap(), old);
        fs::write(root.join("v2/scenes.json"), updated.to_string())
            .await
            .unwrap();
        fs::write(root.join("v1.mp4"), b"old-video").await.unwrap();
        assert!(
            tokio::process::Command::new("ffmpeg")
                .args([
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=blue:s=64x64:r=30:d=0.2",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-y"
                ])
                .arg(root.join("v2.mp4"))
                .status()
                .await
                .unwrap()
                .success()
        );
        let mut manifest: AgentManifest = serde_json::from_value(json!({"schemaVersion":1,"phase":"draft_review","dirty":false,"outputSpec":{},"artifacts":[],"versions":[{"id":"v1","label":"1","sourcePath":"v1","videoPath":"v1.mp4","createdAt":1}],"currentDraft":"v1","studioEntry":"index.html"})).unwrap();
        let feedback = serde_json::from_value(json!({"id":uuid::Uuid::new_v4().to_string(),"kind":"video-range","versionId":"v1","videoPath":"v1.mp4","timeSeconds":4.5,"endSeconds":8,"note":"local edit","createdAt":1})).unwrap();
        let guard = Guard::prepare(&root, &manifest, std::slice::from_ref(&feedback))
            .await
            .unwrap()
            .unwrap();
        manifest.versions.push(
            serde_json::from_value(
                json!({"id":"v2","label":"2","sourcePath":"v2","videoPath":"v2.mp4","createdAt":2}),
            )
            .unwrap(),
        );
        manifest.current_draft = Some("v2".into());
        let mapped = Guard::prepare(&root, &manifest, &[feedback])
            .await
            .unwrap()
            .unwrap();
        assert_eq!(mapped.base, "v2");
        assert!(mapped.targets.contains("core"));
        assert!(guard.audit(&root, &manifest, "turn").await.is_ok());
        let mut changed = updated.clone();
        changed[0]["text"] = json!("unrequested edit");
        fs::write(root.join("v2/scenes.json"), changed.to_string())
            .await
            .unwrap();
        assert!(
            guard
                .audit(&root, &manifest, "turn-bad")
                .await
                .unwrap_err()
                .contains("未请求")
        );
        fs::write(root.join("v2/scenes.json"), updated.to_string())
            .await
            .unwrap();
        fs::write(root.join("v1.mp4"), b"overwritten")
            .await
            .unwrap();
        assert!(
            guard
                .audit(&root, &manifest, "turn-bad")
                .await
                .unwrap_err()
                .contains("覆盖")
        );
        fs::remove_dir_all(root).await.unwrap();
    }
}
