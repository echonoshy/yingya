# Runtime data

This directory contains mutable data created by the Yingya application. Its
contents are intentionally ignored by Git.

- `assets/uploads/`: images uploaded through the API.
- `assets/generated/`: images copied from Codex image generation results.
- `projects/<project-id>/`: future self-contained HyperFrames video projects.

Each video project should use its own directory as the Codex workspace and keep
its `index.html`, `DESIGN.md`, compositions, transcript, and project assets
together. Back up or export project directories before deleting runtime data.
