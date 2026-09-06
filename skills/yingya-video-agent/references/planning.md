# Production planning

## Intake before expensive work

Extract what is already known from existing inputs: purpose, audience, channel, aspect ratio, target duration, frame rate, brand, script, selected voice, and required outputs. Project settings and explicit user choices override defaults. Preserve locked wording, shot order, timing, and assets. Record uncertain facts as assumptions; do not invent statistics, endorsements, or product capabilities.

Check only capabilities needed by the proposed route: installed HyperFrames executable, local browser availability, readable input media, and available voice/image/music tools. Use local help and read-only health checks; do not download or generate media as a planning probe. A missing optional music service is not a blocker for a video that does not need music. If required speech or footage cannot be produced, disclose that before plan approval. Recheck affected capabilities before use if availability may have changed.

Prefer supplied assets, then suitable existing local assets, then generation where it adds meaning. Typography, diagrams, and data animation often communicate explanatory concepts more directly than generated pictures. Do not promise an unverified template or a capability found only in another application's documentation.

## One reviewable plan

Write `.yingya/plan.md` with:

- **Goal and audience:** what viewers should understand or do, and where they will watch.
- **Protected inputs:** exact text, mandatory assets, references, and locked scene/timing decisions.
- **Story:** the opening reason to watch, progression, and ending; use as many scenes as the content needs.
- **Visual direction:** canvas brightness, palette, type hierarchy, composition, motion intensity, safe areas, and scene continuity. Continue an existing design before inferring a new one.
- **Sound and timing:** narration text or outline (label which), saved voice, music / silence, captions, duration target, and whether duration is hard or approximate.
- **Production route and outputs:** asset sources, available capabilities and limitations, aspect ratio, resolution, fps, editable source, review draft, and final MP4.
- **Assumptions / unresolved decisions:** distinguish user facts from recommendations; ask about material conflicts together.

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

Before authoring the full timeline, replace estimates with measured audio or deliberately chosen silent/music timing and update `timingBasis`. Use numeric seconds consistently; every duration must be positive. Scene order and starts must agree with the actual timeline, including intentional overlaps. The total is the maximum scene end, not a naive sum when transitions overlap. If locked text cannot fit a hard duration without losing intelligibility, surface the conflict instead of silently cutting speech or speeding it up.
