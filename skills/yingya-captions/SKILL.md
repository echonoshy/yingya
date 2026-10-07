---
name: yingya-captions
description: Transcribe local Yingya narration or footage into measured sentence captions, compare a saved script, review timestamps, and export SRT or Remotion caption data. Use for subtitles and speech timing within an existing video project.
---

# Yingya captions

Use the host-provisioned offline tool; keep the existing `yingya-video-agent`
plan, scene IDs, voice and version workflow. No new approval or Studio process.
Do not install a model or Python package in a customer project.

```sh
python3 "$YINGYA_CAPTIONS" health
python3 "$YINGYA_CAPTIONS" transcribe --project . --source assets/voice-01.wav --script assets/voice-01.txt --output assets/captions-01.json --language zh
```

The default model is pinned faster-whisper small, CPU/int8, with local word
timestamps and voice activity detection. It downloads nothing during a task.
Use `--language auto` for unknown languages. The optional script is comparison
evidence, not an instruction to fabricate recognition or force matching text.
Outputs refuse overwrite. Poll an ongoing command; do not submit duplicate ASR.

The output includes source hash, measured duration, recognized words and
`captions: [{text,startMs,endMs}]`. Times are local to the input audio, in
milliseconds. Sentence/line groups use real word boundaries; they do not divide
audio duration by character count. When a supplied script matches recognition sufficiently, its sentence breaks are mapped to matching word boundaries without rewriting recognized words. Long groups can be split with `--max-chars`.

Before using the result:

1. Inspect `scriptComparison`, numbers, names and Chinese homophones. Correct
   subtitle text against the approved script **and actual speech** in a new JSON
   copy. Preserve raw recognition. Missing spoken words require a narration fix,
   not a subtitle that falsely implies they were spoken.
2. Listen around boundaries and pauses, including the first/last line. ASR word
   timestamps are estimates, not a guarantee of 300 ms accuracy. Record actual
   listening evidence separately; never convert a similarity score into a pass.
3. Validate the corrected JSON against unchanged source media:

   ```sh
   python3 "$YINGYA_CAPTIONS" check --project . --input assets/captions-01-reviewed.json
   python3 "$YINGYA_CAPTIONS" export-srt --project . --input assets/captions-01-reviewed.json --output assets/captions-01.srt
   ```

For Remotion, use `SentenceCaptions` from the native explanation pack or render
editable text from the JSON. Inside a scene's `Sequence`, use local times directly;
outside it, add the scene offset once. Trimmed source footage needs subtraction
of its source in-point before adding the scene offset. Recompute when timing changes.
Keep captions in safe areas, load the approved local Chinese font, and inspect
the actual exported MP4. `subtitles: none` means skip caption generation/display.
For bilingual subtitles, translate verified text and retain the same measured
intervals; ASR alone does not provide a verified translation.

If `health` fails, report the missing runtime. An existing SRT or manually
listened sentence timing may be used with an honest description; do not present
estimated timing as automatic alignment or silently omit requested subtitles.
