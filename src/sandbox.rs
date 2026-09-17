use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
};
use tokio::{
    process::{Child, Command},
    sync::Mutex,
};

#[derive(Clone)]
pub struct Sandbox {
    root: PathBuf,
    resources: PathBuf,
    node: PathBuf,
    socket: PathBuf,
    browser: Option<PathBuf>,
    python: Option<PathBuf>,
    _gateway: Arc<Mutex<Child>>,
}
impl Sandbox {
    pub async fn new(
        root: PathBuf,
        resources: PathBuf,
        browser: Option<PathBuf>,
        token: &str,
        service_base: &str,
    ) -> Result<Self, String> {
        let python = resources
            .join(".runtime/python-runtime")
            .canonicalize()
            .ok()
            .filter(|root| {
                root.join("ready.json").is_file() && root.join("venv/bin/python").is_file()
            });
        let node = std::env::var_os("PATH")
            .and_then(|p| {
                std::env::split_paths(&p)
                    .map(|p| p.join("node"))
                    .find(|p| p.is_file())
            })
            .ok_or("Node.js not found")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let socket =
            std::env::temp_dir().join(format!("yingya-{}.sock", uuid::Uuid::new_v4().simple()));
        let gateway = Command::new(&node)
            .arg(resources.join("scripts/sandbox-gateway.mjs"))
            .env("YINGYA_GATEWAY_SOCKET", &socket)
            .env("YINGYA_SERVICE_TOKEN", token)
            .env("YINGYA_BACKEND_BASE", service_base)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| e.to_string())?;
        for _ in 0..100 {
            if socket.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        if !socket.exists() {
            return Err("用户网络网关启动失败".into());
        }
        Ok(Self {
            root,
            resources,
            node,
            socket,
            browser,
            python,
            _gateway: Arc::new(Mutex::new(gateway)),
        })
    }
    pub fn command(&self, program: impl AsRef<Path>) -> Command {
        let mut c = Command::new("bwrap");
        c.args([
            "--die-with-parent",
            "--unshare-all",
            "--new-session",
            "--cap-drop",
            "ALL",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--tmpfs",
            "/tmp",
            "--dir",
            "/run",
        ]);
        for path in [
            "/usr",
            "/bin",
            "/lib",
            "/lib64",
            "/etc/ssl",
            "/etc/fonts",
            "/etc/alternatives",
            "/etc/resolv.conf",
            "/etc/hosts",
            "/etc/nsswitch.conf",
            "/etc/ld.so.cache",
        ] {
            if Path::new(path).exists() {
                c.args(["--ro-bind", path, path]);
            }
        }
        let node_root = self.node.parent().unwrap().parent().unwrap();
        if !node_root.starts_with("/usr") {
            c.arg("--ro-bind").arg(node_root).arg(node_root);
        }
        for name in ["node_modules", "skills"] {
            let path = self.resources.join(name);
            c.arg("--ro-bind").arg(&path).arg(&path);
        }
        let runtime = self.resources.join("runtime");
        if runtime.is_dir() {
            c.arg("--ro-bind").arg(&runtime).arg(&runtime);
        }
        let bridge = self.resources.join("scripts/sandbox-bridge.mjs");
        c.arg("--ro-bind").arg(&bridge).arg(&bridge);
        let browser_wrapper = self.resources.join("scripts/sandbox-browser.sh");
        c.arg("--ro-bind")
            .arg(&browser_wrapper)
            .arg(&browser_wrapper);
        if let Some(browser) = &self.browser {
            let dir = browser.parent().unwrap();
            c.arg("--ro-bind").arg(dir).arg(dir);
        }
        if let Some(python) = &self.python {
            c.arg("--ro-bind").arg(python).arg(python);
        }
        c.arg("--bind")
            .arg(&self.root)
            .arg(&self.root)
            .arg("--ro-bind")
            .arg(&self.socket)
            .arg("/run/yingya-gateway.sock");
        c.env_clear()
            .env(
                "PATH",
                format!(
                    "{}{}:{}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin",
                    self.python
                        .as_ref()
                        .map(|p| format!("{}/venv/bin:", p.display()))
                        .unwrap_or_default(),
                    self.node.parent().unwrap().display(),
                    self.resources.display()
                ),
            )
            .env("HOME", self.root.join("runtime/home"))
            .env("LANG", "C.UTF-8")
            .env("PYTHONNOUSERSITE", "1")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("MPLBACKEND", "Agg")
            .env("XDG_CACHE_HOME", "/tmp/yingya-cache")
            .env("MPLCONFIGDIR", "/tmp/yingya-cache/matplotlib")
            .env("YINGYA_NODE_MODULES", self.resources.join("node_modules"))
            .env(
                "YINGYA_COMPONENT_LIBRARY",
                self.resources.join("runtime/component-library.mjs"),
            )
            .env(
                "YINGYA_ANIME_COMPONENTS",
                self.resources.join("runtime/animejs/cli.mjs"),
            )
            .env(
                "YINGYA_RUNTIME_TOOLS",
                self.resources.join("runtime/agent-tools.mjs"),
            )
            .env(
                "YINGYA_PRODUCTION_TASK",
                self.resources.join("runtime/production-task.py"),
            )
            .env(
                "YINGYA_MEDIA_ANALYSIS",
                self.resources.join("runtime/media-analysis.py"),
            )
            .env(
                "YINGYA_EDITORIAL_ASSEMBLER",
                self.resources.join("runtime/editorial/assemble.mjs"),
            )
            .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
            .env("HYPERFRAMES_SKIP_SKILLS", "1")
            .env("CODEX_HOME", self.root.join("runtime/codex-home"))
            .env("YINGYA_API_BASE", "http://127.0.0.1:8797")
            .env("VOXCPM2_API_BASE", "http://127.0.0.1:8791");
        if let Some(python) = &self.python {
            c.env("VIRTUAL_ENV", python.join("venv"));
        }
        if let Some(browser) = &self.browser {
            c.env("HYPERFRAMES_BROWSER_PATH", &browser_wrapper)
                .env("YINGYA_BROWSER_BINARY", browser);
        }
        c.current_dir(&self.root)
            .arg(&self.node)
            .arg(bridge)
            .arg(program.as_ref());
        c
    }

