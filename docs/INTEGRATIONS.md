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

The selected assistant model orchestrates the turn; the pinned Codex SDK's
native tool uses `gpt-image-2` for drawing. The host model relay forwards only
`POST codex/images/generations` and `POST codex/images/edits` for this tool,
validates that image model separately, and attaches the host login without
exposing provider credentials to tenant sandboxes. Image results count as
generated media; image usage is not billed at assistant token prices. Unknown
or interrupted image calls retain their media reservation for reconciliation.

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
- `projectPath`, such as `assets/generated/ID.png`, for media elements in a
  Remotion composition.

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

Yingya automatically installs the bundled skill into each user's runtime from
the current release. No manual skill-install command is needed for website tasks.
To use the skill manually with the repository's host Codex CLI:

```bash
npm run heygen:skill:install
```

Run `npm run codex` and invoke `$heygen-audio` to search music or
sound effects, import a selected result, inspect project audio, and assign an
effect to a scene. The Skill calls the local Yingya API and never reads or
exposes the HeyGen credential.

## Remotion runtime and browser

Remotion, Player, bundler and renderer are pinned to the same version. The backend
uses `runtime/remotion/cli.mjs` for project initialization, build, check and render.
Prepare Chromium and the native renderer after installing npm dependencies:

```bash
npm run browser:ensure
npm run browser:path
python3 scripts/setup-remotion.py
npm run test:remotion
npm run test:remotion:browser
```

Browser discovery uses Playwright's pinned Chromium, or `YINGYA_BROWSER_PATH`.
The backend resolves its executable before entering the user sandbox and mounts
it read-only. The sandbox passes the configured wrapper to Remotion and Playwright.
Agent turns do not install browsers or shared dependencies. Previews use the native
Remotion Player inside an opaque, read-only iframe; no public Studio port is opened.

See [Remotion runtime contract](REMOTION_RUNTIME.md) for source files, frame
scheduling, media declarations and the actual scope of validation.

## React component sources

`$YINGYA_COMPONENT_LIBRARY` searches/imports editable React Bits and Magic UI
sources using the pinned shadcn CLI and its user-isolated MCP. Commands are
`init`, `search`, `view`, `add`, `diagnose` and `build`, with an explicit `--project`.
Registry imports retain sources, dependency locks and attribution in
`component-library/`. Build output and used assets belong in the source snapshot.

```bash
node "$YINGYA_COMPONENT_LIBRARY" search --project . --registry all --query text
node "$YINGYA_COMPONENT_LIBRARY" view --project . --component @magicui/animated-beam
node "$YINGYA_COMPONENT_LIBRARY" add --project . --component @magicui/animated-beam
node "$YINGYA_COMPONENT_LIBRARY" diagnose --project . --component @magicui/animated-beam
```

Adapt imported effects to Remotion frames before using them in a video. Static
import diagnostics do not prove repeatable seeking or rendered output. Preserve
licenses, CSS and resource paths; declared audio/video remain in `remotion.json`.
Read [component adaptation](../skills/yingya-video-agent/references/third-party-components.md)
for the authoring contract. `npm run test:components` checks the source importer.

## Video design references

The bundled `yingya-video-agent` progressively loads a pinned design reference
pack through [`visual-direction.md`](../skills/yingya-video-agent/references/visual-direction.md).
Baoyu contributes selected information layouts, diagram structure and slide
style references; Frontend Slides contributes a motion reference. Original
files, hashes, exact commits and MIT notices are retained in
[`design/PROVENANCE.json`](../skills/yingya-video-agent/references/design/PROVENANCE.json).
Yingya's adaptation guides translate these references into editable React/SVG
compositions driven by Remotion frames. Upstream skill workflows, scripts, fonts
and image-generation backends are not installed by this integration.

The Agent selects structure and treatment from the content, records the choice
in the existing plan and scene fields, and preserves approved decisions and
selected reference copies with each draft. The pack adds no style picker,
manifest phase, schema migration or extra approval checkpoint. Runtime helpers
and real footage retain their existing contracts. Customer films are not
restricted to the included examples.

The current tenant initializer recursively copies the complete video skill
bundle from release resources. Publish changes through the normal release
workflow and verify the active worker's reference files; a developer's local
skill installation does not update website tasks. Run `npm run test:design` for
offline provenance and reference-link integrity, plus the skill validator and
actual controlled video tasks for behavioral validation. Current plan review includes real keyframes before approval, as specified in the [video production workflow](VIDEO_PRODUCTION_WORKFLOW.md).

## VoxCPM2 speech service

VoxCPM2 is installed as an isolated vLLM-Omni service under `.runtime/` and
exposes an OpenAI-compatible Speech API. See
[`deploy/voxcpm2/README.md`](../deploy/voxcpm2/README.md) for lifecycle commands,
request examples, voice cloning, and streaming output.

