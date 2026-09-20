# Original reusable explanation pack

Install any `explain-*` component through the component library. Load the copied
clock.js, explanation.css and explanation.js plus the composition's local GSAP.
Call `YingyaComponents.createScene(container, config)`; await `handle.ready`.
The container has fixed video dimensions or fills a scene with `container-type:
inline-size`. Preview/render must drive `YingyaComponents.renderAt(seconds)`
(or the engine's hf-seek event with waitUntil). No separate playing timeline.

Common config: `component`, `startSeconds`, `durationSeconds`, `title`, `items`
(one to six `{label, detail?}` objects), `note?`. Set all colors/fonts and sizing
through --explain-* CSS variables according to the project DESIGN.md. Author
real explanatory copy; do not expose these config fields as a user editor.

- explain-concept: the first item is the whole, following items are its parts.
- explain-process: numbered sequential steps.
- explain-compare: aligned alternatives with the same comparison dimensions.
- explain-data: nonnegative bar values with shared maxValue, unit and true values.
- explain-cause: sequential causal stages; verify causal claims separately.
- explain-footage: `mediaSrc`, `mediaType: image|video`, `sourceIn?`, `mediaAlt?`,
  `focus?: {x,y,width,height}` in normalized media coordinates. Keep the media's
  aspect ratio equal to its region when using focus; place annotation outside.

The pack controls visual reveal, not physical simulation or factual inference.
Data values stay exact. For signed data, complex causal networks or long text,
choose/build a suitable composition instead of squeezing into this pack.
