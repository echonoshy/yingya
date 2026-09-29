# React component sources for Remotion

Use the installed component importer to discover and retain editable sources:

```sh
node "$YINGYA_COMPONENT_LIBRARY" search --project . --registry all --query text
node "$YINGYA_COMPONENT_LIBRARY" view --project . --component @react-bits/Aurora-TS-CSS
node "$YINGYA_COMPONENT_LIBRARY" add --project . --component @magicui/animated-beam
node "$YINGYA_COMPONENT_LIBRARY" diagnose --project . --component @magicui/animated-beam
```

The supported registries are React Bits and Magic UI. The host manages shadcn and
its MCP; imports may install project-local dependencies but not a shared CLI.
Sources, dependency locks, CSS and attribution live in `component-library/`.
Read the selected license, including any redistribution restrictions; preserve
it with every snapshot. Import diagnostics check static dependency resolution,
not rendered correctness or video suitability.

Import adapted source from `src/Video.tsx`. Use Remotion's frame and FPS to compute
all animation state. Replace viewport, scrolling, pointer, timers, autonomous RAF
and CSS keyframes with frame-controlled state. Seed randomness and reset simulations
for arbitrary direct/backward seeks. Async image/font/model loads must delay the
render until the requested frame is complete. Declare audio/video in the managed
media schedule, never inside an imported visual component.

Keep original visual character and the approved film design. Retain CSS and local
assets; compile Tailwind styles using the existing component `build` command when
needed, then import the resulting CSS in the composition. `build` bundles assets
but does not create a second animation clock or make a component video-ready.
Inspect resource loading, repeatable frame seeking and actual MP4 output before
claiming that an imported component works.
