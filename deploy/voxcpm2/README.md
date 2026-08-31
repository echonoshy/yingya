# VoxCPM2 serving

This project runs `openbmb/VoxCPM2` through vLLM-Omni and exposes the
OpenAI-compatible Speech API at `http://127.0.0.1:8791` by default.

The machine-specific CUDA 12.8 environment and model weights are installed
under `.runtime/`, so they stay isolated from the Rust and Node dependencies:

- `.runtime/voxcpm2-vllm/.venv`: Python 3.12, PyTorch 2.11 CUDA 12.8,
  vLLM and vLLM-Omni
- `.runtime/voxcpm2-vllm/src`: CUDA 12.8-compatible vLLM and vLLM-Omni code
- `.runtime/models/VoxCPM2`: model weights

## Service lifecycle

```bash
./deploy/voxcpm2/start.sh
./deploy/voxcpm2/status.sh
tail -f .runtime/voxcpm2/server.log
./deploy/voxcpm2/stop.sh
```

The launcher uses physical GPU 1 because it was idle during installation.
Override any setting without editing the scripts:

```bash
VOXCPM2_GPU=2 \
VOXCPM2_PORT=8000 \
VOXCPM2_GPU_MEMORY_UTILIZATION=0.75 \
./deploy/voxcpm2/start.sh
```

Set `VOXCPM2_HOST=0.0.0.0` only when the service must be reachable from other
machines, and put authentication or a trusted reverse proxy in front of it.

## Generate speech

```bash
./deploy/voxcpm2/smoke-test.sh
```

Or call the OpenAI-compatible endpoint directly:

```bash
curl -X POST http://127.0.0.1:8791/v1/audio/speech \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "voxcpm2",
    "input": "欢迎使用映芽语音服务。",
    "voice": "default",
    "response_format": "wav"
  }' \
  --output speech.wav
```

Codex can use the project skill after running `npm run voxcpm2:skill:install`.
Invoke it as `$voxcpm2-tts`, or use its dependency-free API client directly:

```bash
node skills/voxcpm2-tts/scripts/voxcpm2_tts.mjs synthesize \
  --text '欢迎使用映芽语音服务。' \
  --output /tmp/voxcpm2.wav
```

Voice cloning adds `ref_audio`; it may be an HTTP URL, a path visible to the
server, or a base64 data URI. For highest-fidelity continuation, also pass the
exact reference transcript as `prompt_text` and select the corresponding clone
mode supported by the vLLM-Omni Speech API.

For raw streaming audio, send `"stream": true`,
`"stream_format": "audio"`, and `"response_format": "pcm"`. VoxCPM2 emits
48 kHz, mono, signed 16-bit PCM.

## Operational notes

- The Python environment was created by `uv` at
  `.runtime/voxcpm2-vllm/.venv`. The launcher executes that environment's
  Python directly and never installs packages into the system interpreter.
- API clients and smoke tests use Node.js and do not depend on the system
  `python3` command.
- Cold start is normally around one minute; the first request also performs
  CUDA/FlashInfer compilation and is slower than subsequent requests.
- The default GPU memory fraction is 0.80. Reduce it if another process shares
  the selected GPU.
- Keep the server warm for interactive video-authoring workflows.
- Model and code are Apache-2.0, but cloned voices still require the speaker's
  authorization and appropriate disclosure.
