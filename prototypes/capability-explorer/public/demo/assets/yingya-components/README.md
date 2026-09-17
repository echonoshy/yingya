# Reusable video components

Use the release-owned `YINGYA_COMPONENT_LIBRARY` tool to `catalog`, `view`,
`install`, `search`, `add`, and `build`. `catalog.json` distinguishes installed
video recipes from upstream sources which still need timeline adaptation.
Choose by purpose before importing: Anime covers titles, ordered flows and
number comparisons; Magic Beam adds branching/converging networks; Three adds
local model staging. Footage stays with the existing editorial assembler.

`install --component ID --project PATH` copies only the required pack and common
clock into the project. Existing edited files are never overwritten. Anime
keeps its compatible `assets/animejs` location and `YingyaAnime.createScene` API.
The new packs use `assets/yingya-components`, independently of React bundles
in `assets/components`. Keep all files, models, licenses and source records in
the immutable draft snapshot.

## One video clock

Load `clock.js` before the chosen pack script (use a module script for the Three
pack), then call synchronously:

```js
const scene = YingyaComponents.createScene(container, {
  component: 'beam-network', startSeconds: 2, durationSeconds: 6,
  // Content and style options: see the installed pack README.
});
```

The returned handle has `ready`, `renderAt(globalSeconds)` and `dispose()`.
Registration is automatic. The clock listens to HyperFrames `hf-seek` and
synchronously registers initial resource readiness and any promise returned by
`renderAt` with `detail.waitUntil`. Capture waits for the requested frame's
completion. Yingya's preview emits the same event; async models apply the newest
pending time once ready. A failed asset or frame commit rejects capture instead
of silently producing a blank successful frame. There is no separate RAF or
wall-clock animation.

For a custom React/shader effect, `YingyaComponents.register(instance)` accepts
the same interface: `{ready?, renderAt(globalSeconds), dispose(), startSeconds,
durationSeconds}`. Compute local time from the measured scene start. On every
seek, `renderAt` must commit synchronously or return a promise for that exact
frame's visible commit. For React, prefer `flushSync`; asynchronous adapters must
return the actual commit promise, not just call `setState`. The one-time `ready`
promise covers initial loading, not later updates. Order asynchronous commits
so an older seek cannot overwrite a newer frame. Keep shader/geometry/source
algorithms and adapt their clock only.
Do not register Anime instances here as well as in `__hfAnime`.

GSAP still owns scene visibility, transitions and audio scheduling. It must not
write the same inner property as a component. Load fonts and dependencies locally;
do not rely on pointer/scroll input, unseeded randomness, live counters or a
mutable CDN. Dispose GPU resources when replacing a component.

Verify direct, backward and repeated seeks, portrait/landscape layouts, actual
MP4 frames and missing-resource errors. A successful install/build is not a
passed video check. Run the existing production check/render runner.
