# Service integrations

[Back to the product overview](../README.md) · [Documentation index](README.md)

Start with [installation and development](DEVELOPMENT.md) to run the application.
The API examples below use the authenticated cookie created by that guide.
All commands run from the repository root.

## Codex image generation

The Rust backend invokes Codex's native `imagegen` skill through app-server. It
accepts optional local reference images, listens for structured
`imageGeneration` completion items, copies each `savedPath` into the local
`data/users/<user-id>/assets/generated/` directory, and exposes the file under
`/assets/u/<user-id>/` with an ownership check.

Upload a reference image first (maximum request size: 25 MiB):

```bash
curl -b /tmp/yingya-cookies -X POST http://127.0.0.1:8797/api/assets/images \
  -F 'file=@reference.png;type=image/png'
```

Then create a thread and request an image:

```bash
curl -b /tmp/yingya-cookies -X POST http://127.0.0.1:8797/api/codex/threads/THREAD_ID/images \
  -H 'content-type: application/json' \
  -d '{
    "prompt": "Create a cinematic 16:9 seedling image with no text.",
    "referenceImages": ["/assets/u/USER_ID/uploads/REFERENCE_ID.png"]
  }'
```

Each returned image has two paths:

- `url`, such as `/assets/u/USER_ID/generated/ID.png`, for `<img src>` in the frontend.
- `hyperframesPath`, such as `assets/generated/ID.png`, for media elements in a
  HyperFrames composition.

Use the upload response's `url` as the reference image; only server-managed
asset paths belonging to the signed-in user are accepted. Generated
and uploaded images can be browsed by the asset workshop through
`GET /api/assets/images`; results are ordered newest first and include their
generation prompt or original upload name when available. Generated
files are copied rather than moved, so neither the personal Codex installation
nor its caches are modified. `data/` is runtime state and is not committed.

## HeyGen music and sound effects

The Rust backend can search HeyGen's semantic audio catalog and import selected
music or sound effects into a Yingya project. Keep the server-only credential in
the ignored `.env` file (copy `.env.example` for a new environment):

```bash
HEYGEN_API_KEY=your-key
```

Search the catalog without exposing the credential to the browser:

```bash
curl -b /tmp/yingya-cookies --get http://127.0.0.1:8797/api/heygen/audio \
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
Live composition previews are served through a short-lived,
read-only Yingya preview URL tied to the login session. No public Studio port is
started. The standalone Studio editor is not exposed in this mode.

Upgrades are explicit and update the pinned package versions and lockfile:

```bash
npm run codex:upgrade
npm run hyperframes:upgrade
```

Normal app-server runs disable automatic HyperFrames CLI and skill updates.

## VoxCPM2 speech service

VoxCPM2 is installed as an isolated vLLM-Omni service under `.runtime/` and
exposes an OpenAI-compatible Speech API. See
[`deploy/voxcpm2/README.md`](../deploy/voxcpm2/README.md) for lifecycle commands,
request examples, voice cloning, and streaming output.

The service listens on `127.0.0.1:8791` by default; local clients use
`http://127.0.0.1:8791`. Install the project-local Codex integration with
`npm run voxcpm2:skill:install`, then invoke `$voxcpm2-tts` from Codex.

The web composer includes a project voice library. Users can preview the
default voice, create and save a voice from a natural-language description, or
clone an authorized 1–30 second reference recording with its exact transcript.
Each project stores its selected VoxCPM2 voice in `.yingya/voice.json`; every
narration segment and revision reuses that voice ID for consistent timbre.
