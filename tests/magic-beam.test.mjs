import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { chromium } from 'playwright';

const base = new URL('../runtime/components/magic-beam/', import.meta.url);
const source = await readFile(new URL('magic-beam.js', base), 'utf8');
const css = await readFile(new URL('magic-beam.css', base), 'utf8');
let createBeam;
vm.runInNewContext(source, { YingyaComponents: { define(name, factory) { assert.equal(name, 'beam-network'); createBeam = factory; } } });

const example = {
  component: 'beam-network', startSeconds: 2, durationSeconds: 6,
  nodes: [
    { id: 'text', label: '文案', x: .16, y: .2 },
    { id: 'image', label: '图片', x: .16, y: .5 },
    { id: 'audio', label: '声音', x: .16, y: .8 },
    { id: 'story', label: '组织镜头', x: .5, y: .5 },
    { id: 'film', label: '生成视频', x: .84, y: .5 },
  ],
  edges: [
    { from: 'text', to: 'story', delaySeconds: 0, durationSeconds: 3 },
    { from: 'image', to: 'story', delaySeconds: .3, durationSeconds: 3 },
    { from: 'audio', to: 'story', delaySeconds: .6, durationSeconds: 3 },
    { from: 'story', to: 'film', delaySeconds: 2, durationSeconds: 3 },
  ],
};

test('Magic UI source and MIT license are preserved byte-for-byte at a fixed commit', async () => {
  const provenance = JSON.parse(await readFile(new URL('magic-beam.PROVENANCE.json', base), 'utf8'));
  assert.equal(provenance.license, 'MIT');
  assert.match(provenance.commit, /^[a-f0-9]{40}$/);
  for (const [file, entry] of Object.entries(provenance.files)) {
    assert.ok(entry.url.includes(`/${provenance.commit}/`));
    assert.equal(createHash('sha256').update(await readFile(new URL(file, base))).digest('hex'), entry.sha256);
  }
  const upstream = await readFile(new URL('magic-beam.upstream.tsx', base), 'utf8');
  assert.match(upstream, /const controlY = startY - curvature/);
  assert.match(upstream, /ease: \[0\.16, 1, 0\.3, 1\]/);
  assert.match(await readFile(new URL('magic-ui-LICENSE.md', base), 'utf8'), /Copyright \(c\) Magic UI/);
});

test('invalid graph, coordinates and unbounded schedules fail before touching a container', () => {
  for (const startSeconds of [NaN, Infinity, -1, '2']) assert.throws(() => createBeam(null, { ...example, startSeconds }), /startSeconds/);
  for (const durationSeconds of [NaN, Infinity, 0, 121]) assert.throws(() => createBeam(null, { ...example, durationSeconds }), /durationSeconds/);
  assert.throws(() => createBeam(null, { ...example, nodes: [example.nodes[0], example.nodes[0]] }), /unique/);
  assert.throws(() => createBeam(null, { ...example, nodes: [{ ...example.nodes[0], x: 2 }, example.nodes[1]] }), /\.x/);
  assert.throws(() => createBeam(null, { ...example, edges: [{ from: 'text', to: 'missing' }] }), /distinct node IDs/);
  assert.throws(() => createBeam(null, { ...example, edges: [{ from: 'text', to: 'image', reverse: 'yes' }] }), /boolean/);
  for (const iterations of [Infinity, .5, 21]) assert.throws(() => createBeam(null, { ...example, edges: [{ from: 'text', to: 'image', iterations }] }), /iterations/);
  assert.throws(() => createBeam(null, { ...example, edges: [{ from: 'text', to: 'image', delaySeconds: 5, durationSeconds: 2 }] }), /fit/);
  assert.throws(() => createBeam(null, example), /connected HTML element/);
  assert.throws(() => createBeam({ nodeType: 1, isConnected: true, style: {}, childNodes: [{}] }, example), /preserved/);
});

