# Installation and development

[Back to the product overview](../README.md) · [Documentation index](README.md)

## Prerequisites

- Linux with Bubblewrap (`bwrap`) and unprivileged user namespaces enabled for
  the per-user Agent sandbox.
- Rust 1.88 or newer with Cargo; Node.js 22 or newer with npm.
- `tmux` for the development services, and FFmpeg for media processing.
- Host-side model credentials and the user runtime configuration described in
  [user sandboxes and usage](USER_SANDBOX.md).
- A HyperFrames browser for video previews and rendering; see
  [HyperFrames tooling](INTEGRATIONS.md#hyperframes-tooling). Speech generation
  additionally requires the [VoxCPM2 service](INTEGRATIONS.md#voxcpm2-speech-service).

On a new checkout, copy `.env.example` to `.env` and configure the values needed
for your environment. Keep an existing `.env` when updating. Optional HeyGen
music credentials and speech-service setup are covered in
[service integrations](INTEGRATIONS.md).

All shell commands below run from the repository root.

## Start locally

The application backend is implemented in Rust. The browser application uses
React and Vite; Node.js also provides the pinned Codex and HyperFrames binaries.

```bash
# Run from the repository root.
npm ci
npm run web:build
npm run backend:service:start
```

The server listens on `127.0.0.1:8797` by default and lazily starts a separate Codex app-server for each signed-in user.
Each runtime uses its own Codex home. Platform model credentials stay on the
host; a scoped HTTP relay authenticates model requests without exposing those
credentials to Agent commands.

```bash
curl http://127.0.0.1:8797/health

curl -c /tmp/yingya-cookies http://127.0.0.1:8797/api/auth/login \
  -H 'content-type: application/json' -d '{"email":"you@example.com"}'

curl -b /tmp/yingya-cookies -X POST http://127.0.0.1:8797/api/codex/threads

curl -b /tmp/yingya-cookies -X POST http://127.0.0.1:8797/api/codex/threads/THREAD_ID/turns \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with YINGYA_OK only."}'
```

Open `http://127.0.0.1:8797/` for the public product homepage. The top-right login
button opens `/app`, where you can sign in with an email to enter your workspace.
Existing `/#/projects/<project-id>` and `/#/assets` links remain supported.
This preview does not verify email ownership. Use it only with trusted testers.
See [user sandboxes and usage](USER_SANDBOX.md) for admin setup, isolation,
usage accounting, and the handling of existing shared data.

Authenticated users get their own projects, assets, voices, and Agent runtime.
The default admin example in `.env.example` is `admin@yingya.local`.

The homepage includes six playable examples, category filters, copyable creation
briefs, a conversation workflow demo, and FAQs. Original Chinese brand/type films
are authored in `examples/marketing-film/` and `examples/marketing-type/`;
[media sources](../web/public/marketing/SOURCES.md) identify the HyperFrames examples.
Gallery videos load when opened. The hero pauses offscreen and does not autoplay
when reduced motion is enabled.

## Production runtime

The Yingya video Agent workspace uses the following flow. A new video
project creates an isolated HyperFrames workspace under
`data/users/<user-id>/projects/<project-id>/`; its Codex thread is created lazily when the
first queued turn starts. The browser uses `/api/agent-projects`, loads recent
events in pages, follows incremental updates over SSE, and renders artifacts
from `.yingya/manifest.json`. Render jobs are persisted before execution in
`.yingya/render-jobs.json`, so progress, failures, interrupted work, retry
attempts, and unique completed outputs survive browser and service restarts.

The project-owned `yingya-video-agent` skill enforces a production-plan
checkpoint before composition work and a draft checkpoint before final render.
Planning includes a text scene outline in `scenes.json`; production measures
narration before aligning scene timing and captions. Local revisions reuse
unaffected media. One HyperFrames `check` gate covers lint, runtime, layout,
motion, and contrast before durable Draft snapshots are registered. The backend
installs the complete workflow and explainer skill bundles, including their
references, at startup. Agent projects are the application's single supported
project model.

## Development services

For day-to-day development, run both services in named tmux sessions:

```bash
npm run backend:service:start   # yingya-backend, port 8797
npm run web:service:start       # yingya-frontend, port 8798
npm run backend:service:status
npm run web:service:status
tmux capture-pane -pt yingya-backend -S -100
tmux capture-pane -pt yingya-frontend -S -100
```

Open `http://127.0.0.1:8798/`. Vite listens on `0.0.0.0`, proxies API and asset
requests to the Rust server, and applies React and CSS changes through HMR.
After a backend change, run `npm run backend:service:restart`. Use
`npm run web:service:reload` to restart Vite when its configuration changes.
The start commands reuse an existing named session and forward the invoking
shell's environment, including proxy variables. Stop with
`npm run backend:service:stop` and `npm run web:service:stop`.

## Runtime configuration

The main runtime overrides are:

- `YINGYA_ADDR`: HTTP bind address; defaults to `127.0.0.1:8797`.
- `YINGYA_RESOURCE_DIR`: application resources; defaults to the repository root
  in debug builds.
- `YINGYA_APP_DATA_DIR`: mutable application data; defaults to `data/` in debug
  builds.
- `YINGYA_RUNTIME_DIR` and `YINGYA_CACHE_DIR`: machine-local runtime and cache
  roots; both default to `.runtime/` in debug builds.
- `YINGYA_AGENT_PROJECTS_DIR`, `YINGYA_ASSETS_DIR`, and `YINGYA_CODEX_HOME`:
  specific overrides derived from the roots above.
- `YINGYA_CODEX_BIN`, `YINGYA_WORKSPACE`, `YINGYA_CODEX_MODEL`, and
  `YINGYA_HYPERFRAMES_BROWSER_PATH`: Codex and HyperFrames integration settings.
- `YINGYA_CODEX_TURN_TIMEOUT_SECS`: inactivity timeout for Codex/HyperFrames
  work; defaults to 3600 seconds. Activity renews the deadline, so it is not a
  total production-time limit.
- `YINGYA_CODEX_NETWORK_ACCESS`: defaults to `true`, allowing workspace-write
  Codex turns to call local services such as VoxCPM2. Set it to `false` to
  disable that network access.
- `YINGYA_VITE_POLLING=1`: makes the Vite development server poll for file
  changes when native filesystem events are unavailable.

## Checks

Use the existing frontend tmux service for browser checks; setting
`YINGYA_UI_QA_URL` avoids starting another preview server.

```bash
npm run format:check
npm run lint:rust
npm run test:rust
npm run typecheck
npm run test:web
npm run web:build
YINGYA_UI_QA_URL=http://127.0.0.1:8798 npm run test:ui
YINGYA_UI_QA_URL=http://127.0.0.1:8798 node tests/marketing-ui-qa.mjs
```

Integration checks are available through `npm run test:heygen`,
`npm run test:tts`, `npm run test:services`, and `npm run test:hyperframes`.
The HyperFrames smoke check needs the local browser and rendering dependencies.

## Repository layout

- `src/`: Rust server and Codex app-server bridge.
- `web/`: static browser client served by the Rust application.
- `skills/`: project-owned Codex skills; these are source files.
- `scripts/`: development and skill installation utilities.
- `deploy/`: machine-service lifecycle scripts and operational documentation.
- `tests/fixtures/`: deterministic test inputs, including the HyperFrames smoke composition.
- `data/`: local uploads, generated assets, and video projects; ignored by Git.
- `.runtime/`: credentials, models, tool homes, caches, and local service state; ignored by Git.

See [`docs/PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) for ownership and
cleanup rules.

## Independent Codex installations on the development host

The lake user invokes its own CLI with `codex`, installed under
`/home/lake/.local/share/codex-cli`. Its launcher fixes the state directory to
`/home/lake/.codex`.

For Yingya, run `npm run codex -- <arguments>` from the repository root.
The project launcher uses its own `node_modules` package and
`.runtime/codex-home` for credentials, configuration, and history.
Both homes use file-based credential storage and require separate login.

```bash
# Personal CLI
codex login
codex --version

# Project CLI
cd /home/lake/workspaces/yingya
npm run codex:login
npm run codex:login-status
npm run codex -- --version
```

The launchers set CODEX_HOME only for their child process, so invoking one does
not change the other shell's environment. Direct invocation of the raw
node_modules binary bypasses this isolation; use the project launcher.

### 项目级 ChatGPT 套餐登录

**登录位置由启动脚本决定，不由终端当前目录决定。** 即使在本项目目录执行
`codex login --device-auth`，登录的仍是 `/home/lake/.codex` 下的个人 CLI。
Yingya 项目必须使用 `npm run codex -- ...` 或 `npm run codex:login`。
这里的“项目级”指本仓库隔离的 Codex home，不是 OpenAI API 平台的 Project。

远程服务器推荐使用设备码登录：

```bash
cd /home/lake/workspaces/yingya
npm run codex -- login --device-auth
```

打开终端显示的链接，用计划供 Yingya 使用的 ChatGPT 账号登录并输入本次设备码。
等待终端显示 `Successfully logged in`，再检查：

```bash
npm run codex:login-status
```

预期显示 `Logged in using ChatGPT`。仅浏览器登录成功不代表 CLI 已收到凭据。
若设备码登录不可用，检查 ChatGPT 安全设置或工作区管理员是否允许设备码登录；
也可用 `npm run codex:login` 进行浏览器回调登录。
账号需具备 Codex 使用权限；可用额度以该账号的实际套餐为准。

项目凭据保存在 `.runtime/codex-home/auth.json`，配置在同目录的 `config.toml`。
不要将凭据文件提交到 Git 或粘贴到聊天、日志中。更换项目账号时执行：

```bash
npm run codex -- logout
npm run codex -- login --device-auth
npm run codex:login-status
```

以上命令不修改个人 CLI 的登录。个人登录状态可单独用 `codex login status` 检查。
两个目录可以登录不同账号；若登录同一账号，隔离目录不会产生两份独立套餐额度。

### 项目级 OpenAI API Key

也可以使用 OpenAI API Key，替换项目 home 中的登录方式。API 用量按 API 账户计费，
不使用 ChatGPT 套餐额度。在 Bash 中通过隐藏输入传入密钥：

```bash
cd /home/lake/workspaces/yingya
read -rsp 'OpenAI API Key: ' yingya_openai_key
printf '\n'
printf '%s' "$yingya_openai_key" | npm run codex -- login --with-api-key
unset yingya_openai_key
npm run codex:login-status
```

切回 ChatGPT 套餐时，按上一节退出项目登录后重新进行设备码登录。

### 第三方 Responses API（仅项目 CLI）

**当前 Yingya 网页任务尚不支持通过配置切换第三方上游。**
`src/codex.rs` 为用户沙箱强制配置宿主模型中继，`src/model_relay.rs` 根据宿主凭据
固定转发到 ChatGPT 或 `https://api.openai.com/v1`。
因此，只修改项目 `config.toml` 或设置 `OPENAI_BASE_URL`，不会让网页任务改用第三方服务；
也不要把第三方密钥当作上一节的 OpenAI Key 登录到网页任务使用的凭据文件。

以下配置适用于通过 `npm run codex -- ...` 手动运行的项目 CLI。
在 `.runtime/codex-home/config.toml` 中合并以下配置，不要覆盖已有内容或重复已有表名。
使用独立 profile，通过显式参数选择，保留默认登录方式：

```toml
[model_providers.yingya_responses]
name = "Project Responses API"
base_url = "https://YOUR_PROVIDER.example/v1"
wire_api = "responses"
env_key = "YINGYA_RESPONSES_API_KEY"
requires_openai_auth = false

[profiles.yingya_responses]
model_provider = "yingya_responses"
model = "YOUR_PROVIDER_MODEL_ID"
```

替换服务地址与模型 ID。`base_url` 填服务商指定的 API 根地址，不要追加 `/responses`。
服务需兼容 Codex 使用的 Responses 流式响应和工具调用；只有 Chat Completions
兼容接口不足以使用此配置，其他能力也取决于服务商实际实现。

在项目目录启动，仅向本次 CLI 进程传入密钥：

```bash
read -rsp 'Responses API Key: ' yingya_responses_key
printf '\n'
YINGYA_RESPONSES_API_KEY="$yingya_responses_key" npm run codex -- --profile yingya_responses
unset yingya_responses_key
```

这种方式通过环境变量鉴权，不需要 `login --device-auth`，也不会把第三方密钥写入
项目 `auth.json`。`login status` 只检查已保存的登录，不能证明此第三方接口可用；
应在该 profile 下发起一次简单请求验证（会产生服务商用量）。不带 `--profile`
启动即可回到原有默认配置。

若要让 Yingya 网页任务也使用第三方服务，需要另外实现宿主中继的上游地址、鉴权、
模型选择及能力适配，同时保持真实密钥只在宿主侧使用。

### 后端如何使用项目登录

开发环境默认从 `.runtime/codex-home/auth.json` 读取宿主模型凭据。
网页用户自己的 Codex home 只保存中继占位凭据，真实授权由宿主中继注入，
详见 [用户沙箱与用量统计](USER_SANDBOX.md)。
中继会重新读取宿主凭据，因此重新登录后可重试任务，通常无需为此重启后端。

如果后端设置了 `YINGYA_CODEX_HOME` 或 `YINGYA_RUNTIME_DIR`，实际凭据目录可能不同；
`scripts/codex.sh` 仍固定使用仓库 `.runtime/codex-home`，不会自动跟随后端覆盖值。
自定义部署应显式使用与后端相同的 home，例如：

```bash
CODEX_HOME=/absolute/path/to/backend-codex-home ./node_modules/.bin/codex login --device-auth
CODEX_HOME=/absolute/path/to/backend-codex-home ./node_modules/.bin/codex login status
```

官方参考：[Codex 登录与鉴权](https://developers.openai.com/codex/auth)、
[自定义模型服务商](https://developers.openai.com/codex/config-advanced#custom-model-providers)。

### Upgrade each installation separately

```bash
npm install --global --prefix /home/lake/.local/share/codex-cli @openai/codex@latest
cd /home/lake/workspaces/yingya
npm run codex:upgrade
```
