# Yingya sandbox tools

The current turn includes the actual Python/browser configuration. Use it instead
of assuming a desktop machine or scanning host directories. This sandbox has shell
tools; a dedicated Browser plugin is not provided.

- `python` and `python3` use the shared Python 3.12 environment when configured.
  It is installed once by the host with uv and mounted read-only for every user.
  Do not run pip/uv installs in a production turn. Python's user-site is disabled.
- Bundled modules: requests/httpx, bs4/lxml, PIL (Pillow), numpy/pandas/scipy,
  matplotlib (headless Agg backend), pypdf, docx, pptx, openpyxl. Store outputs
  inside the project. Use Pillow for image size, alpha, contact sheets and pixel
  inspection; matplotlib/SVG for chart generation; ffprobe/ffmpeg for
  media duration, streams, decoded frames and conversion.
- For a capability-dependent task, `node "$YINGYA_RUNTIME_TOOLS" --probe-browser`
  checks Python imports, a headless browser launch and WebGL once without creating
  media or installing anything. Omit the flag if no rendered page is needed.
  A failed capability probe is a limitation, not a reason to repeat path guesses.

## Web content and browser automation

Read static web pages with Python requests + BeautifulSoup or Node.js fetch.
Check HTTP status and content before treating the result as usable source data.
The current host relay does not implement standalone web search or Apps MCP;
those built-in tools are disabled. The separately configured shadcn MCP can
search its component registries; it is not general web search. Use known official
pages or user-supplied sources. Direct HTTP retrieval is not a search engine: disclose missing discovery
capabilities when needed and never invent source content.

When HYPERFRAMES_BROWSER_PATH is configured, pass it explicitly to Playwright:

Save this as a `.mjs` file and execute it with `node`, or use
`node --input-type=module` for stdin:

```js
import { createRequire } from 'node:module';
import { join } from 'node:path';
const fromRuntime = createRequire(join(process.env.YINGYA_NODE_MODULES, 'playwright/package.json'));
const { chromium } = fromRuntime('playwright');
const browser = await chromium.launch({
  executablePath: process.env.HYPERFRAMES_BROWSER_PATH,
  headless: true,
  timeout: 8000,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try { /* open page, inspect, capture */ } finally { await browser.close(); }
```

The configured wrapper handles sandbox network routing. Do not use Playwright's
default `chromium.executablePath()` or search ~/.cache/ms-playwright, /opt/google/chrome,
or /usr/bin/chromium. Do not download another browser.

If browser launch is unavailable, use HTTP retrieval for text and Pillow/ffmpeg
for existing media. These alternatives cannot validate JavaScript page rendering.
Report that limitation when it blocks delivery. If only WebGL is unavailable,
use an approved HTML/CSS/SVG/Canvas 2D treatment or explain why the requested 3D
result needs another runtime. Do not silently substitute a different result.

HyperFrames uses the same configured browser. On a JavaScript initialization
error, inspect the first page error and generated source, then make a targeted
fix; repeating check/render with the same source does not repair it. Plain
Playwright can help distinguish a source error from HyperFrames bundling behavior.

## Unified component library

`$YINGYA_COMPONENT_LIBRARY` is the installed entrypoint for local scene discovery
and installation, React Bits / Magic UI registry search/import/diagnostics, and
browser bundle builds. Use `node "$YINGYA_COMPONENT_LIBRARY" catalog` as needed; local
`catalog` / `list` needs no project and can inform planning. Read
[reusable-motion.md](reusable-motion.md) for installed packs or
[third-party-components.md](third-party-components.md) for registry components.
Those references contain the commands and timing contract; the catalog and
installed pack README are the source of truth for available components and APIs.

The host owns the pinned shadcn CLI and each user's shadcn MCP. Project writes
require an explicit `--project` destination. The legacy
`$YINGYA_ANIME_COMPONENTS` installer remains available for existing Anime.js
projects; new discovery uses the unified entrypoint. Do not run
`npx ...@latest`, initialize a replacement app, or install a shared CLI inside a
video task. Import success is not proof of a verified video.

## Existing video analysis and assembly

Two installed project tools are available without installing dependencies:

