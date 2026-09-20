# GSAP for Yingya video

Use this reference when implementing or repairing GSAP choreography, character
reveals, SVG drawing/morphing or path-following motion. Continue the approved
film and existing production workflow. This pack supplements HyperFrames;
the upstream web examples are API reference, not a second workflow or a reason
to replace an existing working effect.

## Read only what the shot needs

| Need | Reference | Bundled plugin |
| --- | --- | --- |
| Tween start state, easing, immediateRender | [Core](upstream/gsap-core.md) | Core |
| Coordinated beats, labels, stagger timing | [Timeline](upstream/gsap-timeline.md) | Core |
| Chinese character/line reveal | [Plugins: SplitText](upstream/gsap-plugins.md#splittext) | SplitText |
| Draw connectors or outlines | [Plugins: DrawSVG](upstream/gsap-plugins.md#drawsvg-drawsvgplugin) | DrawSVGPlugin |
| Morph an SVG shape | [Plugins: MorphSVG](upstream/gsap-plugins.md#morphsvg-morphsvgplugin) | MorphSVGPlugin |
| Move an object along a path | [Plugins: MotionPath](upstream/gsap-plugins.md#motionpath-motionpathplugin) | MotionPathPlugin |
| Map values, snap or interpolate | [Utilities](upstream/gsap-utils.md) | Core |
| Many animated elements / layout cost | [Performance](upstream/gsap-performance.md) | Core |

The plugin reference also describes plugins not shipped here. ScrollTrigger,
ScrollSmoother, Draggable, React hooks and pointer followers are web interaction
techniques, not the default video route. Installing these references does not
install every plugin mentioned upstream. ScrambleText and random effects need
separate determinism validation before use. Existing components and custom
HTML/SVG remain valid choices; this is not a required effect checklist.

## Offline scripts and provenance

Run the bundled installer from the current project, selecting only needed
plugins (comma-separated names). Core is always included:

```sh
node "$CODEX_HOME/skills/yingya-video-agent/scripts/install-gsap.mjs" --project . --plugins SplitText,DrawSVGPlugin,MotionPathPlugin,MorphSVGPlugin
```

The installer verifies pinned bytes, copies scripts plus the license and
provenance into `assets/gsap-3.14.2/`, and refuses to overwrite modified files.
It does not edit HTML. Reuse the existing project's GSAP if compatible, or
replace its core script reference with the copied core; never load two GSAP
cores. Load selected plugin scripts after core and register them before use:

```html
<script src="assets/gsap-3.14.2/gsap.min.js"></script>
<script src="assets/gsap-3.14.2/DrawSVGPlugin.min.js"></script>
<script>
  gsap.registerPlugin(DrawSVGPlugin);
  const tl = gsap.timeline({ paused: true });
  tl.fromTo('#route', { drawSVG: '0%' }, {
    drawSVG: '100%', duration: 1.2, ease: 'power2.inOut'
  }, 0.3);
  window.__timelines = window.__timelines || {};
  window.__timelines.main = tl;
</script>
```

These are GSAP **3.14.2** scripts, matched to Yingya's existing scaffold.
Copy only what the project uses; no npm/network install is required during a
video task. Keep the returned provenance with the project, including immutable
versions. Record the reference commit from [PROVENANCE.json](PROVENANCE.json)
in `DESIGN.md` when used. Upstream skills retain their [MIT license](upstream/LICENSE);
the GSAP runtime uses the separate license shipped with its scripts.

## Adapt web animation to video time

- Build a finite paused timeline and register it **after all its tweens exist**,
  keyed by the root's `data-composition-id`. HyperFrames seeks it; do not call
  `play()` or require scrolling, hovering, clicking, timers or animation frames.
  Set render length in the root's static `data-duration`.
- Preserve existing scaffold content, but replace its empty timeline registration
  when constructing the real one. Never publish an empty placeholder while
  waiting for font-dependent construction to finish.
- Prefer synchronous setup when no font/layout dependency exists. For SplitText
  or measurements that depend on fonts, await local fonts first, build once,
  then register and call `window.__hfForceTimelineRebind?.()`. This follows the
  installed HyperFrames determinism reference's async readiness contract;
  older blanket prohibitions on all async setup are not the current contract.
  Do not return a GSAP timeline directly from a Promise callback: it is thenable.
- Use explicit start/end values for later-scene `fromTo` tweens, and set
  `immediateRender: false` where a later tween would overwrite an earlier state.
  Do not mutate DOM or create new animations in playback callbacks. Child
  tweens must participate in the parent clock; do not leave them paused when
  adding them. HyperFrames-owned subcompositions are registered separately,
  not also manually nested.
- No unseeded `gsap.utils.random()`, random strings, shuffle or random stagger
  for rendered state. Precompute and save values or use a fixed seed. A random
  choice once per page still changes between parallel render workers.
- SVG path properties (`drawSVG`, `morphSVG`, `motionPath`, `strokeDashoffset`)
  are valid animation targets. Prefer transforms over layout changes when
  possible; an old property allowlist must not be interpreted as banning SVG.
  HyperFrames owns timed clip visibility; animate inner wrappers for fades.
- Keep finite repeats within the scene interval. Do not kill offscreen tweens
  as an optimization: a later backward seek may need them again.
- Website reduced-motion and responsive preferences must not silently change
  the approved exported film. Use its fixed output canvas and motion brief;
  accessibility preferences still apply to the surrounding product interface.

## Plugin-specific checks

**SplitText:** use actual editable text with a locally loaded Chinese font.
Wait for fonts before line/word measurement; split once for the fixed output
canvas. Avoid automatic re-splitting during capture. Animate `split.chars` or
`split.lines` on the main timeline; inspect punctuation, Chinese line wrapping,
stagger duration and the complete final text. Do not split SVG `<text>`.

**DrawSVG:** it reveals strokes, not fills. Preserve an underlying connector if
a moving highlight is used to explain a relationship. Keep arrow direction and
node positions consistent with the source content.

**MorphSVG:** use stable inline SVG paths, convert other shapes once during
setup if needed, and retain the initial path. Prefer explicit `fromTo` states
for multiple morphs; verify endpoints and reverse seeks, not just continuous
playback. A silhouette morph must not change factual data or labels.

**MotionPath:** compute geometry after initial layout, use a consistent viewBox
and local coordinate system, and keep labels separate from moving objects.
Do not re-measure a moving DOM target every frame. Check alignment and bounds
at the beginning, curve apex and end.

## Evidence before delivery

Use the existing production check/render runner. Check initial, intermediate,
late and transition frames, then compare the same timestamp after direct,
backward, repeated and fresh-page seeks **on the live composition's timeline**.
Extracting the same timestamp twice from an already encoded MP4 checks that
file's decoding, not source-timeline determinism. If screenshot hashes differ,
inspect the changed pixels and animation state before diagnosing the cause;
report residual edge-rasterization differences explicitly instead of claiming
pixel identity or silently relaxing a threshold. Verify plugin registration, no missing
local scripts/fonts, readable final Chinese text and real output dimensions /
duration. Open frames from the actual MP4; a successful live browser playback
alone does not validate offline rendering. Preserve the approved workflow and
report concrete limitations rather than promising a creative-quality increase.
