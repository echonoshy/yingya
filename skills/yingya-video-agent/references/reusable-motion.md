# Reuse installed scenes

Use the unified catalog when choosing an unfamiliar effect or checking options:

```sh
node "$YINGYA_COMPONENT_LIBRARY" catalog
node "$YINGYA_COMPONENT_LIBRARY" view --component beam-network
```

Local `catalog` (alias `list`) needs no project. Its entries are the maintained
source of truth for component IDs, capabilities, provenance and configuration;
use `view` and the installed README for details instead of guessing options.
The catalog covers Anime.js scenes, a Magic UI network scene and a Three.js model
stage. Choose by the communication task: a linear sequence uses `flow-path`,
branching or converging information uses `beam-network`, and measured numerical
comparisons use `number-compare`. `title-reveal` handles a central title;
`model-stage` displays a supplied 3D model. Prefer an existing recipe when it
fits; choose another implementation when the requested effect benefits from it.
Install only the selected packs. Never invent metrics
or replace recorded evidence with demo content.

Once production is authorized, install only the selected component's pack:

```sh
node "$YINGYA_COMPONENT_LIBRARY" install --component beam-network --project .
```

The local installer works offline and preserves edited files. Inspect any
conflict and reuse existing source or deliberately retain a separate version;
never delete user changes to force an install. Anime.js resources go to
`assets/animejs/`; the other local packs go to `assets/yingya-components/`.
Read the installed pack README and load the returned local script/style paths.
Keep its dependency versions, catalog, attribution and licenses with the draft.
For effects not covered by this catalog, follow
[third-party-components.md](third-party-components.md) to inspect and adapt the
original registry implementation.

## Shared video time

Keep the existing paused `window.__timelines.main` GSAP timeline for scene
visibility, transitions and media scheduling. Give each component a container
with resolved dimensions. The component owns its inner DOM or canvas; configure
its content and appearance and animate the outer container with GSAP. Avoid two
animation systems writing the same element/property.

Magic UI and Three.js packs expose
`window.YingyaComponents.createScene(container, { component, startSeconds,
durationSeconds, ...options })`. It synchronously returns a handle with `ready`,
`renderAt(globalSeconds)` and `dispose()`, and registers itself with the shared
clock. Await `ready` during composition initialization and surface a rejected
load as an error; a blank canvas is not a loaded model. The HyperFrames render
clock and Yingya preview send `hf-seek`; no extra registration, GSAP `onUpdate`
binding or independent animation loop is needed for these packs. The clock waits
for initial `ready` and any promise returned by `renderAt` for the current frame
through `hf-seek.waitUntil`. See the third-party reference for React commit timing.

Use absolute seconds for `startSeconds` and `renderAt`; the component derives
and clamps local time by subtracting its start once. Ordinary section
`data-start` does not offset this API. Do not add another scene offset. Dispose
replaced/unmounted handles so event listeners, GPU geometry, materials and
textures are released.

Anime.js keeps its existing `YingyaAnime.createScene(container, config)` API and
paused `window.__hfAnime` registration. Read `assets/animejs/README.md` for its
configuration and `--yga-*` style variables. Do not register these components in
`YingyaComponents` again, call `play()`, or add their timelines to GSAP. The
legacy `node "$YINGYA_ANIME_COMPONENTS" install --project .` remains compatible.
Custom Anime effects use the installed v4 API, `autoplay: false`, finite duration
and synchronous native registration; its seek units are milliseconds, unlike
the unified scene handle's seconds.

## Local 3D assets

`model-stage` composes an existing local GLB/glTF model with lights, camera motion
and any supported model animation, all driven by video time. It is not an AI
model generator or a cloud asset marketplace. Use an authorized supplied model
or a project-local asset with recorded source and license. Preserve glTF buffer
and texture dependencies and their relative paths in the project snapshot.
Prefer a self-contained GLB for uploads: conversation and library uploads assign
generated filenames, so uploading a glTF file, buffers and textures separately
does not preserve their references. Assemble the dependency directory inside
the project and verify its relative URIs before using a multi-file glTF. Models
are ordinary attachments; do not assume a dedicated model-library UI. Do not let
the final composition fetch mutable remote textures, models or scripts.

Check supported formats and options in the catalog/README. Draco, Meshopt and
KTX2 decoding are not installed for this pack; use an ordinary uncompressed GLB
or report the specific unsupported dependency instead of silently substituting
another model. Fix missing resources before capturing frames. Keep required
resource readiness explicit and dispose GPU resources when replacing a scene.

## Verify the result

Use the existing production runner's full check and render gates. Review Chinese
layout at the actual output dimensions and use the project's own design tokens.
Inspect first/revealed/held/transition frames; seek forward, backward and directly
to the same timestamp and compare visible state. Random choices must have a
fixed seed and visual state must not depend on wall-clock time or accumulated
independent frames.

Verify the decoded MP4, including final numbers, node relationships, model
visibility, camera framing, text readability and narration sync. Snapshot local
resources, source, locks and licenses so the draft remains renderable without
registry access. Record the component/version used with each scene's evidence.
An installed component or successful browser preview alone is not a verified
video.
