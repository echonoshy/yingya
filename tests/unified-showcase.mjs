// An isolated acceptance composition for the installed Anime/Magic/Three packs.
// All generated source, checks and media belong in the caller's output directory.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildUnifiedShowcase(output) {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'DESIGN.md'), `# 统一组件验收作品

## Style Prompt
An original Chinese explanatory film using the existing Yingya component sample
visual language. A white canvas, clear Chinese typography, one strong blue,
three different scene purposes: reveal an idea, connect multiple inputs, then
show the physical form of an original geometric object. This is an integration
fixture, not a product claim or a downloaded commercial model.

## Colors
- Canvas #ffffff
- Ink #19232f
- Supporting text #48576a
- Accent #185bd8
- Surface #edf2fa
- The fixture model retains its authored blue, warm detail and neutral base.

## Typography
Reuse the repository's locally bundled Noto Sans SC Variable and its existing
Chinese acceptance-sample typography: 600 headlines, 400 support, clear spacing.

## Motion
Finite absolute-time motion: Anime title reveal, Magic UI connection paths,
Three.js product turntable. Crossfades between scenes; readable final hold.

## What NOT to Do
No remote assets, new fonts, random timing, pointer/scroll input, perpetual loops,
invented factual claims, purchased models, ornamental app interface or audio.
`);
  for (const component of ['title-reveal', 'beam-network', 'model-stage']) execFileSync(process.execPath, [path.join(repo, 'runtime/component-library.mjs'), 'install', '--project', output, '--component', component]);
  await fs.copyFile(path.join(repo, 'runtime/editorial/vendor/gsap-3.14.2.min.js'), path.join(output, 'assets/gsap.min.js'));
  await fs.copyFile(path.join(repo, 'runtime/editorial/vendor/GSAP-LICENSE'), path.join(output, 'assets/GSAP-LICENSE'));
  const fonts = path.join(repo, 'node_modules/@fontsource-variable/noto-sans-sc');
  await fs.cp(path.join(fonts, 'files'), path.join(output, 'assets/fonts/files'), { recursive: true });
  await fs.copyFile(path.join(fonts, 'index.css'), path.join(output, 'assets/fonts/fonts.css'));
  await fs.copyFile(path.join(fonts, 'LICENSE'), path.join(output, 'assets/fonts/LICENSE'));
  const fontFaces = (await fs.readFile(path.join(fonts, 'index.css'), 'utf8')).replaceAll('url(./files/', 'url(assets/fonts/files/');
  await fs.writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>映芽 · 统一组件验收</title>
<link rel="stylesheet" href="assets/fonts/fonts.css">
<link rel="stylesheet" href="assets/animejs/scenes.css">
<link rel="stylesheet" href="assets/yingya-components/magic-beam/magic-beam.css">
<style>
${fontFaces}
html,body {margin:0;background:#fff;}
#composition {position:relative;width:960px;height:540px;overflow:hidden;font-family:'Noto Sans SC Variable',sans-serif;
 --film-ink:#19232f;--film-accent:#185bd8;--film-surface:#edf2fa;--film-line:#b7c5d9;--film-font:'Noto Sans SC Variable',sans-serif;--film-radius:16px;
 --yga-font:'Noto Sans SC Variable',sans-serif;--yga-background:#fff;--yga-foreground:#19232f;--yga-muted:#48576a;--yga-accent:#185bd8;--yga-surface:#edf2fa;--yga-heading-weight:600;}
.sample-scene {position:absolute;inset:0;background:#fff;opacity:0;}
.scene-content {box-sizing:border-box;width:100%;height:100%;padding:42px 60px;display:flex;flex-direction:column;gap:20px;}
h2 {font-size:60px;line-height:1.2;letter-spacing:-.035em;font-weight:600;color:#19232f;margin:0;}
p {font-size:22px;line-height:1.5;color:#48576a;margin:0;}
#network {width:840px;height:330px;--ygc-node-font-size:22px;--ygc-node-padding:16px;--ygc-node-min-width:110px;}
.model-layout {display:flex;align-items:center;gap:20px;height:350px;}
.model-copy {width:320px;display:flex;flex-direction:column;gap:18px;}
#model {width:440px;height:350px;}
</style>
<script src="assets/gsap.min.js"></script>
<script src="assets/animejs/anime.umd.min.js"></script>
<script src="assets/animejs/scenes.js"></script>
<script src="assets/yingya-components/clock.js"></script>
<script src="assets/yingya-components/magic-beam/magic-beam.js"></script>
</head><body>
<main id="composition" data-composition-id="main" data-start="0" data-duration="14" data-width="960" data-height="540" data-fps="30">
<section id="title-scene" class="sample-scene"></section>
<section id="beam-scene" class="sample-scene"><div class="scene-content"><h2>让素材，汇成故事</h2><div id="network"></div></div></section>
<section id="model-scene" class="sample-scene"><div class="scene-content"><h2>让形体，清晰可见</h2><div class="model-layout"><div class="model-copy"><p>本地模型 · 固定灯光</p><p>旋转与动作，跟随视频时间</p><p>原创几何示例</p></div><div id="model" aria-label="原创三维几何模型"></div></div></div></section>
</main>
<script>
YingyaAnime.createScene(document.querySelector('#title-scene'),{component:'title-reveal',startSeconds:0,durationSeconds:4,title:'让想法，动起来',eyebrow:'映芽 · 成熟组件组合',subtitle:'从文字，到连接，再到立体形体'});
window.network = YingyaComponents.createScene(document.querySelector('#network'),{component:'beam-network',startSeconds:4,durationSeconds:5,
 nodes:[{id:'text',label:'文案',x:.14,y:.18},{id:'image',label:'图片',x:.14,y:.5},{id:'audio',label:'声音',x:.14,y:.82},{id:'story',label:'组织镜头',x:.5,y:.5},{id:'film',label:'生成视频',x:.85,y:.5}],
 edges:[{from:'text',to:'story',durationSeconds:2},{from:'image',to:'story',delaySeconds:.3,durationSeconds:2},{from:'audio',to:'story',delaySeconds:.6,durationSeconds:2},{from:'story',to:'film',delaySeconds:1.8,durationSeconds:2.3}]});
const tl = gsap.timeline({paused:true});
tl.to('#title-scene',{opacity:1,duration:.25},.1);
tl.to('#beam-scene',{opacity:1,duration:.4},4).to('#title-scene',{opacity:0,duration:.4},4);
tl.from('#beam-scene h2',{y:20,opacity:0,duration:.55,ease:'power3.out'},4.12);
tl.from('#network',{y:14,opacity:0,duration:.5,ease:'power2.out'},4.2);
tl.to('#model-scene',{opacity:1,duration:.4},9).to('#beam-scene',{opacity:0,duration:.4},9);
tl.from('#model-scene h2',{y:20,opacity:0,duration:.55,ease:'power3.out'},9.12);
tl.from('#model-scene p',{y:14,opacity:0,duration:.5,stagger:.12,ease:'power2.out'},9.2);
tl.from('#model',{x:20,opacity:0,duration:.7,ease:'power4.out'},9.3);
tl.to('#model-scene',{opacity:0,duration:.35},13.65);
window.__timelines = {main:tl};
</script>
<script type="module">
import './assets/yingya-components/three-model/model-scene.js';
window.model = YingyaComponents.createScene(document.querySelector('#model'),{component:'model-stage',modelUrl:'assets/yingya-components/three-model/sample-model.glb',startSeconds:9,durationSeconds:5,width:440,height:350,motion:'turntable',turns:.65,animationClip:'detail-slide'});
window.__unifiedReady = model.ready;
</script>
</body></html>`);
  await fs.writeFile(path.join(output, 'index.motion.json'), JSON.stringify({ duration: 14, assertions: [
    { kind: 'appearsBy', selector: '#title-scene', bySec: 1 },
    { kind: 'appearsBy', selector: '#beam-scene', bySec: 4.8 },
    { kind: 'appearsBy', selector: '#model-scene', bySec: 9.8 },
    ...['title-scene', 'beam-scene', 'model-scene'].map(id => ({ kind: 'staysInFrame', selector: `#${id}` })),
  ] }, null, 2));
  await fs.writeFile(path.join(output, 'hyperframes.json'), JSON.stringify({ name: 'yingya-unified-components-showcase', fps: 30 }, null, 2));
  return output;
}