test('browser graph is deterministic across arbitrary seeks, isolated instances, scaled and portrait canvases', async t => {
  // Browser plugin not available. Reuse the installed Playwright browser;
  // route an isolated document without starting or changing any dev service.
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const evidenceDirectory = process.env.YINGYA_MAGIC_EVIDENCE || '/tmp/yingya-magic-beam';
  await mkdir(evidenceDirectory, { recursive: true });
  for (const [width, height, scale] of [[1280, 720, 1], [390, 844, 1], [1280, 720, .5]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    const errors = [], failed = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('requestfailed', request => failed.push(request.url()));
    const config = structuredClone(example);
    if (width < height) {
      config.nodes = [
        { id: 'text', label: '文案', x: .2, y: .2 },
        { id: 'image', label: '图片', x: .5, y: .2 },
        { id: 'audio', label: '声音', x: .8, y: .2 },
        { id: 'story', label: '组织镜头', x: .5, y: .5 },
        { id: 'film', label: '生成视频', x: .5, y: .8 },
      ];
    }
    await page.route('https://magic-beam.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>映芽分支汇聚镜头测试</title><style>${css}
      html,body{margin:0;background:#f4f5f7;color:#17263f;font-family:Arial,sans-serif;}
      #film{position:relative;width:${width}px;height:${height}px;transform:scale(${scale});transform-origin:top left;--film-accent:#1479dc;--film-surface:white;--film-line:#8295ae;--ygc-beam-width:5px;--ygc-radius:18px;}
      #primary,#secondary{position:absolute;inset:0;}#secondary{visibility:hidden;}
      </style></head><body><main id="film"><section id="primary"></section><section id="secondary"></section></main>
      <script>window.YingyaComponents={define(name,factory){window.factory=factory;}};</script><script>${source}</script><script>
      window.config=${JSON.stringify(config)};window.first=factory(document.querySelector('#primary'),config);window.second=factory(document.querySelector('#secondary'),{...config,startSeconds:5});
      window.state=()=>[...document.querySelectorAll('#primary linearGradient,#primary .ygc-beam-light,#primary .ygc-beam-network')].map(el=>({tag:el.tagName,style:el.getAttribute('style'),opacity:el.getAttribute('opacity'),coordinates:['x1','x2','y1','y2'].map(key=>el.getAttribute(key))}));
      </script></body></html>` }));
    await page.goto('https://magic-beam.test/');
    assert.equal(await page.title(), '映芽分支汇聚镜头测试');
    assert.equal(await page.locator('#primary .ygc-beam-node').count(), 5);
    assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(), 0);
    assert.equal(await page.locator('#primary svg').getAttribute('viewBox'), `0 0 ${width} ${height}`);
    const ids = await page.locator('linearGradient').evaluateAll(elements => elements.map(element => element.id));
    assert.equal(ids.length, new Set(ids).size, 'SVG paint IDs must be unique across instances');
    const snapshots = new Map();
    for (const seconds of [0, 2, 2.3, 3, 4.4, 7.5, 8, 50]) {
      snapshots.set(seconds, await page.evaluate(seconds => { first.renderAt(seconds); return state(); }, seconds));
    }
    for (const seconds of [4.4, 0, 7.5, 2.3, 8, 3, 50, 2]) {
      assert.deepEqual(await page.evaluate(seconds => { first.renderAt(seconds); return state(); }, seconds), snapshots.get(seconds));
    }
    await page.evaluate(() => { first.renderAt(2.3); second.renderAt(2.3); });
    assert.equal(await page.locator('#primary .ygc-beam-network').evaluate(element => getComputedStyle(element).visibility), 'visible');
    assert.equal(await page.locator('#secondary .ygc-beam-network').evaluate(element => getComputedStyle(element).visibility), 'hidden');
    const forward = await page.locator('#primary linearGradient').first().evaluate(element => ({ x: Number(element.getAttribute('x1')), y: Number(element.getAttribute('y1')) }));
    const before = await page.screenshot();
    await page.clock.install();
    await page.clock.runFor(1500);
    assert.deepEqual(await page.screenshot(), before, 'paused frame cannot advance with wall time');
    const screenshotPath = `${evidenceDirectory}/magic-beam-${width}x${height}-scale${scale}.png`;
    await page.screenshot({ path: screenshotPath });
    const bounds = await page.locator('#primary .ygc-beam-node').evaluateAll(elements => elements.map(element => {
      const a = element.getBoundingClientRect(), b = element.closest('#film').getBoundingClientRect();
      return a.left >= b.left && a.top >= b.top && a.right <= b.right && a.bottom <= b.bottom;
    }));
    assert.ok(bounds.every(Boolean), 'Chinese node labels must stay within the canvas');
    const reversed = await page.evaluate(() => {
      first.dispose(); first.dispose();
      const next = structuredClone(config); next.edges[0].reverse = true; next.nodes[0].label = '<b>中文</b>';
      window.third = factory(document.querySelector('#primary'), next); third.renderAt(2.3);
      const gradient = document.querySelector('#primary linearGradient');
      return { text: document.querySelector('#primary .ygc-beam-node').textContent, markup: document.querySelector('#primary b') !== null, x: Number(gradient.getAttribute('x1')), y: Number(gradient.getAttribute('y1')) };
    });
    assert.equal(reversed.text, '<b>中文</b>');
    assert.equal(reversed.markup, false, 'labels are content, never HTML');
    const start = config.nodes.find(node => node.id === config.edges[0].from), end = config.nodes.find(node => node.id === config.edges[0].to);
    assert.ok(Math.abs(forward.x + reversed.x - (start.x + end.x) * width) < 1e-6, 'reverse beam mirrors forward travel horizontally');
    assert.ok(Math.abs(forward.y + reversed.y - (start.y + end.y) * height) < 1e-6, 'reverse beam mirrors forward travel vertically');
    await page.evaluate(() => { first.renderAt(4); second.renderAt(5.2); });
    assert.equal(await page.locator('#secondary .ygc-beam-light[opacity="1"]').count(), 1, 'disposing one instance leaves the other functional');
    const repeated = await page.evaluate(() => {
      third.dispose();
      window.third = factory(document.querySelector('#primary'), { ...config, edges: [{ from: 'text', to: 'story', durationSeconds: 1, repeatDelaySeconds: .5, iterations: 2 }] });
      return [2.25, 3.25, 3.75, 4.75].map(seconds => {
        third.renderAt(seconds);
        const gradient = document.querySelector('#primary linearGradient');
        return { x1: gradient.getAttribute('x1'), y1: gradient.getAttribute('y1'), active: document.querySelector('#primary .ygc-beam-light').getAttribute('opacity') };
      });
    });
    assert.deepEqual(repeated[0], repeated[2], 'bounded repeated passes render the same local phase');
    assert.deepEqual(repeated.map(state => state.active), ['1', '0', '1', '0'], 'repeat gaps and the finite end stay still');
    await page.evaluate(() => { second.dispose(); third.dispose(); });
    assert.equal(await page.locator('linearGradient').count(), 0);
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    await page.close();
  }
});

test('the actual shared clock drives Magic UI through hf-seek and unregisters on disposal', async t => {
  const clock = await readFile(new URL('../runtime/components/clock.js', import.meta.url), 'utf8');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<main style="width:800px;height:450px"></main>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: clock });
  await page.addScriptTag({ content: source });
  await page.evaluate(async config => {
    window.scene = YingyaComponents.createScene(document.querySelector('main'), config);
    await scene.ready;
  }, example);
  assert.equal(await page.evaluate(() => YingyaComponents.size), 1);
  await page.evaluate(async () => {
    let pending;
    dispatchEvent(new CustomEvent('hf-seek', { detail: { time: 2.25, waitUntil(promise) { pending = promise; } } }));
    await pending;
  });
  assert.equal(await page.locator('.ygc-beam-light[opacity="1"]').count(), 1);
  const forwardFrame = await page.locator('svg').innerHTML();
  await page.evaluate(() => YingyaComponents.renderAt(7));
  await page.evaluate(() => YingyaComponents.renderAt(2.25));
  assert.equal(await page.locator('svg').innerHTML(), forwardFrame);
  await page.evaluate(() => { scene.dispose(); scene.dispose(); });
  assert.equal(await page.evaluate(() => YingyaComponents.size), 0);
  assert.equal(await page.locator('main > *').count(), 0);
  await page.evaluate(async config => {
    window.scene = YingyaComponents.createScene(document.querySelector('main'), config);
    await scene.ready;
  }, example);
  assert.equal(await page.locator('.ygc-beam-light[opacity="1"]').count(), 1, 'remount adopts the current global time');
  assert.deepEqual(errors, []);
});
