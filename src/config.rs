use std::{env, path::PathBuf};

#[derive(Clone, Debug)]
pub struct AppPaths {
    pub resources: PathBuf,
    pub app_data: PathBuf,
    pub cache: PathBuf,
    pub runtime: PathBuf,
    pub projects: PathBuf,
    pub assets: PathBuf,
    pub codex_home: PathBuf,
    pub hyperframes_home: PathBuf,
}

impl AppPaths {
    pub fn from_env() -> Result<Self, String> {
        let resources = env::var_os("YINGYA_RESOURCE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_resource_dir);
        let app_data = env::var_os("YINGYA_APP_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| default_app_data_dir(&resources));
        let cache = env::var_os("YINGYA_CACHE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                if cfg!(debug_assertions) {
                    resources.join(".runtime")
                } else {
                    app_data.join("cache")
                }
            });
        let runtime = env::var_os("YINGYA_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                if cfg!(debug_assertions) {
                    resources.join(".runtime")
                } else {
                    app_data.join("runtime")
                }
            });
        let projects = env::var_os("YINGYA_AGENT_PROJECTS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| app_data.join("video-projects"));
        let assets = env::var_os("YINGYA_ASSETS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| app_data.join("assets"));
        let codex_home = env::var_os("YINGYA_CODEX_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| runtime.join("codex-home"));
        let hyperframes_home = runtime.join("hyperframes-home");
        Ok(Self {
            resources,
            app_data,
            cache,
            runtime,
            projects,
            assets,
            codex_home,
            hyperframes_home,
        })
    }
}

fn default_resource_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    }
    env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(ToOwned::to_owned))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn default_app_data_dir(resources: &std::path::Path) -> PathBuf {
    if cfg!(debug_assertions) {
        return resources.join("data");
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home).join("Library/Application Support/Yingya");
    }
    if let Some(xdg) = env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("yingya");
    }
    if let Some(home) = env::var_os("HOME") {
        return PathBuf::from(home).join(".local/share/yingya");
    }
    resources.join("data")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn development_paths_keep_repository_layout() {
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        assert_eq!(default_app_data_dir(&resources), resources.join("data"));
    }
}
