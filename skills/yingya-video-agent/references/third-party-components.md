# Third-party components for video

Use this route for expressive titles, transitions, backgrounds, particles,
shaders and other effects that benefit from an existing implementation. Search
for the visual role in the approved story, inspect real source and examples,
then combine and adapt suitable components. The unified local catalog described
in [reusable-motion.md](reusable-motion.md) offers existing adapters to reuse
when they fit; choose the appropriate route without redundant searches.
React Bits and Magic UI remain full
discoverable registries; the local catalog is not a whitelist of effects.
Existing project adaptations are reusable starting points, not a reason to
restrict a new design.

Keep the video's own design direction. Yingya's calm product UI rules do not
restrict a customer's video. Preserve actual supplied footage and important
editable text; effects support its message and can be bold when requested.

## Discover, inspect, import

The host supplies a pinned shadcn CLI and a shadcn MCP in the tenant's Codex
runtime. Use available MCP registry search/view tools for `@react-bits` and
`@magicui` public components; Magic UI Pro content is not integrated.
The installed project helper provides the same discovery route when MCP is
unavailable and handles local imports and builds:

```sh
node "$YINGYA_COMPONENT_LIBRARY" search --project . --registry all --query text --limit 20 --offset 0
node "$YINGYA_COMPONENT_LIBRARY" view --project . --component @react-bits/Aurora-TS-CSS
node "$YINGYA_COMPONENT_LIBRARY" add --project . --component @react-bits/Aurora-TS-CSS
node "$YINGYA_COMPONENT_LIBRARY" view --project . --component @magicui/animated-beam
node "$YINGYA_COMPONENT_LIBRARY" add --project . --component @magicui/animated-beam
node "$YINGYA_COMPONENT_LIBRARY" build --project . --entry component-library/entry.tsx --out assets/components
```

Commands return JSON; preserve the full process result and inspect it for exact
paths and failures. `search --registry` accepts `@react-bits`, `@magicui` or
`all` (the default). Search by effect or category and paginate when useful.
Choose an actual returned registry identifier; the example is not a preferred
component or a fallback for every request. The two imports above illustrate
registry names, not a requirement to install both. TypeScript + plain CSS usually
fits the video scaffold with fewer extra styling dependencies; Magic UI's
Tailwind styles are compiled by the project build. Read the selected
source and usage before importing; inspect added files again before executing.

`add` retains the imported source and returns `diagnostics`: `needs-repair`
lists unresolved static imports or source errors; `imports-resolved` means only
the JavaScript/TypeScript import check passed. Registry metadata may omit npm
dependencies or binary assets. Resolve reported gaps using the official source
instructions and appropriately licensed local assets; do not invent a model or
install a guessed dependency merely to silence an error. Project-local npm
dependencies may be added inside `component-library/` using
`npm install --save-exact --ignore-scripts <package@version>`; retain its lock.
After repairs, rerun `diagnose --project . --component @provider/item` through
the same helper. It restores locked dependencies if needed and preserves source
edits. Do not repeat `add` over an existing import. Choose another implementation
when appropriate, preserving the user's requested effect. No extra approval is
needed within the authorized production scope.

Diagnostics do not inspect CSS resources, runtime URLs or animation behavior.
Build and actual frame checks remain necessary; an import status is not video
acceptance. Reuse an existing working adaptation unless relevant source,
dependencies, resources or timing changed.

Registry `css` and `cssVars` are validated and applied by shadcn to the imported
stylesheet, including animation keyframes; environment-variable changes are
rejected. A Magic UI component may reference a bare default dependency such as
`button`. The helper resolves that dependency from the official shadcn
`new-york-v4` registry and retains its source and MIT license. This is a
dependency-only source, not another public search/import registry. Its scaffold
dependencies and neutral semantic-color fallbacks are included when needed;
override inherited variables such as `--primary` and `--background` to match
the video's design. It adds no global element reset or required mount wrapper.

Search and source inspection can inform the production plan. Import, author and
build after the existing plan authorization; do not add a component approval
checkpoint. Always target the current video project explicitly. The MCP runs
from a shared read-only registry workspace, so use the project helper for
imports. Do not run a suggested installation command with an implicit working
directory or change shared registry files.

Imports live in `component-library/`, separate from the existing `index.html`.
Use the returned source paths when writing `component-library/entry.tsx`; mount
React effects into explicit scene containers. Load the returned `script` with
`<script type="module" src="…"></script>` and link the returned `styles` when
non-null, without replacing the composition's GSAP import, timeline or
media declarations. The helper bundles source; it does not adapt animation time
or automatically turn a web component into a renderable video effect.

