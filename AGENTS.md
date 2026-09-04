# Yingya repository instructions

## UI design source of truth

- Any work that creates or changes user-facing UI must read and follow
  [`docs/UI_DESIGN_STYLE.md`](docs/UI_DESIGN_STYLE.md) before implementation.
- Use Apple's product design principles as the visual and interaction reference:
  clear hierarchy, generous whitespace, precise typography, neutral layered
  surfaces, direct manipulation, and calm motion.
- Apple is a reference, not a template to copy. Preserve Yingya's own name,
  logo, Chinese product voice, video-production concepts, and original assets.
- Reuse the semantic design tokens in `web/src/styles.css`. Do not introduce
  one-off colors, radii, shadows, fonts, or motion timings when a token fits.
- The product is light-first. Use white for the working canvas, cool system gray
  for navigation and inspector surfaces, near-black for primary actions, and
  system blue only for focus, links, selection, and live status.
- Prefer alignment, spacing, typography, and hairline separators over decorative
  effects. Avoid dark-tech styling, purple glow, ambient grids, and ornamental
  Agent chrome.
- Keep the prompt composer and current task state easy to find throughout an
  Agent run. Command output, debug data, and secondary controls use progressive
  disclosure.
- UI changes must remain usable at keyboard focus, narrow/mobile widths, and
  `prefers-reduced-motion`. Do not use color as the only status signal.
- Use Phosphor icons already present in the project. Do not use emoji as product
  interface icons or copy Apple's trademarks, product artwork, or proprietary
  system assets.
- Before handing off a UI change, run the relevant typecheck/build and visual UI
  checks, then review it against the checklist in the design-style document.

These rules apply to product UI, not to generated customer video compositions;
those follow the design contract inside their own project workspace.
