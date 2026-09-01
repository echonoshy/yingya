# yingya
映芽 · Yingya，通过对话创作视频，让想法长成影像。

## Rust backend

The application backend is implemented in Rust. Node.js is currently used only
to install a pinned Codex native binary and will also be used by HyperFrames.

```bash
npm install
npm run web:build
cargo run
```

The server listens on `127.0.0.1:8797` by default and starts Codex app-server
over local stdio with the isolated `.runtime/codex-home` credential.

```bash
curl http://127.0.0.1:8797/health

curl -X POST http://127.0.0.1:8797/api/codex/threads

curl -X POST http://127.0.0.1:8797/api/codex/threads/THREAD_ID/turns \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with YINGYA_OK only."}'
```

Open `http://127.0.0.1:8797/` for the Yingya video Agent workspace. A new video
project creates an isolated HyperFrames workspace under
`data/video-projects/<project-id>/`; its Codex thread is created lazily when the
first queued turn starts. The browser uses `/api/agent-projects`, loads recent
events in pages, follows incremental updates over SSE, and renders artifacts
from `.yingya/manifest.json`.

The project-owned `yingya-video-agent` skill enforces a production-plan
checkpoint before composition work and a draft checkpoint before final render.
It also requires HyperFrames lint, validate, and inspect gates and durable Draft
snapshots. Agent projects are the application's single supported project model.

During frontend development, run `npm run web:dev` and open
`http://127.0.0.1:8798/`. Vite listens on `0.0.0.0`, proxies API and asset
requests to the Rust server, and applies React changes through HMR. The local
user service runs the same command with automatic restart; use
`npm run web:service:status` to inspect it or `npm run web:service:reload` to
restart it after configuration changes.

## Codex image generation

The Rust backend invokes Codex's native `imagegen` skill through app-server. It
accepts optional local reference images, listens for structured
`imageGeneration` completion items, copies each `savedPath` into the local
`data/assets/generated/` directory, and exposes the file under `/assets/`.

Upload a reference image first (maximum request size: 25 MiB):

```bash
curl -X POST http://127.0.0.1:8797/api/assets/images \
  -F 'file=@reference.png;type=image/png'
```

Then create a thread and request an image:

```bash
curl -X POST http://127.0.0.1:8797/api/codex/threads/THREAD_ID/images \
  -H 'content-type: application/json' \
  -d '{
    "prompt": "Create a cinematic 16:9 seedling image with no text.",
    "referenceImages": ["/assets/uploads/REFERENCE_ID.png"]
  }'
```

Each returned image has two paths:

- `url`, such as `/assets/generated/ID.png`, for `<img src>` in the frontend.
- `hyperframesPath`, such as `assets/generated/ID.png`, for media elements in a
  HyperFrames composition.

Only server-managed `/assets/` paths are accepted as reference images. Generated
files are copied rather than moved, so neither the personal Codex installation
nor its caches are modified. `data/` is runtime state and is not committed.

Runtime settings can be overridden with `YINGYA_ADDR`, `YINGYA_CODEX_BIN`,
`YINGYA_CODEX_HOME`, `YINGYA_WORKSPACE`, `YINGYA_CODEX_MODEL`, and
`YINGYA_HYPERFRAMES_BROWSER_PATH`. The assets directory defaults to
`data/assets/` and can be changed with `YINGYA_ASSETS_DIR`. Codex/HyperFrames
jobs use a 3600-second inactivity timeout by default, configurable with
`YINGYA_CODEX_TURN_TIMEOUT_SECS`. Activity from the current turn renews the
deadline, so this setting does not cap the total production time.
`YINGYA_CODEX_NETWORK_ACCESS` defaults to `true`, allowing the workspace-write
sandbox to call local services such as the VoxCPM2 TTS API. Set it to `false` to
disable network access for Codex turns.
The new project root can be overridden with `YINGYA_AGENT_PROJECTS_DIR`.

## HeyGen music and sound effects

The Rust backend can search HeyGen's semantic audio catalog and import selected
music or sound effects into a Yingya project. Keep the server-only credential in
the ignored `.env` file (copy `.env.example` for a new environment):

```bash
HEYGEN_API_KEY=your-key
```

Search the catalog without exposing the credential to the browser:

```bash
curl --get http://127.0.0.1:8797/api/heygen/audio \
  --data-urlencode 'query=warm restrained product background music' \
  --data-urlencode 'type=music' \
  --data-urlencode 'limit=8'
```

Use `type=sound_effects` for effects. The web asset workspace provides search,
preview, and import controls. Importing re-runs the search on the server to
refresh HeyGen's short-lived signed URL, downloads the audio into the project's
`assets/audio/` directory, and records the provider metadata in `assets.json`.
The build Agent treats unassigned music as a global background track and places
scene-assigned sound effects at relevant actions or transitions.

Install the project-owned Codex integration into the isolated runtime:

```bash
npm run heygen:skill:install
```

After restarting Yingya, Codex can invoke `$heygen-audio` to search music or
sound effects, import a selected result, inspect project audio, and assign an
effect to a scene. The Skill calls the local Yingya API and never reads or
exposes the HeyGen credential.

## HyperFrames tooling

HyperFrames CLI is pinned as a project dependency. Its core skills are installed
only into the isolated Codex home under `.runtime/`. The installer also gives
HyperFrames its own isolated `HOME`, because its underlying skills installer does
not use `CODEX_HOME` when choosing agent integration directories.

```bash
npm run hyperframes:version
npm run hyperframes:info
npm run hyperframes:doctor
npm run hyperframes:browser:ensure
npm run hyperframes:browser:path
npm run hyperframes:skills:install
```

The pinned Chrome Headless Shell is stored under
`.runtime/hyperframes-home/.cache/`. The Rust backend discovers that executable
at startup and passes it to Codex app-server as `HYPERFRAMES_BROWSER_PATH`.

Upgrades are explicit and update the pinned package versions and lockfile:

```bash
npm run codex:upgrade
npm run hyperframes:upgrade
```

Normal app-server runs disable automatic HyperFrames CLI and skill updates.

## VoxCPM2 speech service

VoxCPM2 is installed as an isolated vLLM-Omni service under `.runtime/` and
exposes an OpenAI-compatible Speech API. See
[`deploy/voxcpm2/README.md`](deploy/voxcpm2/README.md) for lifecycle commands,
request examples, voice cloning, and streaming output.

The default endpoint is `http://127.0.0.1:8791`. Install the project-local
Codex integration with `npm run voxcpm2:skill:install`, then invoke
`$voxcpm2-tts` from Codex.

## Repository layout

- `src/`: Rust server and Codex app-server bridge.
- `web/`: static browser client served by the Rust application.
- `skills/`: project-owned Codex skills; these are source files.
- `scripts/`: development and skill installation utilities.
- `deploy/`: machine-service lifecycle scripts and operational documentation.
- `tests/fixtures/`: deterministic test inputs, including the HyperFrames smoke composition.
- `data/`: local uploads, generated assets, and future video projects; ignored by Git.
- `artifacts/`: reproducible renders, snapshots, and exported files; ignored by Git.
- `.runtime/`: credentials, models, tool homes, caches, and local service state; ignored by Git.

See [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md) for ownership and
cleanup rules.
