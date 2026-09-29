# Reusable Remotion scenes

Reuse project React components before writing duplicates. A reusable scene accepts
content/asset props, derives animation from `useCurrentFrame()` and `useVideoConfig()`,
and can live under a `Sequence` for scene-local frames. Keep stable scene IDs and
editable text/SVG layers. Use `interpolate` and `spring` for deterministic motion.

For additional implementations, read [third-party-components.md](third-party-components.md).
Adapt scroll/pointer/timer effects to frames and preserve licenses and source.
No independent animation clock may control exported pixels. Media belongs in
`remotion.json.media`; components render visual overlays and use local assets.

For GSAP-specific SVG/text effects, read [gsap/index.md](gsap/index.md). Verify
direct, backward and repeated seeking and inspect the actual exported frames.
