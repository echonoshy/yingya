# Yingya project structure

Yingya uses Codex to author self-contained Remotion projects and uses
Remotion to validate, preview, and render them. The repository separates
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
| `examples/` | Composition examples used by runtime tooling/tests | Product source | Track |
| `design-assets/` | Current film sources and typography tools | Rebuildable product assets | Track source; ignore build output |
| `local-ui-archive/` | Retired UI assets and prototypes | Machine-local historical reference | Ignore |
| `tests/fixtures/` | Automated test inputs | Test source | Track |
| `data/` | Yingya and its users | Mutable runtime data | Ignore |
| `.runtime/` | Codex, Remotion, models, caches | Machine-local state | Ignore |
| `target/` | Cargo | Reproducible build output | Ignore |
| `node_modules/` | npm | Installed dependencies | Ignore |
| `web-dist/` | Vite | Reproducible browser build, including public media | Ignore |

## Local runtime contents

`.runtime/` is not one cache directory. It contains several kinds of local
state with different cleanup rules:

| Path | Purpose | Cleanup rule |
| --- | --- | --- |
| `codex-home/` | Isolated Codex credentials, task history, skills, plugins, and caches | Keep credentials/history; caches and copied generated images may be regenerated |
| `remotion-downloads/` | Pinned native renderer compatibility archives | Reusable when preparing releases |
| `models/VoxCPM2/` | VoxCPM2 model weights and tokenizer source | Keep; these are runtime inputs, not download leftovers |
| `voxcpm2-vllm/.venv/` | Python, PyTorch, CUDA libraries, vLLM dependencies | Keep; required by the speech service |
| `voxcpm2-vllm/src/` | Locally built vLLM and vLLM-Omni code plus native extensions | Keep; added to `PYTHONPATH` by the service launcher |
| `huggingface/` | Regenerated Transformers dynamic-module cache | Safe to remove while the service is stopped; recreated on startup |
| `voxcpm2/` | Saved voice samples and possible legacy PID/log files | Keep saved voices; current service output lives in tmux `yingya-voxcpm2` |

## Remotion project boundaries

Agent-created videos live in `data/users/<user-id>/projects/<project-id>/`.
Accounts and usage are stored in `data/yingya.sqlite`; each user's assets,
voices, and runtime are siblings of `projects/`. This is mutable user data and
stays out of Git. Earlier shared `data/video-projects/` and `data/assets/`
directories are legacy data: retain them until ownership is established and
they can be migrated, rather than treating them as disposable caches.

Each project remains self-contained. Yingya creates the state files and base
directories; the Agent adds composition sources and production artifacts as the
project advances:

```text
<project-id>/
├── project.json             # project metadata and active task state
├── messages.json            # durable conversation history
├── queue.json               # queued user turns
├── events.jsonl             # incremental Agent event log
├── index.html               # generated Remotion Player entry
├── src/Video.tsx            # editable React composition
├── DESIGN.md                # visual specification, once authored
├── remotion.json            # composition and managed media frame schedule
├── remotion-build.json      # source/build hashes
├── transcript.json          # when narration or source audio is present
├── assets/
│   ├── inbox/
│   └── generated/
├── src/
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

`tests/remotion.test.mjs` and `tests/remotion-browser.test.mjs` create isolated
React compositions to verify build freshness, seeking, managed media and MP4 export.

Rendered MP4 files and inspection snapshots are outputs. Product projects keep
them inside their own ignored `data/users/<user-id>/projects/<project-id>/` directory.
Test runs should use a temporary directory or an ignored fixture-local output
directory; do not add generated media to the repository unless a visual
regression test explicitly defines it as a reviewed baseline.

One-off QA scripts, screenshots, logs, and exploratory design exports belong in
temporary directories. Keep current product guidance in `docs/`; remove superseded
plans, delivery reports, and tests for retired interfaces instead of accumulating
historical instructions. Preserve source attributions and font licenses with their assets.

Unused UI artwork, previews, and old UI source are kept locally under
`local-ui-archive/<date>/`, preserving their original relative paths. The directory
is ignored by Git and is outside the frontend and release snapshot inputs. Each
archive has a manifest of original paths, sizes, and SHA-256 hashes. It must not be
required to build or test a fresh checkout.

Current browser assets live in `web/src/assets/` and `web/public/`. The brand
wordmark is rendered by `marketing/BrandLogo.tsx`; the browser icon is
`web/public/brand/yingya-monogram.svg`. Active film source and font tooling remain
in `design-assets/capability-reels/` and `design-assets/typography/`.

## Cleanup policy

Safe to regenerate:

- `target/`
- `node_modules/`
- `.runtime/npm-cache/`
- `.runtime/huggingface/`
- `.runtime/models/VoxCPM2/.cache/`
- `.runtime/codex-home/cache/`, `tmp/`, and copied `generated_images/`
- test-fixture Remotion renders and inspection snapshots

Review before removing:

- `data/`, because it contains user inputs and generated project source
- project renders, inspection snapshots, and exports, because manifests,
  conversation links, and version history can reference these files even when
  their source is reproducible
- `.runtime/codex-home/`, because it contains credentials and task state
- `.runtime/models/` and `.runtime/voxcpm2-vllm/`, because rebuilding them is
  expensive and is not yet fully automated by this repository

## Current sample and test media

`web/src/knowledgeExamples.json` is the app sample manifest. Only its content-hashed
media belong in `web/public/knowledge-examples/`. Browser test inputs belong in
`tests/fixtures/media/`; they are not shipped as product examples. `runtime/remotion/` provides the native composition, preview and renderer.

## Preventing unused product code

`npm run test:source` checks TypeScript imports, re-exports and literal dynamic
imports from `web/src/main.tsx`. Test-only imports do not make a product module
reachable. Runtime-loaded assets and backend tools require a separate reference
audit; this check is not a general-purpose file deletion tool.

Release snapshots follow the bounded, reference-aware retention policy in
[ROLLING_UPDATES.md](ROLLING_UPDATES.md); use `npm run release:prune` for a dry run.
