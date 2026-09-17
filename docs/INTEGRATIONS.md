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

## Component library and video animation

`$YINGYA_COMPONENT_LIBRARY` is the video Agent's unified entrypoint for local
scene packs and public React Bits / Magic UI components. `catalog` (alias `list`)
reads the installed scene catalog without a project. Select an existing
implementation before importing or building another effect; install only the
pack needed for the scene. The catalog is the maintained source of truth for
component availability, provenance and configuration.

Anime.js supplies text, linear process and numerical comparison scenes. The
Magic UI `beam-network` pack handles branching and converging connections;
Three.js `model-stage` displays a supplied local GLB/glTF model with lighting,
camera movement and supported animation. It does not generate a new 3D model or
provide a cloud model marketplace. The public registries cover additional
effects; their separately licensed Pro products are not integrated.

Yingya installs a pinned shadcn CLI with the application and configures its MCP
in each user's isolated Codex runtime. `runtime/component-registry/components.json`
declares the `@react-bits` and `@magicui` registry endpoints. Discovery covers
their public registries rather than a fixed list of cached effects.
Configuration belongs to the Yingya runtime and does not alter the host user's
personal Codex settings.

The managed server is named `yingya_shadcn`. `src/component_library.rs` supplies
the release-local Node/shadcn command and the read-only working directory
`runtime/component-registry/`; that directory's `components.json` declares the
registry. `src/codex.rs` reapplies this configuration when the user's app-server
starts or restarts. The sandbox exposes `$YINGYA_COMPONENT_LIBRARY` and forwards
its existing egress proxy to the MCP process.

The video Agent inspects the local catalog, then uses registry search and source
import when the chosen scene needs another implementation:

```bash
node "$YINGYA_COMPONENT_LIBRARY" catalog
node "$YINGYA_COMPONENT_LIBRARY" view --component model-stage
node "$YINGYA_COMPONENT_LIBRARY" install --project . --component beam-network
node "$YINGYA_COMPONENT_LIBRARY" search --project . --registry all --query text
node "$YINGYA_COMPONENT_LIBRARY" view --project . --component @react-bits/Aurora-TS-CSS
node "$YINGYA_COMPONENT_LIBRARY" add --project . --component @magicui/animated-beam
node "$YINGYA_COMPONENT_LIBRARY" diagnose --project . --component @magicui/animated-beam
node "$YINGYA_COMPONENT_LIBRARY" build --project . --entry component-library/entry.tsx --out assets/components
```

These examples run from a video project with Yingya's runtime environment, not
from the application repository. `search --registry` accepts `@react-bits`,
`@magicui` or `all` (the default). Local pack installation copies offline resources
into `assets/yingya-components/`, or `assets/animejs/` for Anime.js. The legacy
Anime installer remains compatible. Registry imports use `component-library/`
for source, project-local dependencies, locks and attribution; the build places
bundled JS/CSS in `assets/components/`, including compiled Tailwind styles when
used. These locations serve different roles and are retained in each snapshot.

These commands are available choices, not a mandatory sequence. The Agent can
reuse existing source, select a known pack or search for another implementation.
`add` returns static import diagnostics alongside retained source: `needs-repair`
identifies missing packages/assets or source errors, while `imports-resolved`
only confirms JavaScript/TypeScript imports resolve. `diagnose` rechecks an
existing import after edits, restoring locked dependencies if needed. Neither
status verifies CSS resources, runtime URLs, video timing or rendered output.
Optional npm dependencies follow npm's precedence rules; packages omitted on
the current platform do not prevent collecting notices for installed packages.

Validated registry `css`/`cssVars` pass through shadcn's stylesheet updater;
registry environment-variable changes are rejected. Bare Magic UI dependencies
such as Bento Grid's `button` resolve to the official shadcn `new-york-v4`
registry. This source is dependency-only: public search and direct import remain
React Bits and Magic UI. The importer keeps each source URL, hash and MIT notice,
and the bundle includes dependency licenses. Required scaffold dependencies and
neutral semantic-color fallbacks are supplied without global element resets;
the video can override inherited theme variables such as `--primary`.

