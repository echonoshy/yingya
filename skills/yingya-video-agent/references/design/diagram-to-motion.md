# From SVG diagram to explanatory motion

Start with the mechanism or relationship, using the
[structural breakdown](references/baoyu/layouts/structural-breakdown.md) or
[architecture layout](references/baoyu/diagrams/architecture.md) when useful.
Their static examples supply arrangement ideas, not finished video scenes.

## Keep semantic layers

Use stable, scene-prefixed IDs for nodes, connectors, labels and group bounds.
Keep text as real text and paths as paths so a revision to one label or arrow
does not require regenerating an image. When reusing an SVG file, inline its
elements if individual animation is needed: an `<img>` does not expose the SVG
children to the composition timeline. Prefix marker/clip-path IDs too, and fix
their references, so multiple diagrams do not collide.

Draw connections from actual node geometry and preserve direction/labels.
Use grouping, line patterns and wording as well as color to distinguish roles.
Upstream pixel gaps and small label sizes are static-diagram examples: size for
the project's Chinese font, output canvas, viewing distance and caption area.
Keep a consistent viewBox and local fonts; avoid remote SVG font imports.

## Explain with time

Show enough of the whole to orient the viewer; reveal the relevant layer, trace
its connection, then return to or hold the understandable whole. A packet moving
along a path can explain transfer; separating layers can explain composition.
Do not animate unrelated edges simply because an effect is available.

For path drawing, compute length once after layout and animate stroke-dashoffset
on the existing paused GSAP timeline. A moving highlight should not remove the
underlying relationship after it passes. Use `fromTo` or explicit starting state
when needed so seeking directly to a later scene does not depend on prior playback.
Repeated and backward seeks must reconstruct the same visible state. For a
component with its own adapter, use its shared video-clock contract instead of
also tweening its inner properties.

Keep scene visibility and transitions on `window.__timelines.main`. Save
meaningful motion assertions on unique selectors (node reveal, connection
order, final diagram bounds). Review the actual rendered MP4 at early reveal,
connection change and final hold; check that arrow direction and layer meaning
still match the narration or source, not just that pixels moved.

Use the scaffold's real GSAP script; see [the local GSAP source](slide-to-scene.md)
if a fresh entry needs an offline copy. A stub timeline can pass a static
registration check while failing video rendering, so it is not an adapter.
