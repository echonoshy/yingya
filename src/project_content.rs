use super::*;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ContentFile {
    path: String,
    name: String,
    size: u64,
    modified_at: u64,
}

#[derive(Serialize)]
pub(super) struct ProjectContents {
    files: Vec<ContentFile>,
    truncated: bool,
}

pub(super) async fn list(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<ProjectContents>, ApiError> {
    state
        .agent_projects
        .read_project(&project_id)
        .await
        .map_err(ApiError::Project)?;
    let root = state
        .agent_projects
        .project_dir(&project_id)
        .map_err(ApiError::Project)?;
    let result = tokio::task::spawn_blocking(move || scan(&root))
        .await
        .map_err(|_| ApiError::External("项目内容读取失败，请重试".into()))??;
    Ok(Json(result))
}

// Read-only discovery also includes outputs which the running agent has not yet
// registered in the manifest. Never traverse symlinks, hidden state or dependencies.
fn scan(root: &FilePath) -> std::io::Result<ProjectContents> {
    if std::fs::symlink_metadata(root)?.file_type().is_symlink() {
        return Err(std::io::Error::other("项目目录不可用"));
    }
    let root = root.canonicalize()?;
    let mut pending = vec![(root.clone(), 0)];
    let mut files = Vec::new();
    let mut inspected = 0;
    let mut truncated = false;
    'walk: while let Some((directory, depth)) = pending.pop() {
        for entry in std::fs::read_dir(directory)? {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            inspected += 1;
            if inspected > 10000 || files.len() >= 1000 {
                truncated = true;
                break 'walk;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.')
                || matches!(
                    name.as_str(),
                    "node_modules" | "target" | "__pycache__" | "component-library"
                )
            {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                if depth < 12 {
                    pending.push((path, depth + 1));
                } else {
                    truncated = true;
                }
                continue;
            }
            if !kind.is_file() || !visible_file(&name, depth) {
                continue;
            }
            let canonical = match path.canonicalize() {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            if !canonical.starts_with(&root) {
                continue;
            }
            let metadata = match std::fs::symlink_metadata(&path) {
                Ok(value) => value,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error),
            };
            if metadata.file_type().is_symlink() || metadata.len() == 0 {
                continue;
            }
            files.push(ContentFile {
                path: path
                    .strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                name,
                size: metadata.len(),
                modified_at: metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                    .map(|time| time.as_millis() as u64)
                    .unwrap_or(0),
            });
        }
    }
    files.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(ProjectContents { files, truncated })
}

fn visible_file(name: &str, depth: usize) -> bool {
    if depth == 0
        && matches!(
            name,
            "project.json"
                | "manifest.json"
                | "messages.json"
                | "queue.json"
                | "assets.json"
                | "scenes.json"
                | "source-bindings.json"
                | "remotion.json"
                | "remotion-build.json"
                | "package.json"
                | "package-lock.json"
                | "tsconfig.json"
                | "index.html"
                | "AGENTS.md"
        )
    {
        return false;
    }
    let extension = FilePath::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "mp4"
            | "webm"
            | "mov"
            | "m4v"
            | "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "gif"
            | "avif"
            | "svg"
            | "mp3"
            | "wav"
            | "m4a"
            | "ogg"
            | "flac"
            | "aac"
            | "pdf"
            | "md"
            | "markdown"
            | "txt"
            | "csv"
            | "docx"
            | "xlsx"
            | "pptx"
            | "json"
            | "html"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovers_outputs_without_exposing_state_or_following_links() {
        let scratch = std::env::temp_dir().join(format!("yingya-contents-{}", Uuid::new_v4()));
        let root = scratch.join("project");
        for dir in ["plans", "assets/generated", ".yingya", "node_modules"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        for file in [
            "plans/outline.md",
            "assets/generated/frame.png",
            "project.json",
            "messages.json",
            "remotion.json",
            ".yingya/private.json",
            "node_modules/demo.png",
        ] {
            std::fs::write(root.join(file), b"fixture").unwrap();
        }
        std::fs::write(root.join("empty.mp4"), b"").unwrap();
        std::fs::write(scratch.join("outside.png"), b"private").unwrap();
        std::os::unix::fs::symlink(scratch.join("outside.png"), root.join("linked.png")).unwrap();
        std::os::unix::fs::symlink(&scratch, root.join("linked-dir")).unwrap();
        let result = scan(&root).unwrap();
        let paths: Vec<_> = result.files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths.len(), 2);
        assert!(
            paths.contains(&"plans/outline.md") && paths.contains(&"assets/generated/frame.png")
        );
        assert!(!result.truncated);
        assert!(
            result
                .files
                .iter()
                .all(|file| file.size == 7 && file.modified_at > 0)
        );
        std::fs::write(root.join("new-video.mp4"), b"new").unwrap();
        assert_eq!(scan(&root).unwrap().files.len(), 3);
        std::fs::remove_dir_all(scratch).unwrap();
    }

    #[test]
    fn caps_large_projects_and_reports_partial_results() {
        let root = std::env::temp_dir().join(format!("yingya-contents-limit-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        for n in 0..1002 {
            std::fs::write(root.join(format!("{n}.png")), b"image").unwrap();
        }
        let result = scan(&root).unwrap();
        assert_eq!(result.files.len(), 1000);
        assert!(result.truncated);
        std::fs::remove_dir_all(root).unwrap();
    }
}