Magic UI and Three.js packs share the `YingyaComponents.createScene` API and a
clock driven by HyperFrames/Yingya preview `hf-seek` events. `ready` covers initial
resources; a promise returned by `renderAt(globalSeconds)` covers that frame's
commit and is awaited through `hf-seek.waitUntil`. React adapters can commit
synchronously with `flushSync` or return that precise commit promise. Components
also expose disposal. Anime.js
continues to use `YingyaAnime` and `window.__hfAnime` without a second clock
registration. The existing GSAP composition timeline owns scene visibility,
transitions and media timing. For raw registry source, the Agent authors the
mounting and time adapter; importing or bundling alone does not make scroll,
pointer, wall-clock or simulation effects seekable.

The production skill prefers reusing and composing original implementations.
It preserves each video's approved aesthetics, including shader, particle and
3D effects, and checks deterministic seeking and decoded MP4 frames. Source,
dependency locks, licenses, adaptation code and built assets belong in the
immutable draft snapshot. Models include their source license, buffers and
textures, with project-relative resource paths. The model pack supports ordinary
local GLB/glTF; Draco, Meshopt and KTX2 decoding are not bundled. Required resource
failures must be resolved before rendering. Project-local component dependencies
are permitted; installing or upgrading shared CLIs during a video turn remains
prohibited.

Conversation and asset-library upload APIs accept GLB/glTF as general attachments.
Prefer a self-contained GLB: uploads assign generated filenames and do not
rewrite glTF buffer/texture references. Multi-file glTF assets must be assembled
inside the project with their dependency directory and relative URIs intact.
The upload request limit remains 25 MiB; the model renderer's separate loading
limit does not increase the API upload limit. There is no separate model-market
or model-library UI.

See the maintained Agent instructions in
[`reusable-motion.md`](../skills/yingya-video-agent/references/reusable-motion.md)
for installed packs and
[`third-party-components.md`](../skills/yingya-video-agent/references/third-party-components.md)
for registry imports, timing adaptation, license handling and verification.
Registry discovery follows [React Bits](https://reactbits.dev/),
[Magic UI](https://magicui.design/) and [shadcn MCP](https://ui.shadcn.com/docs/mcp).
Read the selected source's license: public Magic UI uses MIT; React Bits includes
Commons Clause restrictions on redistribution of the components themselves.
Retain the actual version's notices with the imported files.

Run `npm run test:components` for local import/build and browser asset checks.
Set `YINGYA_COMPONENT_LIVE_TESTS=1` for the same suite to also search, download,
build and reconstruct real registry components, including Magic UI keyframes,
default shadcn dependencies and their browser styles. `npm run test:components:live
-- /absolute/path/to/fresh-fixture` imports Aurora and SplitText, adapts their
timing and checks deterministic browser seeking; run HyperFrames check/render
on that fixture separately to verify the MP4 output. Reuse its source with
`--verify-only` when repeating browser checks.
`npm run test:components:showcase -- /absolute/path/to/fresh-fixture` generates
the three-scene local-pack fixture; use the same path plus `--verify-only` to
check resource loading and seeking. Run HyperFrames check/render separately on
that fixture to verify the actual MP4.

## Video design references

The bundled `yingya-video-agent` progressively loads a pinned design reference
pack through [`visual-direction.md`](../skills/yingya-video-agent/references/visual-direction.md).
Baoyu contributes selected information layouts, diagram structure and slide
style references; Frontend Slides contributes a motion reference. Original
files, hashes, exact commits and MIT notices are retained in
[`design/PROVENANCE.json`](../skills/yingya-video-agent/references/design/PROVENANCE.json).
Yingya's adaptation guides translate these references into editable HTML/SVG
scenes and the existing video clock. Upstream skill workflows, scripts, fonts
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
actual controlled video tasks for behavioral validation. See the
[integration plan](VIDEO_DESIGN_SKILLS_INTEGRATION.md) for scope and acceptance.

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
