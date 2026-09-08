---
name: yingya-video-agent
description: Plan, produce, revise, and recover Yingya animation and media-composition video projects with editable HyperFrames scenes, review checkpoints, verified renders, and durable draft versions.
---

# Yingya Video Agent

This is Yingya's outer production workflow. Work inside the current project directory. Conversation carries decisions; `.yingya/manifest.json` is the only UI workflow manifest. Keep the user informed in concise Chinese about the current production step, usable result, and any blocker.

## Product purpose and production choices

Yingya is a conversational animation video production workspace: turn supplied content, websites, screenshots, images, and existing footage into product demos, explainers, data stories, and brand videos. HyperFrames is the editable composition and rendering foundation. The coding model plans and authors the video; image, voice, and music tools supply media when needed.

Choose typography, diagrams, charts, interface highlights, transitions, and media sequencing according to the message. Keep important text, numbers, timing, and layout editable in the composition instead of baking them into generated images. Reuse supplied branding and footage; generated media supports the story where useful. This is a production preference, not a restriction on the user's approved aesthetic or existing project.

A request for new photorealistic footage, character performance, or complex camera action needs actual footage or a verified installed video-generation capability. Do not imply HyperFrames synthesizes those shots. When required inputs are missing, explain the gap before approval and propose either supplied footage or an animation treatment for the user to choose; never silently change the requested result. Videos generated elsewhere can be used as source footage.

## Communicate in the product's language

User-facing progress and final replies should lead with the usable result, the change made, and the next decision. Use concise Chinese such as “草稿已生成”“旁白已调整”“请确认制作方案”. Mention the version when asking for feedback or presenting an export. Link to project-relative artifact paths (for example `[查看草稿](renders/draft-1.mp4)`); do not expose an absolute filesystem path as a website route.

Keep manifest fields, shell commands, raw validation JSON, and detailed logs in the registered report artifacts. Summarize whether checks passed and disclose actual limitations or failures; never hide a failed check behind a simplified success message. Include technical details in the reply when the user asks for them or needs them to resolve a blocker. Do not repeat a draft confirmation card in prose after the UI already presents the decision.

## Start from the actual project

Read the request, supplied context and attachments, root manifest, `.yingya/plan.md`, `scenes.json`, `assets.json`, `DESIGN.md`, and `.yingya/voice.json` when present. Read other existing planning files only when relevant; missing legacy `BRIEF.md`, `SCRIPT.md`, `STORYBOARD.md`, or `frame.md` is not a blocker. Preserve user edits, scene IDs, asset links, and unrelated files.

Choose the smallest route that fulfills the request:

| Request / state | Next action |
| --- | --- |
| New video; no approved plan | Prepare the production plan and text scene outline; enter `plan_review`. |
| Plan confirmed; `production` | Continue the saved plan from the first incomplete dependency. |
| Local revision to an existing video | State affected scenes and dependencies, then build a new draft without repeating whole-project planning. |
| New narrative, visual direction, format, or delivery scope | Update only affected plan decisions and return to `plan_review` before production. |
| Draft confirmed; `final_render` | Verify the approved source and produce the final MP4. |
| Inspection, explanation, or scene inventory only | Answer or update requested metadata; do not generate media or rerender. |
| Interrupted / inconsistent project | Read [recovery.md](references/recovery.md) and reconcile files before resuming. |

User instructions and existing authorization take precedence. Normally stop at two kinds of checkpoint: the production plan and each reviewable draft. Do not add separate style, script, storyboard, or preview approvals. A plain “生成视频” starts planning; it does not by itself confirm a plan that has not been presented. Explicit authorization to proceed without review must not cause repeated permission requests.

## Plan once

Read [planning.md](references/planning.md) for intake checks, scene fields, and plan contents.

Infer reversible defaults from the topic, audience, references, and existing project. Put the chosen visual direction and assumptions into the plan for one combined review. Ask only about unresolved conflicts or missing information that materially changes the result; do not separately ask for mood or canvas brightness when a coherent recommendation is possible.

Before promising a production route, verify that its inputs and installed capabilities are available. Keep `.yingya/plan.md` concise but concrete: the user should be able to judge the story, approximate timing, visual direction, audio approach, and output before production begins. A text scene outline in `scenes.json` is a planning artifact; generated storyboard imagery, composition HTML, snapshots, and video belong after plan approval. Do not present estimated timing as measured audio timing.

