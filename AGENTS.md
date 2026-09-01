# Yingya repository instructions

## UI design source of truth

- Any work that creates or changes user-facing UI must read and follow
  [`docs/UI_DESIGN_STYLE.md`](docs/UI_DESIGN_STYLE.md) before implementation.
- Use Kiro's product design language as the interaction and visual reference:
  dark layered surfaces, restrained purple emphasis, persistent task context,
  visible agent status, and an always-available composer.
- Treat Kiro as a reference, not a template to copy. Preserve Yingya's own name,
  logo, Chinese product voice, video-production concepts, and original assets.
- Reuse the design tokens in `web/src/styles.css`. Do not introduce one-off
  colors, radii, shadows, fonts, or motion timings when an existing token fits.
- Prefer hierarchy, spacing, borders, and surface contrast over decorative
  effects. Purple is reserved for primary actions, focus, selection, and active
  agent state; it is not a general-purpose background color.
- Keep the prompt composer and current task state easy to find throughout an
  agent run. Progressive disclosure is required for command output, debug data,
  and secondary controls.
- UI changes must remain usable at keyboard focus, narrow/mobile widths, and
  `prefers-reduced-motion`. Do not use color as the only status signal.
- Use Phosphor icons already present in the project. Do not use emoji as product
  interface icons or imitate Kiro's ghost mark, wordmark, copy, or illustrations.
- Before handing off a UI change, run the relevant typecheck/build and visual UI
  checks, then review it against the checklist in the design-style document.

These rules apply to product UI, not to generated customer video compositions;
those follow the design contract inside their own project workspace.
