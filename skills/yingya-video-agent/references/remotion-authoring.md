# Authoring for Yingya's Remotion 4.0.529 runtime

Read [remotion.md](remotion.md) for the project contract. These examples use the
pinned API already installed by Yingya. Do not install a new Remotion version,
launch Studio, or apply an upstream skill's separate preview/export workflow.

## One measured timeline

Convert measured scene seconds to frames once at assembly. Use stable IDs,
`Math.round(seconds * fps)` and positive durations; neighboring boundaries must
reuse the same converted frame. A `Sequence` supplies local frames to its child.
For intentional transitions, include the overlap when calculating total duration.
Video/audio remain in `remotion.json.media`; source offsets use composition FPS,
not the source file's FPS. Rebuild after source, fonts, media or timing changes.

```tsx
import React from 'react';
import {Sequence, useVideoConfig} from 'remotion';
import {ExplainProcess, SentenceCaptions} from './yingya-explain';
import subtitles from '../assets/captions-01-reviewed.json';

export default function Film() {
  const {fps} = useVideoConfig();
  // Replace with the shared measured scene schedule; this is an example only.
  const start = Math.round(1 * fps);
  const end = Math.round(9 * fps);
  return <Sequence from={start} durationInFrames={end-start}>
    <ExplainProcess title="从观察到结论" items={[
      {id:'observe',label:'观察',detail:'记录真实现象'},
      {id:'compare',label:'比较',detail:'保持其他条件相同'},
      {id:'explain',label:'解释',detail:'用证据说明变化'},
    ]} theme={{fontFamily:'ProjectSans',accent:'#216b79'}} />
    <SentenceCaptions captions={subtitles.captions} style={{fontFamily:'ProjectSans'}} />
  </Sequence>;
}
```

`SentenceCaptions` renders half-open intervals (`startMs <= time < endMs`). The
example's JSON is local to this scene; do not add the scene start a second time.
The scene and narration must cover all actual caption ends. Use the caption skill
to produce and review this file; the example does not fabricate timed speech.

## Native explanation components

```sh
node "$YINGYA_COMPONENT_LIBRARY" catalog
node "$YINGYA_COMPONENT_LIBRARY" view --component explain-process
node "$YINGYA_COMPONENT_LIBRARY" install --project . --component explain-process
```

Installation copies one small editable source file, `src/yingya-explain.tsx`,
containing concept, process, comparison, data change, causality, footage focus
and sentence captions. It needs only installed React/Remotion and no network.
Read the chosen component's props with `view`; all six support project colors
and fonts. Most support title/style; footage focus is transparent and positions
its region in normalized 0–1 canvas coordinates. The installer refuses modified
source; reuse your existing copy after local edits. These are starting points,
not a required film template. Adapt layout to content and keep the final hold.

Data bars share a zero baseline and scale, preserve negative values, and require
real values/units. Comparison rows align the same attributes. Causal arrows need
evidence for causality. Keep visible source attribution when the content needs it.
For supplied footage, put the actual video in the media schedule and use
`ExplainFootage` only for its transparent annotation.

## Type, assets and motion

Copy licensed fonts to `assets/fonts/`. Load a local font once using a module-level
promise or `@remotion/fonts` `loadFont`, and hold render readiness until loading
finishes. A browser fallback is not evidence the intended Chinese font loaded.
Use `Img`/`staticFile` for project images; `staticFile('x.png')` reads `assets/x.png`.
Keep asynchronous resources deterministic and render-blocking; no external URLs
in a frozen video version.

Start from the output canvas and reserve a subtitle-safe band. Inspect Chinese
punctuation, line breaks, long labels, units and final font size in decoded frames.
Split or recompose dense content before shrinking it into unreadable text.

Use `interpolate` with both extrapolation sides clamped or `spring` driven by
the current frame. Derive all random values from fixed seeds. Ordinary scene
reveals need no extra animation library. For SVG/text choreography read
[gsap/index.md](gsap/index.md); for imported web effects read
[third-party-components.md](third-party-components.md). Independent timers,
CSS animations and RAF loops do not provide reliable arbitrary-frame rendering.

Before delivery, compare an intermediate frame reached directly, backward and
repeatedly, then inspect the real MP4. Test the opening, late hold, scene boundaries,
caption changes and any trimmed video. Passing a build certifies none of these
visual or semantic qualities by itself.
