# Yingya project structure

Yingya uses Codex to author self-contained HyperFrames projects and uses
HyperFrames to validate, preview, and render them. The repository separates
application source, mutable user data, reproducible outputs, and machine-local
runtime dependencies.

## Ownership boundaries

| Path | Owner | Lifecycle | Git policy |
| --- | --- | --- | --- |
| `src/` | Rust application | Product source | Track |
| `web/` | Browser application | Product source | Track |
| `skills/` | Project Codex integrations | Product source | Track |
| `scripts/` | Developer tooling | Product source | Track |
| `deploy/` | Local service operations | Product source | Track |
| `tests/fixtures/` | Automated test inputs | Test source | Track |
| `data/` | Yingya and its users | Mutable runtime data | Ignore |
| `.runtime/` | Codex, HyperFrames, models, caches | Machine-local state | Ignore |
| `target/` | Cargo | Reproducible build output | Ignore |
| `node_modules/` | npm | Installed dependencies | Ignore |

## Local runtime contents

`.runtime/` is not one cache directory. It contains several kinds of local
state with different cleanup rules:

| Path | Purpose | Cleanup rule |
| --- | --- | --- |
| `codex-home/` | Isolated Codex credentials, task history, skills, plugins, and caches | Keep credentials/history; caches and copied generated images may be regenerated |
| `hyperframes-home/` | HyperFrames configuration and pinned Chrome | Keep while the local renderer is expected to work without reinstalling; skill staging is removed after installation |
| `models/VoxCPM2/` | VoxCPM2 model weights and tokenizer source | Keep; these are runtime inputs, not download leftovers |
| `voxcpm2-vllm/.venv/` | Python, PyTorch, CUDA libraries, vLLM dependencies | Keep; required by the speech service |
| `voxcpm2-vllm/src/` | Locally built vLLM and vLLM-Omni code plus native extensions | Keep; added to `PYTHONPATH` by the service launcher |
| `huggingface/` | Regenerated Transformers dynamic-module cache | Safe to remove while the service is stopped; recreated on startup |
| `voxcpm2/` | Service PID and active log | Keep while the service is running |

## HyperFrames project boundaries

Agent-created videos live in `data/video-projects/<project-id>/`. This is the
only supported project layout. It is mutable user data and stays out of Git.

Each project remains self-contained. Yingya creates the state files and base
directories; the Agent adds composition sources and production artifacts as the
project advances:

```text
<project-id>/
├── project.json             # project metadata and active task state
├── messages.json            # durable conversation history
├── queue.json               # queued user turns
├── events.jsonl             # incremental Agent event log
├── index.html               # HyperFrames entry point, once authored
├── index.motion.json        # animation contract, when required
├── DESIGN.md                # visual specification, once authored
├── hyperframes.json         # HyperFrames configuration, once authored
├── transcript.json          # when narration or source audio is present
├── assets/
│   ├── inbox/
│   └── generated/
├── compositions/
├── artifacts/               # project-local review media
└── .yingya/
    ├── manifest.json        # UI workflow and version manifest
    ├── voice.json           # selected project voice
    ├── render-jobs.json     # bounded render queue and history
    ├── versions/            # immutable Draft sources
    ├── reports/render-jobs/ # final-render preflight reports
    └── exports/             # verified final videos
```

Application-managed state lives under `<project-id>/.yingya/`. In particular,
`versions/draft-N/` contains immutable render sources, `render-jobs.json`
contains the bounded durable render queue/history, `reports/render-jobs/`
contains preflight output, and `exports/` contains verified final videos.
Temporary `.partial.mp4` files are isolated in `exports/.tmp/` and are removed
after every terminal render state.

Codex should receive that directory—not the repository root—as its workspace.
This prevents generated compositions from mixing with application source and
makes a project straightforward to preview, render, export, or delete.

## Test fixtures and outputs

`tests/fixtures/hyperframes-smoke/` contains the minimal deterministic
composition used to verify HyperFrames integration. Its HTML, design contract,
motion assertions, configuration, and input asset are source files.

Rendered MP4 files and inspection snapshots are outputs. Product projects keep
them inside their own ignored `data/video-projects/<project-id>/` directory.
Test runs should use a temporary directory or an ignored project-local output
directory; do not add generated media to the repository unless a visual
regression test explicitly defines it as a reviewed baseline.

## Cleanup policy

Safe to regenerate:

- `target/`
- `node_modules/`
- `.runtime/npm-cache/`
- `.runtime/huggingface/`
- `.runtime/models/VoxCPM2/.cache/`
- `.runtime/codex-home/cache/`, `tmp/`, and copied `generated_images/`
- project-local HyperFrames renders and inspection snapshots

Review before removing:

- `data/`, because it contains user inputs and generated project source
- `.runtime/codex-home/`, because it contains credentials and task state
- `.runtime/models/` and `.runtime/voxcpm2-vllm/`, because rebuilding them is
  expensive and is not yet fully automated by this repository
