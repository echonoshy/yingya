---
name: faceless-explainer
description: Direct and produce a polished Chinese faceless explainer from a topic, source text, or script using HyperFrames, generated or user media, VoxCPM2 narration, and timed captions.
---

# Faceless Explainer

Use this specialization inside `yingya-video-agent`. That skill owns planning, checkpoints, quality gates, version registration, and recovery. Work only inside the current project directory; do not start a second workflow.

## Contract

1. Read the approved `.yingya/plan.md`, `DESIGN.md`, and `scenes.json` when present. Read legacy `BRIEF.md`, `SCRIPT.md`, `STORYBOARD.md`, or `frame.md` only when they contain relevant existing inputs; do not require or create all five.
2. Preserve the JSON keys already present in `scenes.json`. Valid scene states are `draft`, `approved`, `generating`, `ready`, `dirty`, and `failed`.
3. Treat the user’s supplied text and assets as authoritative. Decide autonomously whether each asset improves the story.
4. Prefer a coherent mix of kinetic typography, SVG diagrams, Canvas/data visuals, UI simulation, and selective generated imagery. Do not generate an image when programmatic motion communicates the idea more clearly.
5. Follow the approved visual system and references; do not impose a preset palette. Keep clear hierarchy and mobile-safe captions. Avoid presenter faces unless the user explicitly requests them.
6. When narration is requested, use the exact saved `.yingya/voice.json` voice with VoxCPM2. Measure final audio before fixing scene duration and derive captions from that audio. Reuse unchanged speech; omit TTS for explicitly silent videos.
7. Build a valid HyperFrames `index.html`, then use the outer workflow's single `hyperframes check --snapshots --json` gate. Do not duplicate checks or add another preview approval.
8. Reuse clean upstream assets. For a single-scene revision, rebuild only that scene’s assets, narration, composition dependencies, and downstream render.

## Planning output

Update the outer workflow's plan and root `scenes.json` array. Each scene needs a narrative role, narration, visual direction, duration, asset strategy, motion blueprint, caption mode, transition, and dependency-safe status. Build an intelligible progression: a reason to watch, explanation with concrete examples, and an ending appropriate to the user's goal. Do not add a promotional CTA to every explainer or turn every sentence into a generated image.

## Production output

Keep assets under `assets/`, compositions under `compositions/`, snapshots under `snapshots/`, and renders under `artifacts/`. A draft is review media, not the high-quality final.