    pub fn component_library_mcp_override(&self) -> String {
        crate::component_library::shadcn_mcp_override(&self.resources, &self.node)
    }

    pub fn tool_instructions(&self) -> String {
        let python = if self.python.is_some() {
            "共享 Python 3.12 已就绪，python 和 python3 都指向同一只读环境；已安装 requests/httpx、BeautifulSoup/lxml、Pillow、NumPy/pandas/SciPy/matplotlib、pypdf、python-docx/python-pptx/openpyxl。无需激活环境或为用户安装依赖。"
        } else {
            "共享 Python 环境未配置；只使用 python3 标准库或 Node.js 内置 fetch，不能假定 PIL 等第三方库可用，不要使用 python（可能是 Python 2）。"
        };
        let browser = if self.browser.is_some() {
            "已配置 Chromium 入口 HYPERFRAMES_BROWSER_PATH。Playwright 必须传 executablePath: process.env.HYPERFRAMES_BROWSER_PATH，并从 YINGYA_NODE_MODULES 加载；不要使用 Playwright 默认下载路径，也不要搜索 /opt/google/chrome 或 ~/.cache/ms-playwright。浏览器能否渲染/WebGL 是否可用可执行一次 node \"$YINGYA_RUNTIME_TOOLS\" --probe-browser；失败后按返回的替代方式继续，不重复试同一失败入口。"
        } else {
            "当前沙箱没有可用的 Chromium 入口，Browser 专用工具也未提供。不要尝试默认 Chrome/Playwright 路径、安装浏览器或反复运行截图命令。网页文本改用 Python requests/BeautifulSoup 或 Node.js fetch；图片检查用 Pillow，视频信息用 ffprobe/ffmpeg。可做静态检查，但无法宣称浏览器预览或渲染通过；需要渲染时报告具体缺失能力。"
        };
        format!(
            "\n运行工具说明（当前用户沙箱）：{python}\n{browser}\n可复用镜头统一从 node \"$YINGYA_COMPONENT_LIBRARY\" catalog 查看，按需 install --component 镜头ID --project 当前项目；先读 references/reusable-motion.md。已有 Anime.js 镜头和旧工具继续兼容，避免重复注册时钟、重复实现已有动效。\n执行工具必须返回完整结果：functions.exec 中使用 text(await tools.exec_command(...))，不能只输出 r.output。session_id 表示命令仍在运行，使用 write_stdin 轮询同一 session_id，直到获得 exit_code；等待窗口结束、空日志、Script completed 都不是命令完成或超时的证据。不要因此结束制作任务。检查和渲染使用 python3 \"$YINGYA_PRODUCTION_TASK\"，用当前请求编号登记任务，按 references/runtime-tools.md 查询已有任务，不启动重复进程。\n需要理解上传视频时，其元数据与关键帧使用 python3 \"$YINGYA_MEDIA_ANALYSIS\" --project . --source 项目内素材路径 --json，自动复用内容指纹缓存。适合聚焦、高亮等处理的素材镜头可用 node \"$YINGYA_EDITORIAL_ASSEMBLER\" 从 scenes.json 装配已接入的镜头；先读 references/existing-footage.md，实际查看素材后再选段、剪辑或补充新画面，遵循用户声音要求；该装配器不是所有视频的默认制作路线。\n当前中继未接通内置网页搜索和 Apps 连接器，已停用这些工具。网页资料用 Python requests/BeautifulSoup 或 Node.js fetch 读取已知官方页面；需要搜索才能找到来源时如实说明限制，不编造来源。\n详细用法见 yingya-video-agent 的 references/runtime-tools.md。"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires installed shadcn and public React Bits registry connectivity"]
    async fn shadcn_mcp_searches_and_reads_react_bits_inside_user_sandbox() {
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root =
            std::env::temp_dir().join(format!("yingya-mcp-network-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(root.join("runtime/home"))
            .await
            .unwrap();
        let sandbox = Sandbox::new(
            root.clone(),
            resources.clone(),
            None,
            "test-only",
            "http://127.0.0.1:8797",
        )
        .await
        .unwrap();
        let home = root.join("runtime/codex-home");
        tokio::fs::create_dir_all(&home).await.unwrap();
        tokio::fs::write(
            home.join("config.toml"),
            "[mcp_servers.shadcn]\nurl = \"https://example.invalid/user-shadcn\"\n",
        )
        .await
        .unwrap();
        let config_output = sandbox
            .command(resources.join("node_modules/.bin/codex"))
            .arg("-c")
            .arg(sandbox.component_library_mcp_override())
            .args(["mcp", "list", "--json"])
            .output()
            .await
            .unwrap();
        assert!(
            config_output.status.success(),
            "{}",
            String::from_utf8_lossy(&config_output.stderr)
        );
        let configured: serde_json::Value = serde_json::from_slice(&config_output.stdout).unwrap();
        let servers = configured.as_array().unwrap();
        let managed = servers
            .iter()
            .find(|entry| entry["name"] == "yingya_shadcn")
            .unwrap();
        assert_eq!(managed["transport"]["type"], "stdio");
        assert!(servers.iter().any(|entry| entry["name"] == "shadcn"
            && entry["transport"]["url"] == "https://example.invalid/user-shadcn"));
        let script = r#"
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { appendFile } from 'node:fs/promises';
const require = createRequire(join(process.env.YINGYA_NODE_MODULES, 'shadcn/package.json'));
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const config = JSON.parse(process.env.YINGYA_TEST_MCP_CONFIG);
const env = Object.fromEntries(config.env_vars.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
if (env.HTTPS_PROXY !== 'http://127.0.0.1:18888' || env.NODE_USE_ENV_PROXY !== '1') throw new Error('Sandbox proxy is missing');
let readonly = false;
try { await appendFile(join(config.cwd, 'components.json'), ''); } catch { readonly = true; }
if (!readonly) throw new Error('Managed registry must be read-only');
const client = new Client({ name: 'yingya-mcp-integration', version: '1.0.0' });
const transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd, env, stderr: 'pipe' });
try {
  await client.connect(transport);
  const names = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of ['search_items_in_registries', 'view_items_in_registries']) if (!names.includes(name)) throw new Error(`Missing tool ${name}`);
  const search = await client.callTool({ name: 'search_items_in_registries', arguments: { registries: ['@react-bits'], query: 'Aurora', limit: 4 } });
  const view = await client.callTool({ name: 'view_items_in_registries', arguments: { items: ['@react-bits/Aurora-TS-CSS'] } });
  const magic = await client.callTool({ name: 'view_items_in_registries', arguments: { items: ['@magicui/animated-beam'] } });
  const magicText = magic.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  if (magic.isError || !magicText.includes('animated-beam')) throw new Error(`Magic UI lookup failed: ${magicText.slice(0, 400)}`);
  for (const [name, result] of [['search', search], ['view', view]]) {
    const text = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (result.isError || !text.includes('Aurora')) throw new Error(`${name} did not return Aurora: ${text.slice(0, 400)}`);
  }
  console.log(JSON.stringify({ tools: names, search: 'Aurora found', view: 'Aurora-TS-CSS read', magic: 'AnimatedBeam read', registryReadOnly: readonly, sandboxProxy: true }));
} finally { await client.close(); }
"#;
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            sandbox
                .command(&sandbox.node)
                .args(["--input-type=module", "-e", script])
                .env(
                    "YINGYA_TEST_MCP_CONFIG",
                    crate::component_library::shadcn_mcp_config(&resources, &sandbox.node)
                        .to_string(),
                )
                .kill_on_drop(true)
                .output(),
        )
        .await
        .expect("MCP integration exceeded 120 seconds")
        .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(result["search"], "Aurora found");
        assert_eq!(result["view"], "Aurora-TS-CSS read");
        println!("{result}");
        let socket = sandbox.socket.clone();
        drop(sandbox);
        let _ = tokio::fs::remove_file(socket).await;
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    #[ignore = "requires npm run python:setup and HyperFrames browser installation"]
    async fn runtime_tools_share_python_read_only_and_probe_real_browser() {
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let root =
            std::env::temp_dir().join(format!("yingya-runtime-tools-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(root.join("runtime/home"))
            .await
            .unwrap();
        let browser = crate::api::discover_hyperframes_browser(
            &resources,
            &resources.join(".runtime/hyperframes-home"),
        )
        .await;
        assert!(
            browser.is_some(),
            "install the HyperFrames browser before this integration check"
        );
        let sandbox = Sandbox::new(
            root.clone(),
            resources.clone(),
            browser,
            "test-only",
            "http://127.0.0.1:8797",
        )
        .await
        .unwrap();
        assert!(sandbox.python.is_some(), "run npm run python:setup first");
        let script = r#"import sys,os,pathlib,subprocess
import requests,httpx,bs4,lxml.etree,PIL,numpy,pandas,scipy,matplotlib,pypdf,docx,pptx,openpyxl
from PIL import Image
import matplotlib.pyplot as plt
assert sys.version_info[:2] == (3,12)
assert pathlib.Path(subprocess.check_output(['python3','-c','import sys; print(sys.executable)']).decode().strip()).resolve() == pathlib.Path(sys.executable).resolve()
assert pathlib.Path(sys.prefix) == pathlib.Path(os.environ['VIRTUAL_ENV'])
for variable in ['YINGYA_MEDIA_ANALYSIS', 'YINGYA_EDITORIAL_ASSEMBLER', 'YINGYA_ANIME_COMPONENTS', 'YINGYA_COMPONENT_LIBRARY']:
    tool = pathlib.Path(os.environ[variable])
    assert tool.is_file(), f'{variable} is not installed in this release'
    command = ['python3' if variable == 'YINGYA_MEDIA_ANALYSIS' else 'node', str(tool), '--help']
    subprocess.run(command, check=True, capture_output=True, timeout=10)
    try:
        with tool.open('a'): pass
    except OSError: pass
    else: raise AssertionError(f'{variable} is writable from a customer sandbox')
import json
anime_cli = os.environ['YINGYA_ANIME_COMPONENTS']
catalog = json.loads(subprocess.check_output(['node', anime_cli, 'list', '--json'], text=True))
assert catalog, 'motion catalog is empty in the production sandbox'
project = pathlib.Path('anime-project')
project.mkdir()
subprocess.run(['node', anime_cli, 'install', '--project', str(project)], check=True, capture_output=True, timeout=10)
bundle = project / 'assets/animejs/anime.umd.min.js'
assert bundle.read_bytes() == pathlib.Path(anime_cli).with_name('anime.umd.min.js').read_bytes()
assert (project / 'assets/animejs/scenes.js').is_file()
components_cli = os.environ['YINGYA_COMPONENT_LIBRARY']
catalog = json.loads(subprocess.check_output(['node', components_cli, 'catalog'], text=True))
assert {'beam-network', 'model-stage'}.issubset({item['id'] for item in catalog['components']})
for component in ['beam-network', 'model-stage']:
    installed = json.loads(subprocess.check_output(['node', components_cli, 'install', '--component', component, '--project', str(project)], text=True))
    assert (project / installed['script']).is_file()
    assert (project / installed['clock']).is_file()
try: pathlib.Path(sys.prefix,'forbidden-write').write_text('x')
except OSError: pass
else: raise AssertionError('shared Python is writable')
Image.new('RGB',(32,32),'white').save('image.png')
plt.plot([0,1],[0,1]); plt.savefig('chart.png'); plt.close()
assert pathlib.Path('image.png').stat().st_size and pathlib.Path('chart.png').stat().st_size
print('shared Python imports, aliases, isolation, Pillow and matplotlib passed')
"#;
        let output = sandbox
            .command("python")
            .args(["-c", script])
            .output()
            .await
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let output = sandbox
            .command("node")
            .arg(resources.join("runtime/agent-tools.mjs"))
            .arg("--probe-browser")
            .output()
            .await
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let probe: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(probe["browser"]["available"], true, "{probe}");
        assert!(
            probe["python"]["libraries"]
                .as_object()
                .unwrap()
                .values()
                .all(|v| v == true)
        );
        println!("{probe}");
        assert!(
            sandbox
                .tool_instructions()
                .contains("HYPERFRAMES_BROWSER_PATH")
        );
        assert!(
            sandbox
                .tool_instructions()
                .contains("YINGYA_MEDIA_ANALYSIS")
        );
        assert!(
            sandbox
                .tool_instructions()
                .contains("YINGYA_EDITORIAL_ASSEMBLER")
        );
        let mut unavailable = sandbox.clone();
        unavailable.browser = None;
        unavailable.python = None;
        assert!(unavailable.tool_instructions().contains("不要使用 python"));
        assert!(
            unavailable
                .tool_instructions()
                .contains("当前沙箱没有可用的 Chromium")
        );
        drop(unavailable);
        let socket = sandbox.socket.clone();
        drop(sandbox);
        let _ = tokio::fs::remove_file(socket).await;
        tokio::fs::remove_dir_all(root).await.unwrap();
    }

    #[tokio::test]
    async fn user_process_cannot_read_siblings_or_reach_host_network() {
        let parent =
            std::env::temp_dir().join(format!("yingya-sandbox-test-{}", uuid::Uuid::new_v4()));
        let root = parent.join("own");
        tokio::fs::create_dir_all(root.join("runtime/home"))
            .await
            .unwrap();
        tokio::fs::write(parent.join("other-user.txt"), "private sentinel")
            .await
            .unwrap();
        tokio::fs::create_dir_all(root.join("runtime/codex-home"))
            .await
            .unwrap();
        tokio::fs::write(parent.join("auth.json"), r#"{"tokens":{"access_token":"private-model-access","refresh_token":"private-model-refresh"}}"#).await.unwrap();
        crate::model_relay::ModelRelay::new(&parent)
            .unwrap()
            .prepare_user_auth(&root.join("runtime/codex-home"))
            .await
            .unwrap();
        let sandbox = Sandbox::new(
            root.clone(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            None,
            "test-only",
            "http://127.0.0.1:8797",
        )
        .await
        .unwrap();
        let output = sandbox.command("/usr/bin/python3").args(["-c", "import os,socket,urllib.request; assert not os.path.exists(os.environ['OTHER_FILE']); assert os.getcwd()==os.environ['OWN_DIR']; s=socket.socket(); s.settimeout(.2); assert s.connect_ex(('127.0.0.1',8807))!=0; op=urllib.request.build_opener(urllib.request.ProxyHandler({'http':'http://127.0.0.1:18888'}));\ntry: op.open('http://10.0.0.1/', timeout=2); raise AssertionError('private proxy allowed')\nexcept urllib.error.HTTPError as e: assert e.code==403\nprint('isolated')"])
            .env("OTHER_FILE", parent.join("other-user.txt")).env("OWN_DIR",&root).output().await.unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("isolated"));
        let credential_check = sandbox.command("/usr/bin/python3").args(["-c", "import os,pathlib; p=pathlib.Path(os.environ['CODEX_HOME']); assert 'private-model-' not in (p/'auth.json').read_text(); assert not pathlib.Path(os.environ['HOST_AUTH']).exists(); print('host credentials isolated')"])
            .env("HOST_AUTH", parent.join("auth.json")).output().await.unwrap();
        assert!(
            credential_check.status.success(),
            "{}",
            String::from_utf8_lossy(&credential_check.stderr)
        );
        let socket = sandbox.socket.clone();
        drop(sandbox);
        let _ = tokio::fs::remove_file(socket).await;
        tokio::fs::remove_dir_all(parent).await.unwrap();
    }
}
