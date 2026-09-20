# Knowledge videos: plan, production and review contract

The deliverable is a self-contained narrated video for sharing. Favor clear
explanations of concepts, processes and data; supplied footage supports the
explanation. No user-facing timeline, parameter panel or layer editor. Do not
call video-generation providers, probe their availability, recommend keys or
restart historical footage jobs. Existing image/voice tools and uploaded videos
remain available according to their actual capabilities.

## Plan before the full video

Read the source material, distinguish facts from assumptions, choose a teaching
spine and a visual explanation for each segment. Recommend 1–3 minutes, Chinese,
16:9 / 1080p / 30fps when not otherwise specified. Do not impose these on existing
projects or explicit requests. One coherent art direction uses PPT information
hierarchy, whitespace, consistent typography and diagrams adapted to narration.

Create `.yingya/explanation-plan.json`, register kind `explanation-plan` in the
manifest and include it in the plan checkpoint along with `.yingya/plan.md` and
`scenes.json`. The JSON shape is:

```json
{
  "title": "视频标题", "audience": "目标观众", "question": "要解释的问题",
  "takeaway": "看完能理解的结论", "durationSeconds": 90,
  "aspectRatio": "16:9", "narration": "中文旁白，已选音色",
  "materials": ["已有素材与用途"], "missingMaterials": [],
  "sections": [{"id":"stable-scene-id", "title":"段落标题",
    "summary":"讲什么", "expression":"通过什么图形或素材讲清楚",
    "keyframe":{"status":"ready", "path":"plans/frames/opening.png",
      "sourcePath":"index.html", "timeSeconds":3}}]
}
```

Keep IDs identical to `scenes.json`. Choose exactly min(3, segment count)
representative frames: opening, mechanism and conclusion. Omit the keyframe field entirely on non-selected sections; do not add extra pending placeholders. Render them from real
composition source with real subject content. This limited composition and
snapshot work IS authorized during planning; full narration and full-film
render wait for plan approval. It supersedes older text-only planning guidance.
Pending frames use `status: pending`; failed frames use `status: failed` and
`message`. Never substitute a decorative mock for the actual source. Preserve
and extend the same source, typography and materials after confirmation. Plan
revisions update files atomically; confirmation is bound to their content hash.

Do not require the user to edit segments or select technical recipes. Ordinary
local feedback produces a new version directly. Broader narrative changes return
to one combined plan review. Production's representative-motion check is internal
and adds no approval step. Ignore legacy `reviewMode:auto` for a new unreviewed
plan unless the user's current instruction explicitly authorizes proceeding.

## Reusable explanation components

Use `$YINGYA_COMPONENT_LIBRARY catalog` to find the installed `explain-*` pack:
concept decomposition, process, comparison, data change, causality and footage
annotation. Read its installed guide. Compose these as needed rather than using
one compulsory template. Choose color/type from the project's DESIGN.md. GSAP
interpolates visual presentation; math/formulas or verified data determine truth.
Do not invent numerical evidence or imply a diagram is recorded footage.

## Audio and immutable delivery

Honor source audio and the agreed narration mode. Measure real audio before
final scene timing and caption alignment. A failed voice service is a recoverable
blocker for a narrated video, not permission to silently produce a mute result.
Multi-sentence narration needs separate timed sentence captions; do not leave a
whole paragraph on screen for an entire scene. Align against actual speech (use
local transcription when available), correct ASR homophones and numbers against
the verified script, and retain alignment evidence. Never claim the 300 ms
sentence-boundary criterion from estimated character counts or audio duration alone.
Preserve each finished version's `scenes.json`, media, source, DESIGN.md, video and
JSON check report (`ok: true` only after actual successful checks). Scene IDs stay
stable; startSeconds and durationSeconds describe the version's actual timeline.
These files permit exact old-version attribution and new-version navigation.
Register the JSON as a `check-report` artifact with `version` equal to the new
version ID. A Markdown visual review is additional evidence, not a replacement
for that JSON. `sourcePath` may name the frozen bundle directory or its HTML entry;
the bundle always contains `scenes.json` beside `index.html`.

## Feedback outcomes

Read all version-bound feedback, including `video-range` (`timeSeconds` through
`endSeconds`). Locate source scenes and their corresponding current IDs; do not
assume old timestamps mean the same content in the new version. If mapping is
uncertain, explain the specific ambiguity and preserve the original feedback.
Keep unrelated scene text, assets, voice and visual rules. Update downstream
start times and subtitles when a duration changes. Never overwrite old media.

After checking a new video, append/update each item in the JSON array
`.yingya/feedback-results.json`:

```json
[{"feedbackId":"original-feedback-uuid", "status":"completed",
  "summary":"已放大这一段标题，其他内容沿用上一版",
  "resultVersionId":"draft-2", "evidencePath":"reports/draft-2-review.md"}]
```

The evidence document records the actual change, before/after frame evidence,
checks of protected content and any timing shifts. Use `status: incomplete` with
a concrete reason for failed/conflicting/unresolved items; do not claim success
based on tool completion or a model reply. The server also verifies a new video,
quality report, preserved scene scope and immutable old videos before exposing
completed feedback. Keep the original item when retrying. Viewing an old version
never authorizes rollback.

## User-facing communication

Keep progress and final replies in plain Chinese, centered on what the video explains, what changed, and what remains unresolved. The application already displays the structured plan, versions, review status and share action. Do not ask users to open an editor, inspect JSON, run a command or approve an internal sample. Avoid dumping filesystem paths, hashes, engineering checklists and lists of technical reports into chat. Put these in production details/evidence files; link the viewable video or actual keyframes when useful. Distinguish a recoverable failure from completed work, and retain all user feedback.