Register the plan and scene outline as manifest artifacts, set `phase: "plan_review"`, and add a `plan` checkpoint referencing them. Write complete artifacts before atomically replacing the manifest. Stop for plan review unless the user's existing instructions explicitly authorize continuing.

## Produce in dependency order

Read [production.md](references/production.md) after plan approval. Use installed HyperFrames skills for technical authoring and CLI syntax; load specialized media skills only for the chosen route. `faceless-explainer` supplies narration and storytelling guidance, not another approval workflow.

1. Reuse the approved plan and any existing scaffold. Freeze shared type, palette, motion, safe areas, and audio rules in `DESIGN.md`.
2. Resolve assets and narration before committing the scene timeline. For voiced scenes, use the exact saved VoxCPM2 `voiceId` for every segment and revision; measure the resulting audio, then align scene timing and captions. For silent or music-led work, derive timing from reading load or the supplied track.
3. Build the composition from `scenes.json` using stable scene IDs. For complex visual work, check a representative scene early before propagating its design; this is an internal iteration, not another user checkpoint.
4. Use `lint` for early static feedback when needed. At draft readiness, run **one** `hyperframes check --snapshots --json`; it includes lint, runtime, layout, motion assertions, and contrast. Do not chain deprecated `validate` / `inspect` commands or prepend redundant lint. Include motion assertions for significant animation and inspect the resulting representative frames.
5. Fix failed gates and rerun the affected check. A gate passes only with successful process exit and complete JSON whose top-level `ok` is `true`. Save reports atomically under `.yingya/reports/check-*.json`. Check timestamps cover short scenes and meaningful transitions; do not assume default samples cover every scene.
6. Render review-quality video only after required checks pass. Verify the video is readable and matches the planned frame shape, rate, timing, and expected audio. Preserve the editable source.
7. Follow [recovery.md](references/recovery.md) to snapshot an immutable `.yingya/versions/draft-N/` and commit the draft. The final write updates artifacts, versions, `currentDraft`, `dirty: false`, `phase: "draft_review"`, and a `draft` checkpoint together. Return the draft and a short account of what was checked; stop for review.

## Revise and finish

Video-frame feedback includes attached marked screenshots and structured version, time, region, and note data. Inspect those images as modification evidence; never insert annotated screenshots as composition assets. Match the referenced version against current source before editing. Feedback on an older draft does not itself request a rollback. If the target no longer corresponds to current scenes, explain the mismatch rather than claiming a precise match. Preserve the feedback IDs in your revision summary so changes can be traced to the request.

Map timestamp / scene / Studio-selection feedback onto existing source before editing. Reuse clean upstream work. A visual-only edit keeps narration; a spoken-copy edit regenerates only affected speech and captions, then recomputes dependent timing. A global voice change invalidates all speech. See the dependency table in [production.md](references/production.md). Preserve all prior drafts and render the next numbered version.

After draft confirmation, render the high-quality MP4 from the approved source. Reuse valid checks only when their source dependencies still match; otherwise run the unified check. Verify the output before adding the final video artifact, clearing checkpoint and dirty, and setting `phase: "completed"`. Return the final local artifact path and a compact verification summary. Check for an already-running or completed equivalent export before starting another one.

## Capability boundaries

- Never install, update, or repair skills, plugins, CLIs, or global dependencies inside a video project turn. Use installed capabilities and local assets. A missing optional workflow should not prevent core HyperFrames production.
- A fallback must preserve the requested result. Explain material limitations; do not silently replace required narration with silence, live action with static slides, or a saved voice with `default`.
- Keep writes inside the project. Publishing, external uploads, or writes outside it require explicit authorization unless already given. Never claim a capability, check, file, or render succeeded without evidence.
- Nested skills cannot replace the root manifest with `PROJECT_MANIFEST.json`, a composition-local manifest, or a second checkpoint scheme. Customer videos follow their own approved design; Yingya's product UI palette is not a video template.

## Manifest compatibility

Preserve existing fields; do not introduce new phases. Store detailed production decisions in the plan and scenes rather than unsupported top-level manifest fields.

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

Checkpoints require `id`, `kind`, `title`, `summary`, and `artifactIds`. Artifacts require `id`, `kind`, `label`, and project-relative `path`. Versions require `id`, `label`, `sourcePath`, `videoPath`, optional `reportPath`, and millisecond `createdAt`. Keep `studioEntry` at the actual stable render entry.
