---
name: yingya-video-agent
description: Orchestrate every Yingya video project from brief to final HyperFrames render. Enforces plan and draft checkpoints, manifest updates, quality gates, durable draft versions, and safe capability fallbacks.
---

# Yingya Video Agent

Treat the current working directory as the complete project boundary. Conversation is the control surface; keep project state in `.yingya/manifest.json` so the UI can display it without inferring workflow state from prose.

Use the installed HyperFrames skills for composition authoring and CLI operations. Use other installed media skills only when they materially help the request. Never claim a capability, check, file, or render exists unless it actually succeeded.

This skill is the authoritative outer workflow for Yingya. If a nested HyperFrames skill recommends installing or updating a workflow, this contract wins: use only capabilities already installed for the thread. `.yingya/manifest.json` at the project root is the only UI workflow manifest; do not substitute `PROJECT_MANIFEST.json`, `CHECKPOINT.md`, or a manifest inside a composition subdirectory.

## Core contract

1. Inspect the request, attachments, current files, and manifest before changing anything.
2. Ask only questions whose answers would materially change the result. If visual identity is undefined, confirm the intended visual mood, light or dark canvas, and any brand or style reference before proposing the plan.
3. Stop at exactly two required checkpoints: the production plan and each reviewable draft. Do not make a full composition or render before plan confirmation.
4. Keep all writes inside this project. Ask for explicit confirmation before publishing, uploading externally, or writing outside it.
5. Preserve user edits and unrelated files. If the manifest is dirty or a turn was interrupted, inspect the workspace before deciding what to reuse.
6. Never install, update, or repair skills, plugins, CLIs, or global dependencies from inside a video project turn. Use the capabilities already available to the thread. If a named workflow is missing, continue with the installed core HyperFrames skills or explain the fallback; do not run a package installer.
7. A request to “生成视频” authorizes the production-plan phase, not an unreviewed composition. Creating a storyboard, HTML composition, snapshots, or render before the plan checkpoint is a workflow failure.
8. Read `.yingya/voice.json` before generating narration. When it contains a `voiceId`, every narration segment and revision must use that exact saved VoxCPM2 voice. Never silently substitute `default`, redesign the voice per segment, or mix voice IDs within one project unless the user explicitly changes the project voice.

## Recovery

If the root manifest is still `briefing` but composition or render files already exist, treat them as unapproved recovery material. Inspect them without continuing production, create `.yingya/plan.md` from the request and reusable findings, write the root `plan_review` checkpoint, and stop for confirmation. Do not present the existing composition as an approved draft and do not delete it.

For any interrupted or timed-out quality command, do not equate the client wait limit with a failed HyperFrames process. Before rerunning work:

1. Check whether the original process is still active and wait for it when possible.
2. Check for a completed JSON report and validate that its top-level `ok` is true.
3. Reuse a passing report only when it is newer than `index.html` and `index.motion.json` (when present), or when a recorded source hash matches both files.
4. Check whether the expected video already exists and is readable with `ffprobe`.
5. Rerun only the missing or stale gate. Never rerender solely because the command client stopped waiting.

Long-running `check`, `inspect`, and `render` commands must be started through an execution path that can yield and be polled. Allow up to 10 minutes for a healthy process that continues producing progress. A timeout is an `incomplete` execution state until the process exits or a valid report proves success or failure.

## Phase 1: production plan

Create a concise plan artifact, normally `.yingya/plan.md`, containing at least:

- objective and audience;
- visual system, including mood, canvas brightness, typography, palette, and references;
- structure and named scenes or chapters;
- timing, motion, audio, captions, and media strategy;
- output specification, including aspect ratio, duration target, frame rate, and draft/final expectations.

Video-specific work may add shot lists, narration, capture paths, data mappings, or other relevant sections. Update `.yingya/manifest.json` with `phase: "plan_review"`, a `plan` checkpoint, output specification, and a plan artifact. Then stop. A plan checkpoint must not coexist with a completed composition or draft render created during the same unconfirmed phase.

## Phase 2: build a draft

Begin only after the user or checkpoint message explicitly confirms the plan.

1. Create or update the visual specification (`DESIGN.md` when appropriate), HyperFrames composition, referenced assets, audio, and captions.
2. Use available image, voice, music, or website-capture capabilities when appropriate. If a capability is unavailable, state that clearly and choose an honest fallback: programmatic visuals, user-provided media, or recommending an installable plugin.
   When narration is needed, pass the project `voiceId` to `$voxcpm2-tts` for every segment so separately generated files preserve the same speaker identity.
3. For a new composition, run the HyperFrames checks in this order: `lint`, `validate`, then `inspect`. Significant animation work also requires an animation map before rendering. Write machine-readable reports to a temporary path, validate the JSON, then rename it into place so recovery never reads a partial report.
4. Do not mark a failed or skipped gate as passed. Fix issues and rerun the affected checks.
5. Render a review-quality video only after all required gates pass.
6. Record a SHA-256 source fingerprint for `index.html` and `index.motion.json` alongside the passing report. Create an immutable version under `.yingya/versions/draft-N/` containing the composition source, required assets, design/config files, check report, source fingerprint, manifest snapshot, and video. Exclude `node_modules`, caches, generated intermediates, and older version directories.
7. Treat draft registration as a commit: first verify every referenced source, report, snapshot, and video exists; then build and validate the complete next manifest in a temporary file; finally rename that file over `.yingya/manifest.json`. The manifest replacement is always the last write. It must update artifacts, versions, `currentDraft`, clear `dirty`, set `phase: "draft_review"`, and add a `draft` checkpoint together. Then stop for review.

## Revisions

Before editing, briefly state the impact scope in the assistant response or commentary. Use timestamp, scene, chapter, or inspection context supplied by the user. Change only affected files, rerun all relevant gates, render the next numbered draft, and preserve every prior version.

If the user requests a rollback, restore source and manifest pointers from the selected version without deleting later versions; run the relevant checks before presenting the restored state as stable.

## Final render

After explicit draft confirmation, run final checks and render the high-quality MP4. Add it to manifest artifacts, clear the checkpoint and dirty flag, and set `phase: "completed"`. Return the final local artifact path and a compact verification summary. Do not publish it externally without another explicit confirmation.

## Manifest shape

Preserve unknown fields and use this compatible shape:

```json
{
  "schemaVersion": 1,
  "phase": "briefing | plan_review | production | draft_review | final_render | completed",
  "dirty": false,
  "checkpoint": null,
  "outputSpec": {},
  "studioEntry": "index.html",
  "artifacts": [],
  "versions": [],
  "currentDraft": null
}
```

Checkpoint objects require `id`, `kind`, `title`, `summary`, and `artifactIds`. Artifact objects require `id`, `kind`, `label`, and project-relative `path`. Version objects require `id`, `label`, `sourcePath`, `videoPath`, optional `reportPath`, and millisecond `createdAt`.
