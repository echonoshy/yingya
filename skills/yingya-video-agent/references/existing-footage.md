# Existing footage: inspect, choose, assemble, verify

Use the inspection guidance for supplied videos of any kind. Understand subjects,
actions, atmosphere and sound, then choose useful intervals for the intended
film. Edit and supplement them with generated imagery, animation or other media
when the approved story benefits. Asset roles and protected content still apply;
do not present generated additions as events captured in the original footage.
An uploaded video is not automatically a screen-recording tutorial.

The later assembler sections describe an optional, bounded route for shots that
benefit from focus, highlight and callout camera treatments. Use a custom
HyperFrames composition for other edits or mixed-media storytelling. The model
chooses the story; the analysis cache and assembler do not certify semantics.

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

Read the installed `catalog.json` next to `$YINGYA_EDITORIAL_ASSEMBLER` for
available `recipe` values and their parameter requirements. Prefer the existing
effects rather than rebuilding the same camera or highlight from scratch.
All focus coordinates are
normalized source-frame coordinates. Focus can also use
`{"anchor":{"x":0.6,"y":0.1},"zoom":1.8}`. Use the actual control position,
not the sample values. An optional `overview.resultFocus` can highlight the
actual result at the end; otherwise the camera returns to overview.

This first adapter supports consecutive, 1× source intervals: scene duration
must equal `sourceOut - sourceIn`, starts must follow the preceding scene, and
source out must fit the media. It rejects silent speed changes, gaps and
overlaps. Choose better cut points or use another explicitly authored treatment
when a real pause, retime or more complex edit is needed. `preserve` is the
default audio choice; use `mute` for a user-requested silent recording treatment.
Keep subtitles and annotations as editable overlays rather than baking them
into the footage.

The first adapter requires square-pixel footage, no rotation metadata, and a
video stream starting at zero. The inspector can describe other formats, but
assembly rejects them explicitly. If conversion is needed, preserve the
original, create a normalized derivative with FFmpeg, inspect it, and bind the
new source and its measured timestamps. Never silently relabel source times.
Choose dimensions from the approved aspect ratio; portrait and square output
need deliberate framing. Shorten overlong captions rather than clipping them.

During planning, record these fields and explain which real action and result
each interval proves. Do not generate the composition until the existing plan
authorization permits production. This adds no new approval checkpoint.

## Assemble after approval

```sh
node "$YINGYA_EDITORIAL_ASSEMBLER" --project . --scenes scenes.json --width 1920 --height 1080 --fps 30
```

Use the project's approved dimensions. Inspect the existing entry before use.
The adapter can create a new entry or safely rebuild its unmodified generated
files. It refuses to overwrite a custom composition or a manually edited
generated file. If the only existing entry is the app's empty post-approval
scaffold, `--replace` can replace that scaffold within the approved production
task. Never use that flag to discard existing Studio/user edits; keep those
changes and adapt the affected scene, or build in a separate output directory
and deliberately integrate it.

The tool emits editable composition files and `source-bindings.json`, linked to
the scene source/hash, original media and generated file hashes. Keep this
binding file with the entry and immutable source snapshot. It is derived
evidence, not a second timeline to edit. Generated videos use statically
discoverable media, a deterministic time-driven camera, and a caption area
outside the footage. First show context, then the action, then its result;
adjust focal positions and holds to the content rather than repeating an effect.

The adapter is a bounded starting treatment, not a universal template. Reuse
brand fonts, colors and approved design decisions when adapting the scene.
Read installed core/animation instructions before extending the source. An
adapted/generated file remains editable; preserve subsequent manual edits.
The binding retains the original assembled entry hash as provenance. Styling
edits can be verified against the current entry and are reported as modified;
source media, clip intervals and audio nodes must still match the binding.
Never refresh hashes by hand or delete the binding to hide a mismatch. Changes
to source intervals need a deliberate scene update and reassembly that preserves
existing custom edits. The render's own fingerprint always describes the actual
current source, including custom styling.

## Verify the exported result

Run the normal durable `check` and `render` commands. A render receipt includes
`renderVerification` and its hash. Open that report and its actual MP4 frame
paths. The report binds the source fingerprint, output hash and media extraction
to this render; browser check snapshots alone cannot prove the video is right.

Check the beginning, action and result of each used interval. The compiler must
discover the declared videos and extract their frames. Verify source bounds,
caption readability, complete controls, original audio when required, and the
last frame. A successful decode does not prove the correct footage appeared.
Keep failed evidence, repair the cause and rerun affected checks; never remove
media, assertions or source bindings merely to get a passing result.

For a local text/focus change, edit only that scene in `scenes.json`, keep source
paths/in-out/audio and other scene IDs intact, then regenerate only when the
generated-file hashes still match. Compare unchanged scene geometry and actual
output frames. Encoding can change pixel values without a semantic edit; do not
claim exact pixel equality unless measured. Record the actual scope of revision.

The workbench's controlled scene editor performs these bounded changes directly
and refuses stale scene revisions or manually modified generated files. If it
reports that a custom composition needs an Agent edit, preserve the custom code
and make the smallest appropriate change; never reset it to regain editability.
The current source preview can show a saved change immediately, while an older
rendered MP4 remains unchanged until the next successful render. Explain which
one is being reviewed. This is source reuse, not a claim of per-scene encoding
or an incremental video-render cache.
