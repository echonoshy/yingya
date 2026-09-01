---
name: faceless-explainer
description: Direct and produce a polished Chinese faceless explainer from a topic, source text, or script using HyperFrames, generated or user media, VoxCPM2 narration, and timed captions.
---

# Faceless Explainer

Use this workflow for Yingya projects. Work only inside the current project directory.

## Contract

1. Read `BRIEF.md`, `SCRIPT.md`, `STORYBOARD.md`, `frame.md`, and `scenes.json` before making decisions.
2. Preserve the JSON keys already present in `scenes.json`. Valid scene states are `draft`, `approved`, `generating`, `ready`, `dirty`, and `failed`.
3. Treat the user’s supplied text and assets as authoritative. Decide autonomously whether each asset improves the story.
4. Prefer a coherent mix of kinetic typography, SVG diagrams, Canvas/data visuals, UI simulation, and selective generated imagery. Do not generate an image when programmatic motion communicates the idea more clearly.
5. Use warm off-white typography, restrained orange accents, clear hierarchy, and mobile-safe captions. Avoid presenter faces unless the user explicitly requests them.
6. Generate Chinese narration with the available VoxCPM2 integration and derive timed captions from the final audio.
7. Build a valid HyperFrames `index.html`, then run `hyperframes check --snapshots`. Fix errors before rendering.
8. Reuse clean upstream assets. For a single-scene revision, rebuild only that scene’s assets, narration, composition dependencies, and downstream render.

## Planning output

Update all five planning artifacts. Each scene needs a narrative role, narration, visual direction, duration, asset strategy, motion blueprint, caption mode, transition, and dependency-safe status.

## Production output

Keep assets under `assets/`, compositions under `compositions/`, snapshots under `snapshots/`, and renders under `artifacts/`. A draft is review media, not the high-quality final.
