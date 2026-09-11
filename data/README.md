# Runtime data

This directory contains mutable data created by the Yingya application. Its
contents are intentionally ignored by Git.

- `yingya.sqlite`: accounts, password hashes, sessions, invitations, and usage ledgers.
- `users/<user-id>/assets/uploads/`: uploaded media and documents.
- `users/<user-id>/assets/generated/`: images copied from generation results.
- Image files in both asset directories have small `*.metadata.json` sidecars
  that retain the original upload name or generation prompt and library time.
- `users/<user-id>/voices/`: the user's saved reference audio.
- `users/<user-id>/runtime/`: isolated tool homes and runtime caches.
- `users/<user-id>/projects/<project-id>/`: video Agent projects, each with a persistent Codex
  thread record, event JSONL, queue, `.yingya/manifest.json`,
  `.yingya/voice.json`, `.yingya/render-jobs.json`, HyperFrames source, assets,
  reports, unique final exports, and immutable Draft snapshots. Render history
  keeps the most recent 50 jobs; incomplete files remain under
  `.yingya/exports/.tmp/` only while a job is active and are never artifacts.

Each video project should use its own directory as the Codex workspace and keep
its `index.html`, `DESIGN.md`, compositions, transcript, and project assets
together. Back up or export project directories before deleting runtime data.

Legacy shared `assets/` and `video-projects/` directories may still contain
user work. Do not delete them as caches or assign them automatically; establish
ownership before migration. See [storage and isolation](../docs/USER_SANDBOX.md).
