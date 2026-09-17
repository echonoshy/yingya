//! Release-owned component tooling for every tenant's isolated Codex process.
use std::path::Path;

pub const TOOL_INSTRUCTIONS: &str = "\n组件工具：node \"$YINGYA_COMPONENT_LIBRARY\" 提供 catalog/view/install/search/add/diagnose/build；按镜头需要自主选择现有实现、目录、源码检索或自定义实现，无需重复检索已知可用组件。shadcn MCP 可检索 @react-bits / @magicui 官方公开源码；其只读工作目录不代表视频项目，安装和构建须明确 --project。add 返回静态导入诊断，补齐依赖或资源后可用 diagnose 复查；导入成功不代表视频已适配。按需阅读 --help 和 references/reusable-motion.md 或 third-party-components.md，无需安装CLI。保留来源许可，统一视频时间，并完成实际检查、渲染与画面审阅。";

// Forward only the sandbox bridge's public egress settings, never host credentials.
const MCP_ENV_VARS: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "NO_PROXY",
    "no_proxy",
    "NODE_USE_ENV_PROXY",
];

pub fn shadcn_mcp_config(resources: &Path, node: &Path) -> serde_json::Value {
    let cli = resources.join("node_modules/shadcn/dist/index.js");
    let registry = resources.join("runtime/component-registry");
    serde_json::json!({
        "command": node,
        "args": [cli.to_string_lossy().into_owned(), String::from("mcp"), String::from("--cwd"), registry.to_string_lossy().into_owned()],
        "cwd": registry,
        "env_vars": MCP_ENV_VARS,
        "enabled": true,
        "startup_timeout_sec": 30,
        "tool_timeout_sec": 60,
    })
}

pub fn shadcn_mcp_override(resources: &Path, node: &Path) -> String {
    // JSON strings/arrays are also valid TOML values. Use a reserved Yingya name:
    // Codex recursively merges tables, so overriding a user's `shadcn` table would
    // retain incompatible fields such as an existing HTTP transport URL.
    let config = shadcn_mcp_config(resources, node);
    let fields = config
        .as_object()
        .unwrap()
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("mcp_servers.yingya_shadcn={{{fields}}}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn managed_mcp_uses_release_paths_and_only_egress_environment() {
        let first = shadcn_mcp_override(Path::new("/releases/one"), Path::new("/usr/bin/node"));
        let next = shadcn_mcp_override(Path::new("/releases/two"), Path::new("/usr/bin/node"));
        assert!(first.contains("/releases/one/node_modules/shadcn/dist/index.js"));
        assert!(next.contains("/releases/two/node_modules/shadcn/dist/index.js"));
        assert!(!next.contains("/releases/one"));
        assert!(next.contains("cwd=\"/releases/two/runtime/component-registry\""));
        assert!(next.contains("\"mcp\",\"--cwd\""));
        assert!(next.contains("NODE_USE_ENV_PROXY"));
        assert!(!next.contains("CODEX_HOME"));
        assert!(!next.contains("TOKEN"));
        assert!(!next.contains("API_KEY"));
    }

    #[test]
    fn paths_are_quoted_without_shell_interpolation() {
        let setting = shadcn_mcp_override(
            Path::new("/release space/quote\"/$(unused)"),
            Path::new("/node space/node"),
        );
        assert!(setting.contains("command=\"/node space/node\""));
        assert!(setting.contains(r#"/release space/quote\"/$(unused)/"#));
        assert!(!setting.contains("sh -c"));
    }

    #[test]
    fn discovery_registry_exposes_complete_react_bits_catalog() {
        let config: serde_json::Value = serde_json::from_str(include_str!(
            "../runtime/component-registry/components.json"
        ))
        .unwrap();
        assert_eq!(
            config["registries"]["@react-bits"],
            "https://reactbits.dev/r/{name}.json"
        );
        assert_eq!(
            config["registries"]["@magicui"],
            "https://magicui.design/r/{name}.json"
        );
    }
}
