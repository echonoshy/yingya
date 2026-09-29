# Existing footage: inspect, choose, assemble, verify

Use the inspection guidance for supplied videos of any kind. Understand subjects,
actions, atmosphere and sound, then choose useful intervals for the intended
film. Edit and supplement them with generated imagery, animation or other media
when the approved story benefits. Asset roles and protected content still apply;
do not present generated additions as events captured in the original footage.
An uploaded video is not automatically a screen-recording tutorial.

The analysis cache does not certify semantics. Compose approved footage and overlays in React/Remotion.

## Inspect the source once

```sh
python3 "$YINGYA_MEDIA_ANALYSIS" --project . --source assets/inbox/recording.mp4 --json
```

Replace the example path with a real project asset. The result gives source
identity/hash, measured media metadata, sampled timestamps, frame paths and a
contact sheet. Open the contact sheet and relevant frames. Repeating the command
with unchanged content and options reuses validated project-local cached output.
If finer detail is needed, inspect a small number of extra frames near the
action; do not regenerate a full inspection on every text revision.

This is a technical index, not an ASR transcript, OCR result or scene summary.
Sparse frames can miss short actions. Check the subject, actual action or change
and result before choosing a cut. A screenshot of a player is not evidence of
video playback. Sample timestamps are for finding evidence; use source in/out
and the measured stream duration for editing.

After actually inspecting frames, save the semantic evidence separately from
the technical cache in `.yingya/content-index.json`:

```json
{
  "schemaVersion": 1,
  "sources": [{
    "path": "assets/inbox/recording.mp4",
    "sha256": "actual-source-sha256",
    "observations": [{
      "id": "source-search-result",
      "startSeconds": 14,
      "endSeconds": 20,
      "summary": "输入关键词并提交搜索",
      "result": "结果区出现与关键词相关的素材",
      "confidence": "confirmed",
      "evidenceFrames": ["actual/project-relative/frame.png"]
    }]
  }]
}
```

All example paths, hashes, timestamps and statements above are placeholders.
Use measured identity and actual inspected evidence. Use `uncertain` when the
action or result remains ambiguous, and describe the uncertainty explicitly.
Do not present a filename guess or a tool's thumbnail extraction as content
understanding. Source hash changes invalidate old observations. Keep the index
small and evidence-oriented; it is not a second timeline. Scenes reference
observation IDs with `evidenceIds` and explain their selection with `cutReason`.

For existing speech, use an available transcription workflow only when it helps
the task. Include known brand/technical terms, verify text, and correct zero or
implausibly short word timings before animating captions. Preserve the chosen
analysis version and explicit source intervals; a new transcript can change
segment IDs and boundaries. Do not install or download an ASR model inside a
customer project. Do not replace existing speech with TTS just because a saved
voice is present.

## Keep one editable timeline

Extend the existing `scenes.json` root array. Preserve stable scene IDs and real
`assetIds`. The following is an illustrative shape, not preselected footage:

```json
[
  {
    "id": "scene-search",
    "order": 1,
    "startSeconds": 0,
    "durationSeconds": 6,
    "timingBasis": "source",
    "onScreenText": "输入关键词，找到已有素材",
    "assetIds": [],
    "recipe": "screen-focus",
    "cutReason": "保留搜索输入到结果出现的完整过程",
    "evidenceIds": ["source-search-result"],
    "sourceClip": {
      "source": "assets/inbox/recording.mp4",
      "sourceIn": 14,
      "sourceOut": 20,
      "audioMode": "preserve",
      "focus": {"rect": {"x": 0.5, "y": 0.03, "width": 0.22, "height": 0.1}},
      "overview": {"introSeconds": 1, "outroSeconds": 1.5}
    }
  }
]
```

## Compile measured timing

Convert `startSeconds`, `durationSeconds` and source in/out to integer frames at
`composition.fps`. Declare each video in `remotion.json.media` with `src`, `from`,
`durationInFrames`, `trimBefore`, `volume` and `muted`. The host mounts these media
nodes. Preserve original sound unless the user requests otherwise; additional
narration/music use separate declared audio items and roles.

Use React/SVG overlays for focus, callouts and captions. Keep source video visible
beneath them. Source intervals must fit the measured video stream. Current managed
media has no looping or speed changes. Review cuts, speech, source identity and
actual decoded MP4 frames; metadata alone cannot prove the right action appears.
Preserve inspected source hashes, scene IDs, content index, requirements and media
with the immutable version. Rebuild after every source/asset change.
