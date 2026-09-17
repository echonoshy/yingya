# From presentation design to video scenes

Use the focused [style references](index.md) for a visual question such as type
hierarchy, line language, texture or image/text balance. Resolve their choices
against user references and the approved film. Read the
[Frontend Slides motion reference](references/frontend-slides/animation-patterns.md)
only when translating an intended feeling into movement.

## Preserve character, design for viewing time

Separate the main message, supporting evidence and secondary detail. Introduce
them in the order the viewer needs them, keeping useful context visible. A
self-contained reading page can need several scenes or staged reveals; a short
video does not grant viewers unlimited time to scan a dense slide. Preserve
mandatory wording, and resolve real time/content conflicts in the plan.

Treat style as more than palette. An editorial treatment can use asymmetric
type and image placement; sketch notes can use meaningful circles, underlines
and drawn connections; a blueprint can use precise labeling and whole-to-part
views. Let one visual motif persist across scenes while composition changes
with content. These are starting ideas, not required presets or a ban on other
creative approaches.

Use the actual output dimensions, including portrait. Do not retain a source's
fixed 1920×1080 rule for a vertical film or shrink its desktop layout to fit.
Use installed fonts with Chinese coverage and local licensed assets. Preserve
brand marks and supplied footage when required even if a style example excludes
logos or photography. An upstream font suggestion is not a supplied font file.

## Convert browser motion to the film clock

| Presentation mechanism | Video implementation |
| --- | --- |
| CSS transition started by `.visible` or IntersectionObserver | Equivalent transform/opacity/filter tween scheduled on the paused GSAP timeline |
| Click, slide navigation, hover or scrolling | Planned change at a scene-local time derived from the actual narration/source |
| Infinite bobbing, particles or procedural background | Finite motion determined by video time; fixed seed if random state affects pixels |
| Full-page raster slide | Use as a composition/style reference or approved image asset; author important editable text/diagrams as separate layers |

Do not paste sample hover listeners, scroll observers, remote font loaders or
independent autoplay timers into the video. A CSS-only web preview is not proof
of seekable rendered animation. Avoid stacking several systems that animate
the same properties. Keep a complete initial and final state, including a
readable hold, and test direct/backward seeking with the existing renderer.

Reuse the scaffold's **real GSAP** implementation. If a fresh entry has no local
GSAP asset, the installed editorial tool has a release-owned copy at
`vendor/gsap-3.14.2.min.js` beside `$YINGYA_EDITORIAL_ASSEMBLER`, with
`vendor/GSAP-LICENSE`. Copy both into the project's assets and load the script
before registering the timeline. This needs no package or network installation.
Do not fabricate a `window.gsap` object or no-op timeline to satisfy lint: the
renderer calls real timeline APIs and must drive actual visual properties.

## Keep revisions local

Save the resolved type, palette, layout principles and motion in `DESIGN.md`,
including selected upstream commits. Copy only used reference files, their
licenses and provenance into `assets/design-reference/`; record which source
paths were used, without claiming that the entire pack was installed there.
The normal draft snapshot retains these alongside editable source and media.

A change to one label should preserve the film's design and unchanged timing;
a narrated-copy change uses the existing audio dependency rules. Do not
reselect the style, reimport upstream references or rewrite every scene during
a local revision unless that change actually requires it.
