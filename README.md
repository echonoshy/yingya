# yingya
映芽 · Yingya，通过对话创作视频，让想法长成影像。

## Rust backend

The application backend is implemented in Rust. Node.js is currently used only
to install a pinned Codex native binary and will also be used by HyperFrames.

```bash
npm install
cargo run
```

The server listens on `127.0.0.1:3000` by default and starts Codex app-server
over local stdio with the isolated `.runtime/codex-home` credential.

```bash
curl http://127.0.0.1:3000/health

curl -X POST http://127.0.0.1:3000/api/codex/threads

curl -X POST http://127.0.0.1:3000/api/codex/threads/THREAD_ID/turns \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with YINGYA_OK only."}'
```

Open `http://127.0.0.1:3000/` for the minimal image-generation UI.

## Codex image generation

The Rust backend invokes Codex's native `imagegen` skill through app-server. It
accepts optional local reference images, listens for structured
`imageGeneration` completion items, copies each `savedPath` into the local
`data/assets/generated/` directory, and exposes the file under `/assets/`.

Upload a reference image first (maximum request size: 25 MiB):

```bash
curl -X POST http://127.0.0.1:3000/api/assets/images \
  -F 'file=@reference.png;type=image/png'
```

Then create a thread and request an image:

```bash
curl -X POST http://127.0.0.1:3000/api/codex/threads/THREAD_ID/images \
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
`data/assets/` and can be changed with `YINGYA_ASSETS_DIR`. Long
Codex/HyperFrames jobs default
to a 900-second timeout, configurable with `YINGYA_CODEX_TURN_TIMEOUT_SECS`.
`YINGYA_CODEX_NETWORK_ACCESS` defaults to `true`, allowing the workspace-write
sandbox to call local services such as the VoxCPM2 TTS API. Set it to `false` to
disable network access for Codex turns.

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
