---
name: heygen-audio
description: "Search HeyGen's audio catalog and import background music or sound effects into the current Yingya video project. Use when Codex needs to source, select, add, inspect, or assign music and SFX for a Yingya/HyperFrames production."
---

# HeyGen Audio

Use the local Yingya backend, which keeps the HeyGen credential server-side.
Never call HeyGen directly or read `HEYGEN_API_KEY`.

Resolve the installed client and verify the service:

```bash
heygen_audio="${CODEX_HOME}/skills/heygen-audio/scripts/heygen_audio.mjs"
node "${heygen_audio}" health
```

The client derives the project ID from the current project-directory name. Pass
`--project-id UUID` only when the working directory is not the project root.

## Search and select

Search before importing. Describe the intended moment, mood, pacing, and
instrumentation when useful:

```bash
node "${heygen_audio}" search-music \
  --query "warm restrained modern product background, light electronic pulse"

node "${heygen_audio}" search-sfx \
  --query "soft airy whoosh for a clean scene transition"
```

Choose from the returned `id`, description, duration, and score. Prefer a music
track long enough for the composition. Use short, precise effects for actions
and transitions. A search is read-only.

## Import and assign

Import only when the user has asked to add audio or authorized production of
the video. Reuse the exact query and type used to find the selected result:

```bash
node "${heygen_audio}" import \
  --id RESULT_ID \
  --type music \
  --query "warm restrained modern product background, light electronic pulse"
```

Background music normally remains unassigned so the build Agent treats it as a
global track. For a sound effect, assign the returned asset ID to the intended
scene:

```bash
node "${heygen_audio}" assign \
  --asset-id IMPORTED_ASSET_ID \
  --scene-id SCENE_ID
```

Use `project` to inspect current scenes and audio assets. Do not import several
near-duplicate tracks when one is sufficient. If the local service is
unreachable, report that Yingya must be started or restarted; do not fall back
to exposing the API key.

All project reads and writes use the current `/api/agent-projects` API. Imported
files are served from that project's `/files/` endpoint; do not construct or
reuse any legacy project-file URL.

The build workflow reads `assets.json`: unassigned `mediaType=music` becomes
background music, while assigned `mediaType=sound_effects` is placed at a key
action or transition in that scene.
