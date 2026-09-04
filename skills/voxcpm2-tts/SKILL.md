---
name: voxcpm2-tts
description: "Use the local VoxCPM2 OpenAI-compatible API to synthesize speech, inspect TTS service health/models/voices, or create WAV/PCM audio for Yingya. Apply when the user asks Codex to generate narration, spoken audio, local TTS, or test the VoxCPM2 service."
---

# VoxCPM2 TTS

Use the local service at `http://127.0.0.1:8791`. It serves the model name
`voxcpm2` through the OpenAI-compatible `/v1/audio/speech` endpoint.

## Generate audio

1. Resolve the client from the active Codex home, then run its health check:

   ```bash
   skill_client="${CODEX_HOME}/skills/voxcpm2-tts/scripts/voxcpm2_tts.mjs"
   node "${skill_client}" health
   ```

2. If the health check fails and the current project is Yingya, start the
   service with `./deploy/voxcpm2/start.sh`, then wait until
   `./deploy/voxcpm2/status.sh` reports `api=ready`.

3. Synthesize speech to an explicit output path:

   ```bash
   node "${skill_client}" synthesize \
     --text '欢迎使用映芽语音服务。' \
     --output /absolute/path/to/narration.wav
   ```

   If the current Yingya project contains `.yingya/voice.json`, read it first
   and pass its `voiceId` on every synthesis call:

   ```bash
   node "${skill_client}" synthesize \
     --voice 'saved-voice-id' \
     --text '欢迎使用映芽语音服务。' \
     --output /absolute/path/to/narration.wav
   ```

   Reuse the same saved voice for every scene and later revision. Do not fall
   back to `default` or design a fresh voice for each audio segment unless the
   user explicitly changes the project voice.

4. Report the absolute output path. If the user asks to hear it, render the
   local audio file in the response.

Do not overwrite an existing output unless the user requested that exact path;
the client rejects existing files unless `--force` is passed. Preserve the
user's text exactly. Use WAV for normal generation. Use `--format pcm --stream`
only when a downstream consumer explicitly needs raw streaming PCM; VoxCPM2
returns 48 kHz mono signed 16-bit samples.

## Inspect the service

Use `models` or `voices` when validating API compatibility:

```bash
node "${skill_client}" models
node "${skill_client}" voices
```

Set `VOXCPM2_API_BASE` to call a different host or port. Keep the default
loopback endpoint unless the user explicitly asks to expose it to a network.

## Direct API contract

Other services can send JSON to `POST /v1/audio/speech`:

```json
{
  "model": "voxcpm2",
  "input": "要合成的文本",
  "voice": "default",
  "response_format": "wav"
}
```

The response body is the audio file. Check `/health`, `/v1/models`, and
`/v1/audio/voices` for readiness and discovery.
