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

# Use an account already created by an admin or registered with an invitation.
curl -c /tmp/yingya-cookies http://127.0.0.1:8797/api/auth/login \
  -H 'content-type: application/json' -d '{"email":"you@example.com","password":"YOUR_PASSWORD"}'

curl -b /tmp/yingya-cookies -X POST http://127.0.0.1:8797/api/codex/threads

curl -b /tmp/yingya-cookies -X POST http://127.0.0.1:8797/api/codex/threads/THREAD_ID/turns \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with YINGYA_OK only."}'
```

Open `http://127.0.0.1:8797/` for the public product homepage. The top-right login
button opens `/app`, where you register with an invitation, email, and password,
then sign in with email and password to enter your workspace.
Existing `/#/projects/<project-id>` and `/#/assets` links remain supported.
This preview does not send email verification; distribute invitations to trusted testers.
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
- `YINGYA_CODEX_HOME`: host model credentials and installed skills; defaults to
  `<runtime>/codex-home`. User projects and assets always live under
  `<app-data>/users/<user-id>/`; legacy shared-directory overrides do not
  relocate signed-in users' data.
- `YINGYA_CODEX_BIN`, `YINGYA_CODEX_MODEL`, and
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

Browser checks reuse the frontend tmux service at `http://127.0.0.1:8798` by
default. Start it with `npm run web:service:start`; set `YINGYA_UI_QA_URL` to
check another existing service. The checks do not start a preview server.

```bash
npm run format:check
npm run lint:rust
npm run test:rust
npm run typecheck
npm run test:web
npm run web:build
YINGYA_UI_QA_URL=http://127.0.0.1:8798 npm run test:ui
npm run test:marketing
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

## Project model login

Use the repository launcher, which runs the pinned local Codex package with
`.runtime/codex-home`. A personal `codex` installation may use a different home;
changing the current directory does not switch its credentials.

```bash
npm run codex -- login --device-auth
npm run codex:login-status
```

Complete the device login shown in the terminal and wait for CLI success.
For browser callback login, use `npm run codex:login`. To change the project
account, run `npm run codex -- logout` before logging in again.

For host OpenAI API credentials, use hidden input in Bash:

```bash
read -rsp 'OpenAI API Key: ' yingya_openai_key
printf '\n'
printf '%s' "$yingya_openai_key" | npm run codex -- login --with-api-key
unset yingya_openai_key
npm run codex:login-status
```

The backend reads host credentials from `YINGYA_CODEX_HOME/auth.json`, defaulting
to `.runtime/codex-home/auth.json`. User tool homes contain relay placeholders;
the host injects upstream credentials. After a new login, retry the task.
The current relay supports the configured host OpenAI/ChatGPT credentials;
third-party upstreams require backend implementation and cannot be enabled by
changing a CLI profile. See [isolation and relay behavior](USER_SANDBOX.md).

The project launcher always uses `.runtime/codex-home`. If the backend overrides
`YINGYA_CODEX_HOME` or `YINGYA_RUNTIME_DIR`, run the pinned CLI with that same
home explicitly when logging in. Keep credential files out of version control.

Upgrade the project CLI with `npm run codex:upgrade`; it updates the dependency
and lockfile. Check the installed version with `npm run codex:version`.
