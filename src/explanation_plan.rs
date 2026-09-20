//! Read-only production plan with a content-bound confirmation revision.
use crate::{agent_projects::AgentManifest, feedback::local_file};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs;

pub async fn read(root: &Path, manifest: &AgentManifest) -> Result<Value, String> {
    let checkpoint = manifest.checkpoint.as_ref().filter(|c| c.kind == "plan");
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(&manifest.checkpoint).map_err(|e| e.to_string())?);
    let mut document = Value::Null;
    let mut markdown = String::new();
    // Current checkpoint artifacts take precedence; past revisions must remain
    // readable without making an obsolete plan authoritative.
    let latest_plan = manifest
        .artifacts
        .iter()
        .rev()
        .find(|a| a.kind == "explanation-plan");
    let latest_text = manifest
        .artifacts
        .iter()
        .rev()
        .find(|a| a.kind == "plan" && a.path.ends_with(".md"));
    let artifacts: Vec<_> = manifest
        .artifacts
        .iter()
        .filter(|a| {
            if let Some(c) = checkpoint {
                c.artifact_ids.contains(&a.id)
            } else {
                latest_plan.is_some_and(|p| p.id == a.id)
                    || latest_text.is_some_and(|p| p.id == a.id)
            }
        })
        .collect();
    for artifact in artifacts {
        let file = local_file(root, &artifact.path).await?;
        let bytes = fs::read(file).await.map_err(|e| e.to_string())?;
        hash.update(artifact.path.as_bytes());
        hash.update(&bytes);
        if artifact.kind == "explanation-plan" {
            document =
                serde_json::from_slice(&bytes).map_err(|_| "制作方案格式无效".to_string())?;
            validate(&document)?;
        } else if artifact.path.ends_with(".md") {
            markdown = String::from_utf8(bytes).map_err(|_| "方案文字编码无效".to_string())?;
        }
    }
    let mut ready = manifest
        .output_spec
        .pointer("/requirements/workflow")
        .and_then(Value::as_str)
        != Some("knowledge-explainer")
        || !document.is_null();
    if let Some(sections) = document["sections"].as_array() {
        let selected: Vec<_> = sections
            .iter()
            .filter(|s| s.get("keyframe").is_some())
            .collect();
        ready = selected.len() == sections.len().min(3);
        for section in selected {
            let frame = &section["keyframe"];
            if frame["status"] != "ready" {
                ready = false;
                continue;
            }
            for field in ["path", "sourcePath"] {
                let path = frame[field].as_str().ok_or("关键画面缺少实际源文件")?;
                let file = local_file(root, path).await?;
                hash.update(path.as_bytes());
                hash.update(fs::read(file).await.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(
        json!({ "checkpointId": checkpoint.map(|c| &c.id), "revision": format!("{:x}", hash.finalize()), "document": document, "markdown": markdown, "ready": ready }),
    )
}

/// Preserve the exact approved visual plan for subsequent version comparison.
pub async fn archive(root: &Path, plan: &Value) -> Result<(), String> {
    let revision = plan["revision"]
        .as_str()
        .filter(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or("方案修订标识无效")?;
    let relative = format!(".yingya/plan-approvals/{revision}");
    let canonical_root = fs::canonicalize(root).await.map_err(|e| e.to_string())?;
    let metadata_dir = fs::canonicalize(root.join(".yingya"))
        .await
        .map_err(|e| e.to_string())?;
    if !metadata_dir.starts_with(&canonical_root) {
        return Err("方案归档目录不属于当前项目".into());
    }
    let approvals = metadata_dir.join("plan-approvals");
    fs::create_dir_all(&approvals)
        .await
        .map_err(|e| e.to_string())?;
    let approvals = fs::canonicalize(approvals)
        .await
        .map_err(|e| e.to_string())?;
    if !approvals.starts_with(&canonical_root) {
        return Err("方案归档目录不属于当前项目".into());
    }
    fs::create_dir_all(approvals.join(revision))
        .await
        .map_err(|e| e.to_string())?;
    let dir = fs::canonicalize(approvals.join(revision))
        .await
        .map_err(|e| e.to_string())?;
    if !dir.starts_with(&canonical_root) {
        return Err("方案归档目录不属于当前项目".into());
    }
    let mut snapshot = plan.clone();
    if let Some(sections) = snapshot["document"]["sections"].as_array_mut() {
        for (index, section) in sections.iter_mut().enumerate() {
            if let Some(frame) = section.get_mut("keyframe") {
                for field in ["path", "sourcePath"] {
                    if let Some(path) = frame[field].as_str() {
                        let source = local_file(root, path).await?;
                        let name = format!(
                            "frame-{index}-{field}.{}",
                            source.extension().and_then(|s| s.to_str()).unwrap_or("bin")
                        );
                        fs::copy(source, dir.join(&name))
                            .await
                            .map_err(|e| e.to_string())?;
                        frame[field] = json!(format!("{relative}/{name}"));
                    }
                }
            }
        }
    }
    fs::write(
        dir.join("plan.json"),
        serde_json::to_vec_pretty(&snapshot).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn validate(value: &Value) -> Result<(), String> {
    for key in [
        "title",
        "audience",
        "question",
        "takeaway",
        "narration",
        "aspectRatio",
    ] {
        if value[key].as_str().is_none_or(|s| s.trim().is_empty()) {
            return Err(format!("制作方案缺少 {key}"));
        }
    }
    if value["durationSeconds"]
        .as_f64()
        .is_none_or(|n| !n.is_finite() || n <= 0.0)
    {
        return Err("方案预计时长无效".into());
    }
    let sections = value["sections"]
        .as_array()
        .filter(|v| !v.is_empty())
        .ok_or("制作方案缺少内容段落")?;
    let mut ids = std::collections::HashSet::new();
    for section in sections {
        let id = section["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("方案段落缺少 ID")?;
        if !ids.insert(id) {
            return Err("方案段落 ID 重复".into());
        }
        for key in ["title", "summary", "expression"] {
            if section[key].as_str().is_none_or(|s| s.trim().is_empty()) {
                return Err(format!("方案段落缺少 {key}"));
            }
        }
        if let Some(frame) = section.get("keyframe") {
            if !matches!(
                frame["status"].as_str(),
                Some("pending" | "ready" | "failed")
            ) {
                return Err("关键画面状态无效".into());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_incomplete_and_duplicate_sections() {
        assert!(validate(&json!({})).is_err());
        let section = json!({"id":"a","title":"概念","summary":"说明","expression":"对比"});
        let mut value = json!({"title":"测试","audience":"初学者","question":"是什么","takeaway":"结论","narration":"旁白","aspectRatio":"16:9","durationSeconds":90,"sections":[section]});
        assert!(validate(&value).is_ok());
        let duplicate = value["sections"][0].clone();
        value["sections"].as_array_mut().unwrap().push(duplicate);
        assert!(validate(&value).is_err());
    }
}

#[cfg(test)]
mod revision_tests {
    use super::*;
    #[tokio::test]
    async fn revision_binds_actual_plan_frame_and_source() {
        let root = std::env::temp_dir().join(format!("yingya-plan-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).await.unwrap();
        let plan = json!({"title":"单摆","audience":"初学者","question":"摆长影响什么","takeaway":"周期变长","narration":"中文","aspectRatio":"16:9","durationSeconds":90,"sections":[{"id":"one","title":"比较","summary":"摆长四倍","expression":"周期两倍","keyframe":{"status":"ready","path":"frame.png","sourcePath":"index.html"}}]});
        fs::write(root.join("plan.json"), plan.to_string())
            .await
            .unwrap();
        fs::write(root.join("frame.png"), b"frame1").await.unwrap();
        fs::write(root.join("index.html"), b"source1")
            .await
            .unwrap();
        let manifest: AgentManifest=serde_json::from_value(json!({"schemaVersion":1,"phase":"plan_review","dirty":false,"checkpoint":{"id":"plan1","kind":"plan","title":"plan","summary":"","artifactIds":["plan"]},"outputSpec":{"requirements":{"workflow":"knowledge-explainer"}},"artifacts":[{"id":"plan","kind":"explanation-plan","label":"plan","path":"plan.json"}],"versions":[],"studioEntry":"index.html"})).unwrap();
        let first = read(&root, &manifest).await.unwrap();
        assert_eq!(first["ready"], true);
        fs::create_dir_all(root.join(".yingya")).await.unwrap();
        archive(&root, &first).await.unwrap();
        let archived = root
            .join(".yingya/plan-approvals")
            .join(first["revision"].as_str().unwrap());
        assert_eq!(
            fs::read(archived.join("frame-0-sourcePath.html"))
                .await
                .unwrap(),
            b"source1"
        );
        assert_eq!(
            fs::read(archived.join("frame-0-path.png")).await.unwrap(),
            b"frame1"
        );
        fs::write(root.join("index.html"), b"source2")
            .await
            .unwrap();
        let second = read(&root, &manifest).await.unwrap();
        assert_ne!(first["revision"], second["revision"]);
        fs::write(root.join("frame.png"), b"frame2").await.unwrap();
        assert_ne!(
            second["revision"],
            read(&root, &manifest).await.unwrap()["revision"]
        );
        let mut missing = plan;
        missing["sections"][0]["keyframe"]["status"] = json!("pending");
        fs::write(root.join("plan.json"), missing.to_string())
            .await
            .unwrap();
        assert_eq!(read(&root, &manifest).await.unwrap()["ready"], false);
        fs::remove_dir_all(root).await.unwrap();
    }
}
