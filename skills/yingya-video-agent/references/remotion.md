# Remotion production

Remotion is the only supported authoring and rendering engine. Preserve the shared
plan approval, narration, real scene design, visual review and immutable version
workflow. Author TSX and rebuild generated previews after source changes.

## Source contract

- `remotion.json`: `{schemaVersion:1, engine:"remotion", entry:"src/Video.tsx", composition:{id:"main",width:1920,height:1080,fps:30,durationInFrames:300}, props:{}, media:[]}`.
- Entry default-exports a React component. Use native `useCurrentFrame`,
  `interpolate`, `spring`, `Sequence`, `Img`, SVG and CSS for visuals. Derive all
  animation from frame; no wall-clock animation, randomness without a fixed seed,
  scroll/pointer triggers or independent RAF loops. The visible artwork may be
  completely original; this contract is not a slide template.
- Import React/Remotion from installed packages. `staticFile('image.png')` reads
  `assets/image.png`. Keep assets local, fonts bundled, and wait for resource load.
  Imported component sources remain editable; adapt their timing to the frame.
- Declare **all audio and video in `media`**, never privately mount Audio/Video,
  HTML audio/video or a second media player in the visual component. The host
  mounts the actual media automatically behind your visual component. Keep overlay
  backgrounds transparent wherever source video should remain visible.
- Each media item has `id`, `type` (`audio`/`video`), `src` (`assets/...`), integer
  `from`, `durationInFrames`, `trimBefore`, and `volume` (0–1). `muted` is optional.
  Audio also has `role`: `narration`, `replacement`, `music`, `sfx`, or `original`.
  Video may have `style` for placement/objectFit. No looping or speed changes in
  the current runtime. Probe source media duration before declaring its frame interval.
- Match measured narration duration and the approved requirements. The frame rate
  belongs to the source; export at that same FPS. Changing FPS requires retiming
  frame-based animations and rebuilding, not simply passing another CLI value.

## Build, check and render

After an authorized source edit:

```sh
node "$YINGYA_REMOTION" build --project .
python3 "$YINGYA_PRODUCTION_TASK" check --request-id REQUEST --source . --output .yingya/reports/check-draft-N.json --continue-workflow
python3 "$YINGYA_PRODUCTION_TASK" render --request-id REQUEST --source . --output renders/draft-N.mp4 --quality high --resolution landscape --fps 30 --continue-workflow
```

The host initializes empty projects as Remotion after plan approval; an omitted
`outputSpec.videoEngine` also means `remotion`. For approved planning keyframes or
an authorized project without a scaffold, use `node "$YINGYA_REMOTION" init
--project . --width 1920 --height 1080 --fps 30 --duration 10`; it refuses to overwrite
existing source. Other engine values are rejected.

`build` creates `index.html`, `assets/remotion-preview.js` (and optional CSS) and
`remotion-build.json`. Never edit generated files or the receipt. A stale build
fails check/export; rebuild after source or asset changes. The player supports
forward/backward seeking with the same frame clock as native rendering.

The check reports `scope: build-runtime-media`: it checks bundling, source
freshness, browser initialization, sample frames and declared source media ranges.
**It does not certify layout, contrast or authored motion assertions.** Inspect
representative frames and actual MP4 motion yourself under visual-review.md;
record those checks accurately without inventing layout or contrast results.
The durable runner independently verifies output hash, render completion, declared
media hashes, required audio roles, timing, decoding and actual exported frames.
Video visibility and audio semantics still require visual/listening review.

## Versions and recovery

Retain TSX source, remotion.json, built preview, build receipt, every used asset,
requirements, scene metadata, check report and actual rendered video in the new
immutable version. Preserve relative paths. Do not include node_modules or temporary
renderer bundles. Use the existing manifest and phases; no new top-level fields.


Do not call a render successful on an exit code alone. Read the durable runner's
verification report and review its real frames before registering a version.