Keep timeline registration visible in the root HTML: HyperFrames lint does not
follow an external bundle to discover it. For example, export an async mount
function from the bundle, wait for fonts and React layout effects, and return
`{ timeline }`. In the root's module script, import that function and register
`window.__timelines['main'] = timeline` only after it resolves. GSAP timelines
are thenables: returning a paused timeline directly from an async function or
Playwright evaluation waits for playback completion and can hang. Return a
wrapper object or no value instead.

Project-local component dependencies are allowed through this installed helper.
Keep its dependency lock and provenance records with the imported source. Do
not install/upgrade a CLI, shared runtime, skill or plugin, and do not use
`npx ...@latest` during production. Preserve existing edits when reusing a
component. Read and retain the source's license/notices and record any changes;
do not describe imported code as an original Yingya implementation. Inspect the
actual selected version's license: React Bits uses MIT + Commons Clause with
component redistribution restrictions; Magic UI's public repository uses MIT.
Neither grants access to separately licensed Pro content. Keep both source
notices and model/texture/font asset licenses when relevant.
Keep `provenance.json` and `dependency-licenses/` for default-registry dependencies
as well as the selected component's own license; the build copies their notices
into the offline bundle.

## Preserve the effect, control its time

Keep original shaders, geometry, typography and visual algorithms. Replace only
the timing or interaction mechanism needed for video. Do not simplify every
third-party effect into a generic GSAP fade.

| Original implementation | Video adaptation |
| --- | --- |
| GSAP with scroll, hover or intersection triggers | Keep the tweens and wire their timing into the existing paused composition timeline. Remove dependence on live viewport/scroll events. |
| React or Motion | Bundle the original component and expose a video-time control. Derive rendered state from measured scene time; mounting or a wall-clock timer must not start an independent animation. |
| WebGL, OGL or Three.js | Keep shader/geometry code. Set time uniforms and camera/object state from video time, then draw that state. Use a fixed seed where random values affect the frame. |
| Pointer effects or simulations with accumulated state | Supply a planned input path and reproducible state/replay. If arbitrary seeking cannot be made reliable, render a controlled reusable media asset and retain its editable source and capture settings. |

The root `window.__timelines.main` remains the composition timeline. When using
the installed shared component clock, register a custom React/WebGL adapter with
`YingyaComponents.register(instance)` following its pack README: expose
`ready`, `renderAt(globalSeconds)`, `dispose()`, `startSeconds` and
`durationSeconds`. Built-in `createScene` handles register themselves; do not
register them twice. The clock consumes HyperFrames/Yingya preview `hf-seek`
events; a custom adapter does not need to replace GSAP callbacks.
`ready` covers initial resource loading. For each seek, `renderAt` must either
commit the requested visible state synchronously or return a promise that
resolves after that exact frame commits; the clock passes this work to
`hf-seek.waitUntil`. For React, prefer `flushSync` when updating frame state.
Calling `setState` alone or relying on the initial `ready` promise does not
wait for later React commits. Keep asynchronous requests ordered so an older
seek cannot overwrite a newer frame.

Compute local time from absolute seconds by subtracting the scene start exactly
once and clamp to duration. Synchronize drawing on direct, backward and repeated
seeks. Avoid `Date.now()`, independent `requestAnimationFrame` loops or unseeded
random changes as a visual clock. Await mounting, fonts, textures and models
before capture, fail on required resource errors, and release listeners and GPU
resources through `dispose()` when replacing an adapter. See
[reusable-motion.md](reusable-motion.md) for the existing Anime.js/native-clock
compatibility path.

Chinese titles may need character/grapheme segmentation instead of splitting
only on spaces. Match approved fonts, colors, contrast, line wrapping and caption
safe areas. Treat component demo copy and interaction defaults as examples.

## Verify and retain

Test one representative scene before scaling up: seek directly to meaningful
times, seek backwards, and repeat the same time to check that visible state
matches. Check the actual production browser for required WebGL support and
page errors. A browser's live animation alone does not prove offline rendering.

Run the existing unified check and durable render workflow. Inspect decoded
MP4 frames at the effect's start, active interval and end; verify the intended
motion remains present, legible and synchronized. Motion assertions need unique
selectors: for split text, give the first and last characters stable IDs and
check their appearance/order, rather than asserting on an always-visible wrapper.
For a pre-rendered effect,
register a real static media element so the renderer discovers it. A fallback
must preserve the requested look; disclose an actual unmet requirement.

Snapshot imported source, license/provenance, dependency manifests and lock,
adaptation source, bundled JS/CSS, and any pre-rendered asset with the draft.
Use project-relative asset URLs. Preserve these on later revisions and rebuild
when their dependencies change; a draft must not depend on a mutable remote
component script or files outside its version.
