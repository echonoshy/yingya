# Runtime data

This directory contains mutable data created by the Yingya application. Its
contents are intentionally ignored by Git.

- `assets/uploads/`: images uploaded through the API.
- `assets/generated/`: images copied from Codex image generation results.
- Image files in both asset directories have small `*.metadata.json` sidecars
  that retain the original upload name or generation prompt and library time.
- `video-projects/<project-id>/`: video Agent projects, each with a persistent Codex
  thread record, event JSONL, queue, `.yingya/manifest.json`,
  `.yingya/voice.json`, `.yingya/render-jobs.json`, HyperFrames source, assets,
  reports, unique final exports, and immutable Draft snapshots. Render history
  keeps the most recent 50 jobs; incomplete files remain under
  `.yingya/exports/.tmp/` only while a job is active and are never artifacts.

Each video project should use its own directory as the Codex workspace and keep
its `index.html`, `DESIGN.md`, compositions, transcript, and project assets
together. Back up or export project directories before deleting runtime data.
