// Read-only capability probe: never downloads browsers or starts generation jobs.
import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const python = spawnSync('python3', ['-c', 'import json,sys,importlib.util; print(json.dumps({"version":sys.version.split()[0],"executable":sys.executable,"libraries":{x:importlib.util.find_spec(x) is not None for x in ["requests","httpx","bs4","lxml","PIL","numpy","pandas","scipy","matplotlib","pypdf","docx","pptx","openpyxl"]}}))'], { encoding: 'utf8', timeout: 10000 });
const result = { python: python.status === 0 ? JSON.parse(python.stdout) : { available: false },
  browser: { configured: false, executablePath: process.env.HYPERFRAMES_BROWSER_PATH ?? null },
  alternatives: { web: 'python3 requests + BeautifulSoup, or Node.js fetch', images: 'Pillow', video: 'ffprobe / ffmpeg', animation: 'HTML/CSS/SVG/GSAP; use Canvas 2D if WebGL is unavailable' } };
try { await access(result.browser.executablePath); result.browser.configured = true; } catch { /* Optional capability. */ }
if (process.argv.includes('--probe-browser') && result.browser.configured) {
  const watchdog = setTimeout(() => { result.browser.available = false; result.browser.error = 'Browser probe exceeded 15 seconds; use alternatives, do not retry the same launch.'; console.log(JSON.stringify(result, null, 2)); process.exit(1); }, 15000);
  let browser;
  try {
    const require = createRequire(join(process.env.YINGYA_NODE_MODULES, 'playwright/package.json'));
    const { chromium } = require('playwright');
    browser = await chromium.launch({ executablePath: result.browser.executablePath, headless: true, timeout: 8000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.setContent('<title>Yingya browser probe</title><canvas></canvas>', { timeout: 3000 });
    result.browser.available = await page.title() === 'Yingya browser probe';
    result.browser.webgl = await page.evaluate(() => !!document.querySelector('canvas').getContext('webgl'));
  } catch (error) {
    result.browser.available = false;
    result.browser.error = error.message;
  } finally {
    await browser?.close();
    clearTimeout(watchdog);
  }
}
console.log(JSON.stringify(result, null, 2));
