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
    _gateway: Arc<Mutex<Child>>,
}
impl Sandbox {
    pub async fn new(
        root: PathBuf,
        resources: PathBuf,
        browser: Option<PathBuf>,
        token: &str,
    ) -> Result<Self, String> {
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
            .env(
                "YINGYA_BACKEND_BASE",
                std::env::var("YINGYA_INTERNAL_API_BASE")
                    .unwrap_or_else(|_| "http://127.0.0.1:8797".into()),
            )
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
                    "{}:{}/node_modules/.bin:/usr/local/bin:/usr/bin:/bin",
                    self.node.parent().unwrap().display(),
                    self.resources.display()
                ),
            )
            .env("HOME", self.root.join("runtime/home"))
            .env("LANG", "C.UTF-8")
            .env("HYPERFRAMES_NO_UPDATE_CHECK", "1")
            .env("HYPERFRAMES_SKIP_SKILLS", "1")
            .env("CODEX_HOME", self.root.join("runtime/codex-home"))
            .env("YINGYA_API_BASE", "http://127.0.0.1:8797")
            .env("VOXCPM2_API_BASE", "http://127.0.0.1:8791");
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
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let sandbox = Sandbox::new(
            root.clone(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")),
            None,
            "test-only",
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
        let socket = sandbox.socket.clone();
        drop(sandbox);
        let _ = tokio::fs::remove_file(socket).await;
        tokio::fs::remove_dir_all(parent).await.unwrap();
    }
}
