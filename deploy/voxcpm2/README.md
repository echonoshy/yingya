# VoxCPM2 serving

This project runs `openbmb/VoxCPM2` through vLLM-Omni and exposes the
OpenAI-compatible Speech API on port `8791`. By default, the server listens on
`127.0.0.1`, while local clients connect through `http://127.0.0.1:8791`.

The Python environment and model weights are installed under `.runtime/`,
separate from the Rust and Node dependencies:

- `.runtime/voxcpm2-vllm/.venv`: the installed Python, PyTorch, vLLM and
  vLLM-Omni packages; the launcher imports these installed packages.
- `.runtime/models/VoxCPM2`: model weights and tokenizer files.
- `.runtime/cuda-compat/`: host-specific CUDA compatibility libraries, when needed.

The current host uses Python 3.12, PyTorch 2.11.0+cu130 and vLLM/vLLM-Omni
0.26.0. The earlier CUDA 12.8 source checkout is no longer a runtime input.
The launch scripts require a provisioned environment and model; they do not
install them. Inspect the actual virtual environment and GPU driver before
recreating this machine-specific stack.

## Service lifecycle

```bash
./deploy/voxcpm2/start.sh
./deploy/voxcpm2/status.sh
tmux capture-pane -pt yingya-voxcpm2 -S -100
./deploy/voxcpm2/stop.sh
```

The launcher runs in the `yingya-voxcpm2` tmux session (port `8791` by
default), preserves the invoking environment, and reuses an existing session.
Legacy PID files are never used to stop a process; an active legacy PID blocks
a duplicate start until that process is identified and stopped.

The script defaults are physical GPU 1 and a GPU memory fraction of 0.80.
The current host's `.runtime/activate.sh` instead sets GPU 0, a fraction of
0.35 and the CUDA compatibility library path. Preserve those overrides when
restarting that installation. On a fresh shell for this host:

```bash
source .runtime/activate.sh
./deploy/voxcpm2/start.sh
```

For another configured host, override settings without editing the scripts:

```bash
VOXCPM2_GPU=2 \
VOXCPM2_PORT=8000 \
VOXCPM2_GPU_MEMORY_UTILIZATION=0.75 \
./deploy/voxcpm2/start.sh
```

Override `VOXCPM2_HOST` when the service should bind to a different interface.
The default `127.0.0.1` binding is reachable only on the local host. If exposed
on a network interface, provide authentication or a trusted reverse proxy.

## Generate speech

Yingya narration uses the saved project voice from `.yingya/voice.json`.
The CLI rejects a conflicting `--voice` instead of silently switching speakers.
For `default`, it calls the Yingya backend's `/api/voices/resolve` endpoint
(`YINGYA_API_BASE`, default `http://127.0.0.1:8797`) to obtain a persisted reference
voice. All segments and revisions reuse that sample and its transcript. Named
voices also send their saved `ref_text`; a missing voice fails without fallback.
The raw VoxCPM2 `voice: default` API remains unconditioned and is for smoke tests
or creating the first reference only, not multi-segment production narration.

Voice design in the installed VoxCPM2 adapter uses a parenthesized description
at the start of `input`, for example `(温暖清晰的青年女声)你好。`.
`task_type: VoiceDesign` and `instructions` do not control this adapter.

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
server, or a base64 data URI. Also pass the exact reference transcript as
`ref_text`, matching the installed adapter and the project client.

Uploaded and generated voice profiles are persisted under
`.runtime/voxcpm2/speakers/` by the launcher. The Yingya server proxies voice
listing, preview, description-based creation, and authorized reference-audio
cloning through `/api/voices`; the browser never needs direct access to port
`8791`.

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
