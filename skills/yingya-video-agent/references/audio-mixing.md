# Audio preparation and review

Retain source audio according to the plan. Remotion's media schedule supports a
constant `volume` per clip; use the offline preparation tool for envelopes and
ducking. It creates a new WAV asset and never replaces the source or edits the
schedule. Register the result, point the corresponding media item to it, then
rebuild. Do not play both the original and processed copy of the same track.

```sh
python3 "$YINGYA_AUDIO_TOOLS" analyze --project . --source renders/draft-1.mp4 --output .yingya/reports/audio-draft-1.json
python3 "$YINGYA_AUDIO_TOOLS" prepare --project . --source assets/music.wav --output assets/music-mix-1.wav --gain-db -12 --fade-in .5 --fade-out 1
python3 "$YINGYA_AUDIO_TOOLS" prepare --project . --source assets/voice.wav --output assets/voice-level-1.wav --normalize-lufs -16
```

`analyze` measures integrated loudness, true peak and loudness range with FFmpeg.
Silence has null loudness rather than a fake finite measurement. True peaks at
or above 0 dBTP indicate clipping risk. Loudness targets depend on the destination;
-16 LUFS is an optional web narration starting point, not a universal pass gate.
Normalization is two-pass; final gain/mixing can still change the result. Analyze
the exported mix and listen, especially to consonants, pauses and scene joins.

For speech-controlled music ducking:

```sh
python3 "$YINGYA_AUDIO_TOOLS" duck --project . --source assets/music.wav --narration assets/narration-aligned.wav --output assets/music-ducked-1.wav --gain-db -8 --fade-out 1
```

Music and narration inputs must already share time zero. Prepare an aligned
narration guide with silence at scene gaps if speech spans multiple clips.
The output contains **only processed music**; narration stays a separate managed
track. Ducking responds to audio level, not understanding of words. It does not
fix an incorrectly aligned guide or competing H3 dialogue. Preserve, mute or
attenuate H3 original sound explicitly per the approved plan.

Keep processed WAVs and source hashes with each immutable version. Check duration
and audio roles after replacing a track. Audio adjustments preserve spoken words
and scene timing; do not stretch or cut speech to fit a duration estimate.