export async function verifyUnifiedSeeks(output) {
  // Browser plugin not available. Route the immutable fixture's own local assets
  // in Playwright; no development service or remote network dependency.
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let unblock;
  const slowModel = new Promise(resolve => { unblock = resolve; });
  const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary' };
  try {
    await page.route('https://yingya-components.test/**', async route => {
      const relative = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '') || 'index.html';
      if (relative.split('/').includes('..')) return route.fulfill({ status: 400, body: 'invalid path' });
      if (relative.endsWith('.glb')) await slowModel;
      const file = path.join(output, relative);
      try { return route.fulfill({ contentType: contentTypes[path.extname(file)] || 'application/octet-stream', body: await fs.readFile(file) }); }
      catch { return route.fulfill({ status: 404, body: 'missing local asset' }); }
    });
    await page.goto('https://yingya-components.test/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__unifiedReady && window.YingyaComponents?.size === 2);
    assert.equal(await page.title(), '映芽 · 统一组件验收');
    await page.evaluate(() => {
      window.pendingComplete = false;
      const work = [];
      dispatchEvent(new CustomEvent('hf-seek', { detail: { time: 12, waitUntil: promise => work.push(promise) } }));
      window.pendingModel = Promise.all(work).then(() => { window.pendingComplete = true; });
    });
    assert.equal(await page.evaluate(() => pendingComplete), false, 'hf-seek must wait for model loading');
    unblock();
    await page.evaluate(() => pendingModel);
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('#model').getAttribute('data-yingya-model-state'), 'ready');
    const hashes = new Map();
    async function seek(time) {
      await page.evaluate(async time => {
        Object.values(__timelines).forEach(timeline => { timeline.pause(); timeline.seek(time, false); });
        __hfAnime.forEach(timeline => { timeline.pause(); timeline.seek(time * 1000); });
        const pending = [];
        dispatchEvent(new CustomEvent('hf-seek', { detail: { time, waitUntil: promise => pending.push(promise) } }));
        await Promise.all(pending);
      }, time);
      return createHash('sha256').update(await page.screenshot()).digest('hex');
    }
    for (const time of [2, 6.5, 10.5, 12.8]) hashes.set(time, await seek(time));
    for (const time of [6.5, 12.8, 2, 10.5, 6.5]) assert.equal(await seek(time), hashes.get(time), `all component pixels must repeat at ${time}s`);
    await page.screenshot({ path: path.join(output, 'unified-seek-6.5s.png') });
    assert.deepEqual(errors, []);
    const report = { ok: true, browser: 'Playwright Chromium (Browser plugin not available)', initialReadiness: 'hf-seek waits for delayed GLB', times: [...hashes.keys()], repeatedSeeks: 5, pageErrors: errors };
    await fs.writeFile(path.join(output, 'seek-check.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally { unblock(); await browser.close(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node tests/unified-showcase.mjs OUTPUT');
  const output = path.resolve(process.argv[2]);
  console.log(process.argv.includes('--verify-only') ? await verifyUnifiedSeeks(output) : await buildUnifiedShowcase(output));
}
