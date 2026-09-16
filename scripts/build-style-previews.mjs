// Render the same editable scene/style sources installed into new projects.
// Usage: node scripts/build-style-previews.mjs [style-id]
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'runtime/visual-styles');
const catalog = JSON.parse(await readFile(path.join(source, 'catalog.json'), 'utf8'));
const [css, scene, motion, fontCss] = await Promise.all([
  readFile(path.join(source, 'scenes.css'), 'utf8'), readFile(path.join(source, 'scene.html'), 'utf8'),
  readFile(path.join(source, 'motion.js'), 'utf8'), readFile(path.join(root, 'node_modules/@fontsource-variable/noto-sans-sc/index.css'), 'utf8'),
]);
const gsap = execFileSync('curl', ['--fail', '--silent', '--show-error', '--max-time', '45', 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js'], { encoding: 'utf8' });
const browser = await chromium.launch({ headless: true });
const temporary = await mkdtemp(path.join(tmpdir(), 'yingya-style-previews-'));
try {
  for (const style of catalog.filter(style => !process.argv[2] || style.id === process.argv[2])) {
    const directory = path.join(root, 'web/public/visual-styles', style.id, `v${style.version}`);
    const frames = path.join(temporary, style.id);
    await mkdir(directory, { recursive: true });
    await mkdir(frames, { recursive: true });
    const tokens = Object.entries(style.tokens).map(([key, value]) => `--ys-${key}:${value};`).join('');
    const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const fonts = fontCss.replaceAll('./files/', 'https://style-preview.test/fonts/').replaceAll('Noto Sans SC Variable', 'Noto Sans SC');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${fonts}\n:root{${tokens}}body{margin:0} ${css}</style></head><body>${scene.replaceAll('{{layout}}', style.layout).replace('class="ys-scene"', 'class="ys-scene" style="--frame-width:960px;--frame-height:540px"')}<script>${gsap}</script><script>${motion}\nwindow.timeline=gsap.timeline({paused:true});yingyaStyleEntrance(window.timeline,document.querySelector('.ys-scene'),${JSON.stringify(style.motion)});</script></body></html>`;
    await page.route('https://style-preview.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.startsWith('/fonts/')) return route.fulfill({ contentType: 'font/woff2', body: await readFile(path.join(root, 'node_modules/@fontsource-variable/noto-sans-sc/files', path.basename(url.pathname))) });
      return route.fulfill({ contentType: 'text/html', body: html });
    });
    await page.goto('https://style-preview.test/');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { window.timeline.seek(5); });
    await page.screenshot({ path: path.join(directory, 'poster.jpg'), type: 'jpeg', quality: 90 });
    for (let frame = 0; frame < 144; frame++) {
      await page.evaluate(time => { window.timeline.seek(time); }, frame / 24);
      await page.screenshot({ path: path.join(frames, `${String(frame).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 88 });
    }
    if (errors.length) throw new Error(errors.join('\n'));
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '24', '-i', path.join(frames, '%04d.jpg'), '-c:v', 'libx264', '-preset', 'fast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(directory, 'preview.mp4')]);
    await writeFile(path.join(directory, 'source.json'), JSON.stringify({ id: style.id, version: style.version, duration: 6, fps: 24, width: 960, height: 540, source: 'runtime/visual-styles', description: '映芽原创同源风格预览' }, null, 2));
    console.log(`Rendered ${style.name}: ${directory}`);
    await page.close();
  }
} finally { await browser.close(); await rm(temporary, { recursive: true, force: true }); }
