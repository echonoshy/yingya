# GSAP for Yingya video

Use this reference when implementing or repairing GSAP choreography, character
reveals, SVG drawing/morphing or path-following motion. Continue the approved
film and existing production workflow. This pack supplies optional effects for Remotion;
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
It does not edit generated preview HTML. Import the installed GSAP package from
React source; load optional local plugins once before constructing the effect.
Preserve the copied provenance and separate GSAP license in the project snapshot.

## Adapt GSAP to Remotion frames

Create a finite paused timeline after its DOM and required fonts exist. Inside a
React layout effect, seek it to `useCurrentFrame() / fps`; dispose it on unmount.
Use a ref for the timeline and target elements. Delay render readiness during
async font/plugin initialization. Never call `play()` or depend on wall-clock
callbacks. Remotion owns composition duration, scene sequences and all media.

Set explicit start/end states so direct, reverse and repeated seeks are identical.
Avoid DOM mutations in playback callbacks, unseeded randomness and independently
running child timelines. Keep finite repeats within the scene duration. SVG drawing,
morphing and path-following remain valid; test the actual rendered result.
Use `interpolate`/`spring` for ordinary transitions when no GSAP-specific API is needed.

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
