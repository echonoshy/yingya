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
those built-in tools are disabled. Use known official pages or user-supplied
sources. Direct HTTP retrieval is not a search engine: disclose missing discovery
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

## Audio and command results

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