```sh
python3 "$YINGYA_MEDIA_ANALYSIS" --project . --source assets/inbox/recording.mp4 --json
node "$YINGYA_EDITORIAL_ASSEMBLER" --project . --scenes scenes.json --width 1920 --height 1080 --fps 30
```

Read [existing-footage.md](existing-footage.md) for source selection, exact scene
fields, original audio, supported timing and overwrite protection. Analysis
caches validated keyframes and metadata by content/analysis version inside the
project; it does not provide semantic recognition or transcription. Assembly
uses the existing `scenes.json`, static media and an installed camera adapter.
Inspect the actual source before choosing intervals. Analysis is allowed during
intake; composition creation still follows the existing plan authorization.

## Audio and command results

For every shell tool, preserve the full result: `text(await tools.exec_command(...))`,
not `text(result.output)`. A `session_id` with no `exit_code` is still running.
Poll that same session with `write_stdin` and preserve its entire result too.
`functions.exec` finishing refers to the wrapper, not a yielded child process.
No output for 30 seconds does not mean failure, completion, or a need to stop.

Use the durable runner for production checks/renders (REQUEST is the current
request ID supplied in the turn). Paths are relative to the project root:

```sh
python3 "$YINGYA_PRODUCTION_TASK" check --request-id REQUEST --source . --output .yingya/reports/check-draft-N.json --continue-workflow
python3 "$YINGYA_PRODUCTION_TASK" render --request-id REQUEST --source . --output renders/draft-N.mp4 --quality high --resolution landscape --fps 30 --continue-workflow
python3 "$YINGYA_PRODUCTION_TASK" status --request-id REQUEST
```

Pass extra supported check options after `--`. The runner prints a job ID before
starting work, saves stdout/stderr separately, and publishes complete JSON/video
atomically. Poll the original shell session; if its handle was lost, query `status`.
`busy` means wait for the recorded job. A passed check is reusable only when source,
dependencies, options, and output hashes match. The runner refuses to overwrite an
unrelated existing output: retain it and choose a new report/video filename.
Successful rendering also returns `renderVerification` and
`renderVerificationSha256`. Read that output-bound report and open its decoded
MP4 frames before registering the draft. It verifies extraction and produces
review evidence; `requiresVisualReview` means the model must still check the
actual source content, framing and result, not merely quote a passing flag.
Never redirect stderr into the report or use `; echo` to replace a failure exit code.
Use `--continue-workflow` only when the user authorized completing production;
omit it for diagnosis, explanation, or a check-only request. It permits bounded
continuation of the original request, never expansion into another task.

At an actual blocker or a question requiring the user, save
`.yingya/turn-result.json` as
`{"requestId":"REQUEST","disposition":"needs_input","reason":"具体缺失信息"}`
(or disposition `blocked` for an execution blocker). This prevents automatic
continuation. Do not write a blocker for a yielded command: keep polling it.
Complete a real plan/draft checkpoint when review is required; never use an
automatic continuation to bypass user approval. The backend can continue at most
two extra rounds when new successful execution evidence arrives, within this same
authorized request. It never treats that evidence as approval or media quality.

Yingya does not limit media generation by count. Token limits and disabled-account
checks still apply. Reuse valid existing narration on retries and visual-only
edits; unlimited counts do not make repeated synthesis useful.

Invoke the installed `hyperframes` command directly. Do not use `npx` to find or
download it in a project. A CLI on PATH does not imply its packages can be imported
from a project; use the explicit shared dependency path above for Playwright.
Use `.mjs` with `import`, or `.cjs` with `require` and an async function; do not mix
CommonJS `require` with top-level `await`. Run `node --check scripts/example.mjs`
before executing a newly generated Node script. Browser composition scripts also
need a page startup check: syntax checking alone cannot detect initialization errors.
Read the saved voice from `.yingya/voice.json`, not a guessed root `voice.json`.

VoxCPM2 health, voice listing and synthesis are separate operations. Use its
`health` command and preserve the project's saved voice; one successful list
request is not proof that synthesis passed. HeyGen music is a separate optional
service: skip it when the turn says it is unconfigured.

Keep independent probes separate, or collect their individual return codes.
`probe; next-command` hides the first exit status. `rg` returning 1 means no match;
an optional lookup miss is not a failed video task. Summarize recovery accurately
without concealing real render, validation or synthesis failures.
