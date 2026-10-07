# Yingya project structure

Yingya uses Codex to author self-contained Remotion projects and uses
Remotion to validate, preview, and render them. The repository separates
application source, mutable user data, reproducible outputs, and machine-local
runtime dependencies.

Development rules live in [AGENTS.md](../AGENTS.md); detailed document ownership
is listed in [the documentation index](README.md). Product UI follows the frozen
[design baseline](UI_DESIGN_STYLE.md), not archived source or historical previews.

## Ownership boundaries

| Path | Owner | Lifecycle | Git policy |
| --- | --- | --- | --- |
| `src/` | Rust application | Product source | Track |
| `web/` | Browser application | Product source | Track |
| `runtime/` | Agent tools, captions and Remotion integration | Product source | Track |
| `skills/` | Project Codex integrations | Product source | Track |
| `scripts/` | Developer tooling | Product source | Track |
| `deploy/` | Local service operations | Product source | Track |
| `design-assets/` | Current film sources and typography tools | Rebuildable product assets | Track source; ignore build output |
| `docs/assets/` | Media embedded in repository documentation | Published documentation assets | Track referenced final assets |
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
| `cuda-compat/` | Host-specific CUDA compatibility libraries | Keep while referenced by the speech environment |
| `huggingface/` | Regenerated Transformers dynamic-module cache | Safe to remove while the service is stopped; recreated on startup |
| `voxcpm2/` | Saved voice samples and possible legacy PID/log files | Keep saved voices; inspect tmux `yingya-voxcpm2` and any open log files before cleanup |
| `python/`, `captions/` and their runtime links | Versioned shared Python and offline speech-recognition environments | Keep versions referenced by releases or processes |
| `releases/` | Immutable release snapshots | Clean only through `npm run release:prune` |
| `release-build/` | Shared Cargo release compilation cache | Rebuildable; remove only when no build is running |
| `hyperframes-home/` | Retired engine dependencies retained for old instances | Keep until no process or retained snapshot references them |
| `worktrees/` | Historical independent scratch repositories | Preserve uncommitted source; only remove unreferenced generated outputs |

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

Reproducible outputs and caches (check active processes, builds, symlinks and
release references before removing):

- `target/`
- `node_modules/`
- `.runtime/npm-cache/`
- `.runtime/huggingface/`
- `.runtime/models/VoxCPM2/.cache/`
- `.runtime/codex-home/cache/`, `tmp/`, and copied `generated_images/`
- test-fixture Remotion renders and inspection snapshots

Reproducible does not mean unused. A running development service may still use
an older executable, even after the main build path was replaced; inspect the
process executable and file identity, not only the pathname or modification time.

Remove empty retired source directories with `rmdir`; do not keep placeholder
folders for removed features. Test fixtures now live under `tests/fixtures/`.
One-off checks should write to temporary directories, not recreate a root-level
`output/` directory.

`runtime/` contains maintained source; `.runtime/` contains local state. Do not
delete either directory wholesale. Before removing staging copies or caches,
check running processes, symlinks and release references. Keep source changes
in old scratch repositories even when deleting their ignored build outputs.
Cargo incremental caches can be removed when no build is running; retain the
executables and dependencies used by current services.

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

### README artwork and promotional GIF

The root READMEs use localized covers at `docs/assets/readme-hero-zh.webp` and
`docs/assets/readme-hero-en.webp`, plus the shared `docs/assets/readme-story.webp`
illustration. These are original generated campaign images, not product
screenshots or evidence of a completed user video. The visual metaphor is a
blue line becoming a film ribbon, following the existing wordmark and palette.
It does not establish a new product UI theme.

`docs/assets/readme-art.json` records the generation prompts, localization
relationship, asset hashes and reference boundary. Use the image-generation
workflow for changes to the artwork; both covers must retain their matching
composition and correct language. The delivered WebP files preserve the generated
pixels losslessly. Keep the final referenced assets in Git, and temporary
previews outside the repository. Neither README contains installation commands;
operational instructions belong in [development](DEVELOPMENT.md) and
[rolling releases](ROLLING_UPDATES.md).

Both root READMEs embed `docs/assets/yingya-demo.gif`, derived from the current
homepage film at `web/src/assets/showcase/intro-1-1440.mp4`. It preserves the full
15-second sequence at 800 × 450, 15 fps, with a looping 192-color palette and no
audio. The README links to the original film on the website for sound.
This GIF is a tracked documentation asset, not a retired UI mockup or a browser
build input. Keep intermediate palettes and previews in temporary storage.

To regenerate from the repository root:

```bash
ffmpeg -hide_banner -y -i web/src/assets/showcase/intro-1-1440.mp4 \
  -filter_complex '[0:v]fps=15,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle' \
  -an -loop 0 docs/assets/yingya-demo.gif
```

When the film changes, inspect the generated animation, check its dimensions,
duration and file size, and keep both README image paths in sync. Homepage
source metadata remains in `web/src/assets/showcase/encoding.json`.

## Preventing unused product code

The maintained entry points are `package.json` for npm tasks, `Cargo.toml` for
Rust, `web/vite.config.ts` for browser builds, and `runtime/python/` /
`runtime/captions/` for shared environments. `runtime/` helpers are also invoked
by Rust sandbox bindings; absence from npm scripts does not make them unused.

`scripts/prepare-home-media.py`, `scripts/render-capability-reels.mjs` and
`design-assets/typography/build_subsets.py` rebuild current media or font assets.
`design-assets/capability-reels/build/` is disposable renderer output, separate
from the tracked source and final browser media. The two `install-*-skill.sh`
scripts serve manual host Codex sessions; website workers install bundled skills
automatically from release resources.

`npm run test:source` checks TypeScript imports, re-exports and literal dynamic
imports from `web/src/main.tsx`. Test-only imports do not make a product module
reachable. Runtime-loaded assets and backend tools require a separate reference
audit; this check is not a general-purpose file deletion tool.

Release snapshots follow the bounded, reference-aware retention policy in
[ROLLING_UPDATES.md](ROLLING_UPDATES.md); use `npm run release:prune` for a dry run.
