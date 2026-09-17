# Production planning

## Intake before expensive work

For an idea or manuscript without an established visual treatment, first read
[creative-brief.md](creative-brief.md). Develop the film concept, visual subjects,
shot actions and asset strategy before writing composition code. Separate missing
facts from reversible creative defaults; an absent attachment is not a blocker.

Extract what is already known from existing inputs: purpose, audience, channel, aspect ratio, target duration, frame rate, brand, script, selected voice, and required outputs. Project settings and explicit user choices override defaults. Preserve locked wording, shot order, timing, and assets. Record uncertain facts as assumptions; do not invent statistics, endorsements, or product capabilities.

Read structured requirements and asset roles first. A duration `target` is an
approximate creative target; `exact` and `max` are delivery constraints that must
be checked against the actual output. Audio `preserve` keeps source sound,
`narration` adds approved narration, `replace` replaces source sound with the
approved narration, and `mute` requires a silent result. `auto` means choose and
explain an appropriate treatment from the actual material. A saved voice is
relevant only when creating new speech. Music `off` prohibits adding music;
music `on` requires a real available track, not a promise hidden in the prompt.
Explicit later user instructions can revise these decisions; keep the saved
requirements and plan consistent. State any conflict before expensive work.

Check only capabilities needed by the proposed route: installed HyperFrames executable, local browser availability, readable input media, and available voice/image/music tools. Use local help and read-only health checks; do not download or generate media as a planning probe. A missing optional music service is not a blocker for a video that does not need music. If required speech or footage cannot be produced, disclose that before plan approval. Recheck affected capabilities before use if availability may have changed.

Prefer suitable supplied and existing assets when available. With text-only inputs, generated imagery may be the main visual material; choose it deliberately alongside editable typography, diagrams and data animation according to the story. Do not promise an unverified template or a capability found only in another application's documentation.

For existing video, use the cached analysis tool in [existing-footage.md](existing-footage.md),
open its contact sheet, then inspect only the additional frames needed to locate
the relevant action and result. Technical metadata and thumbnails are allowed
source inspection before approval; they are not a new composition or storyboard.
Record source in/out and what those frames actually show. Do not guess from file
names, rely on a clip summary without timestamps, or repeatedly regenerate the
same contact sheet. The analysis tool does not perform semantic recognition or
guarantee that sparse samples contain every action.

Save observed actions/results and their timestamped evidence in
`.yingya/content-index.json` as described in `existing-footage.md`. Reuse this
understanding while its source hash remains valid. Select `required` assets
deliberately; explain if they cannot be used. A reference image is not source
footage unless the user also authorizes that use. Do not invent observations
for an input you could not inspect.

## One reviewable plan

Derive the visual direction from the user's materials, requirements and supplied
references. Preserve user-approved decisions in `DESIGN.md` when revising an
existing video. Retired bundled examples are not design references; existing
style files may still be rendering dependencies of an authored composition.
Describe the chosen direction in the same production plan, without a separate
style approval gate.

When choosing a new direction, use [visual-direction.md](visual-direction.md)
and its relevant references. Explain the relationship viewers need to see
(sequence, comparison, hierarchy, mechanism or another structure), then the
visual treatment and why it suits these materials. In each scene's existing
`visualDirection` and `motion`, describe what appears first, what changes with
the explanation, and the final readable state. Save selected reference paths
and provenance versions in the plan so production can use the same sources.
Keep this text-only until production is authorized. Do not insert style names
into the footage assembler's `recipe` field or create a parallel scene schema.

Write `.yingya/plan.md` with:

- **Goal and audience:** what viewers should understand or do, and where they will watch.
- **Protected inputs:** exact text, mandatory assets, references, and locked scene/timing decisions.
- **Story:** the opening reason to watch, progression, and ending; use as many scenes as the content needs.
- **Visual direction:** principal subjects, image/material treatment, light and depth, palette, type hierarchy, composition, motion character, safe areas and scene continuity. Describe visible choices that give the film its aesthetic; continue an approved design on revisions.
- **Sound and timing:** narration text or outline (label which), saved voice, music / silence, captions, duration target, and whether duration is hard or approximate.
- **Production route and outputs:** asset sources, available capabilities and limitations, aspect ratio, resolution, fps, editable source, review draft, and final MP4.
- **Composition approach:** identify which content stays editable as text, diagrams, charts, or interface overlays, which scenes use supplied media, and any missing footage. For website work, verify access before promising a capture; request screenshots or copy if access fails. Data stories retain source, units, and scope; missing values remain unresolved rather than invented.
- **Assumptions / unresolved decisions:** distinguish user facts from recommendations; ask about material conflicts together.
- **Representative dynamic passage:** which scene/passage will establish a new visual treatment after authorization, including real subjects, assets and motion; what it must demonstrate before expanding the film. For an existing verified treatment, cite reusable evidence. Record the observed outcome during production; this is not an extra review gate.

For each footage scene include its real source interval, `cutReason`, evidence
IDs and an effect from the installed catalog when appropriate. Explain the
effect's purpose (for example, keeping the result visible), not a library name.
Show uncertainty where an action or result has not been confirmed. These are
part of the same production-plan review, not an additional confirmation step.

Avoid five overlapping planning documents. The plan owns decisions; `scenes.json` owns scene structure. Preserve existing `SCRIPT.md` or `STORYBOARD.md` when supplied, and keep dependent scene fields consistent with user edits. Create additional artifacts only when the requested deliverable needs them.

## Text scene outline and production timeline

`scenes.json` is a **root JSON array**, compatible with Yingya's scene API. Preserve existing keys and stable IDs. `assetIds` references IDs actually present in `assets.json`; use an empty array for planned assets not yet available. Never fabricate asset records or IDs to make a plan look complete.

```json
[
  {
    "id": "scene-1",
    "order": 1,
    "narrativeRole": "开场：提出问题",
    "narration": "这段视频要回答什么问题？",
    "onScreenText": "一个值得回答的问题",
    "visualDirection": "问题居中出现，随后展开为示意图",
    "assetIds": [],
    "assetStrategy": "程序化文字与图形",
    "startSeconds": 0,
    "durationSeconds": 4,
    "timingBasis": "estimate",
    "motion": "标题出现后保持，图形随关键词展开",
    "captionMode": "sentence",
    "transition": "cut",
    "status": "draft"
  }
]
```

At plan review, times are estimates and `status` stays `draft`. Plan approval permits production, not a claim that assets exist. Valid scene states are `draft`, `approved`, `generating`, `ready`, `dirty`, and `failed`; `ready` means required media and composition are actually usable.

For source-footage scenes, extend the same scene objects with `recipe` and
`sourceClip` as specified in [existing-footage.md](existing-footage.md). Keep
`scenes.json` as the single timeline source. Bind source identity, in/out, original
audio choice, explanatory text and focus to the stable scene ID. Plan the visible
result as well as the action: after focusing on a search field, show the matching
result; after a click, show the actual changed state. These intervals must come
from the source rather than a fabricated interface.

Before authoring the full timeline, replace estimates with measured audio or deliberately chosen silent/music timing and update `timingBasis`. Use numeric seconds consistently; every duration must be positive. Scene order and starts must agree with the actual timeline, including intentional overlaps. The total is the maximum scene end, not a naive sum when transitions overlap. If locked text cannot fit a hard duration without losing intelligibility, surface the conflict instead of silently cutting speech or speeding it up.