The service listens on `127.0.0.1:8791` by default; local clients use
`http://127.0.0.1:8791`. Website tasks receive the bundled `$voxcpm2-tts` skill
automatically. For manual use through `npm run codex`, install the host copy
with `npm run voxcpm2:skill:install`.

The Assets → Generate → Voices tab (`/app#/assets/generate/voice`) owns creation and management;
the composer provides selection and preview. Users can search, preview custom
text, download samples, edit labels/descriptions, remove library entries, or
choose the default for new projects. Voices can be generated from a description
or cloned from an authorized 1–30 second recording (up to 10 MB) with its exact
transcript. Browser and backend validation reject unreadable or out-of-range
samples. `PATCH /api/voices/{id}` edits display metadata; `DELETE` removes the
voice from the selectable library. IDs stay stable and existing projects retain
synthesis access; storage and isolation rules are in [USER_SANDBOX.md](USER_SANDBOX.md).
The UI submits durable multipart tasks through `POST /api/assets/voice-jobs` and
polls the same resource with GET. Accepted work continues after the browser closes;
identical `clientRequestId` retries reuse the record and media charge. Clone samples
are retained privately for authorized retries. Synchronous voice endpoints remain
available for compatibility. Job-history DELETE endpoints clear terminal entries
without removing voices; completed-only bulk cleanup leaves active and failed jobs.
Receipt retention and cleared-ID retry rules are in [USER_SANDBOX.md](USER_SANDBOX.md).
Each project stores its selected VoxCPM2 voice in `.yingya/voice.json`; every
narration segment and revision reuses that voice ID for consistent timbre.

## MiniMax H3 generated footage

The bundled `skills/minimax-h3-local` is copied into each worker's Codex home,
including its Python standard-library client and source-linked prompt guide.
The production workflow routes suitable shots through Image Gen first-frame
creation, H3 motion/audio generation, and Remotion assembly. See
[generated-footage.md](../skills/yingya-video-agent/references/generated-footage.md).

The service is `http://140.143.229.103:8910`, without a cloud API key. The client
honors the sandbox proxy; its gateway permits only this exact public host/port
and the health, capabilities, submission and individual-job routes. Shared job
listing is excluded. Other nonstandard ports and private network destinations
remain blocked. Do not bypass the sandbox proxy. `H3_URL` / `--url` remain useful
for standalone client tests; they do not grant additional sandbox destinations.

Sampler overrides are optional: the service profile supplies steps, quality and
flow shifts (turbo8 at integration time). The output is 768p-short-edge, 24fps
audiovisual material; measure each downloaded clip before scheduling it. Native
2K regeneration and hosted Context-IR are not available. Generation receipts and
prompts stay in the current project; recovery polls the original job rather than
submitting another one. No persistence schema or user-facing editor was added.

## Production skill set and offline media tools

Yingya publishes `yingya-video-agent`, `yingya-captions`, `voxcpm2-tts`,
`heygen-audio` and `minimax-h3-local`; system `imagegen` remains available.
`faceless-explainer` is merged into the main skill's storytelling reference.
The production app-server disables developer maintenance skills using per-process
`skills.config` overrides; SDK files and the developer Codex home are preserved.
Plan approval authorizes checked, immutable video delivery. A separate draft
checkpoint is retained only for explicitly requested staged review or legacy tasks.

`npm run captions:setup` provisions a hashed Python environment and pinned
faster-whisper small model with CPU int8 inference. Release builds provision it
and mount it read-only into worker sandboxes. The project tool
`python3 "$YINGYA_CAPTIONS"` supports health, transcribe, check and export-srt;
it decodes audio through FFmpeg and downloads nothing during a task. Source hashes,
raw word timestamps and script comparisons accompany the JSON captions. Recognition,
factual text and sentence boundaries still need review; automatic recognition is
not a guarantee of 300 ms timing accuracy. See [caption skill](../skills/yingya-captions/SKILL.md).

`python3 "$YINGYA_AUDIO_TOOLS"` measures loudness and prepares versioned WAVs with
fades, two-pass normalization or narration-controlled music ducking. All resulting
tracks still require explicit `remotion.json.media` registration and listening review.
See [audio mixing](../skills/yingya-video-agent/references/audio-mixing.md).

The offline component tool now provides real `catalog`, `view --component explain-*`
and `install --project . --component explain-*` operations. Six React/Remotion
explanation primitives and a sentence caption layer are copied as editable project
source; public React Bits/Magic UI sources continue to use search/view/add.
See [native authoring](../skills/yingya-video-agent/references/remotion-authoring.md).
Validate with `npm run test:media-tools`, `npm run test:native-explain`, skill
validation, and `cargo test caption_runtime_and_native_catalog_work_inside_user_sandbox -- --ignored`.
