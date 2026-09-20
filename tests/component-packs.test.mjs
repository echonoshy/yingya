import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { installPack, listPacks, viewPack } from '../runtime/component-library.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clockSource = await fs.readFile(path.join(repository, 'runtime/components/clock.js'), 'utf8');
const previewSource = await fs.readFile(path.join(repository, 'web/preview-player.js'), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yingya-component-packs-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function inventory(directory, relative = '') {
  const entries = {};
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(entries, await inventory(directory, name));
    else entries[name] = entry.isSymbolicLink() ? `link:${await fs.readlink(path.join(directory, name))}` : digest(await fs.readFile(path.join(directory, name)));
  }
  return entries;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}

function clockHarness() {
  const listeners = new Map(), events = [];
  class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } }
  const window = {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) || [];
      handlers.push(handler); listeners.set(type, handlers);
    },
    dispatchEvent(event) {
      events.push(event);
      for (const handler of listeners.get(event.type) || []) handler(event);
    },
  };
  vm.runInNewContext(clockSource, { window, CustomEvent });
  return {
    api: window.YingyaComponents, events,
    seek(time) {
      const pending = [];
      window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time, waitUntil(promise) { pending.push(promise); } } }));
      return Promise.all(pending);
    },
    previewSeek(time) { window.dispatchEvent(new CustomEvent('hf-seek', { detail: { time } })); },
  };
}

test('offline catalog and guides distinguish usable packs from raw registry sources without initializing a project', async () => {
  const catalog = await listPacks();
  const ids = catalog.components.map(item => item.id);
  assert.deepEqual(new Set(ids), new Set(['title-reveal', 'flow-path', 'number-compare', 'beam-network', 'model-stage', 'explain-concept', 'explain-process', 'explain-compare', 'explain-data', 'explain-cause', 'explain-footage']));
  assert.equal(ids.length, new Set(ids).size);
  assert.ok((await listPacks({ query: '汇聚' })).components.some(item => item.id === 'beam-network'));
  for (const provider of ['@react-bits', '@magicui']) assert.equal(catalog.sources.find(source => source.id === provider).status, 'requires-adaptation');
  for (const item of catalog.components) {
    const detail = await viewPack(item.id);
    assert.equal(detail.id, item.id);
    assert.ok(detail.documentation?.length > 100 || detail.details?.example, `${item.id} has usable offline guidance`);
  }
  const output = execFileSync(process.execPath, [path.join(repository, 'runtime/component-library.mjs'), 'catalog', '--json'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output).components.map(item => item.id), ids);
  await assert.rejects(installPack({ component: '@magicui/animated-beam', project: '/unused' }), /Unknown local component/);
});

test('local installs are on demand, share one clock, preserve sources and do not create React dependencies', async t => {
  const project = await temporary(t);
  await fs.writeFile(path.join(project, 'index.html'), '<p>Keep authored video</p>');
  const first = await installPack({ project, component: 'beam-network' });
  const destination = path.join(project, first.directory);
  const before = await inventory(project);
  assert.ok(Object.hasOwn(before, first.script));
  assert.ok(Object.hasOwn(before, first.styles));
  assert.ok(Object.hasOwn(before, first.guide));
  assert.ok(Object.keys(before).some(name => name.endsWith('magic-beam.upstream.tsx')));
  assert.ok(Object.keys(before).some(name => name.endsWith('magic-ui-LICENSE.md')));
  assert.ok(!Object.keys(before).some(name => name.includes('three-model') || name.includes('node_modules') || name.startsWith('component-library/')));
  const clockTime = (await fs.stat(path.join(project, first.clock))).mtimeMs;
  await installPack({ project, component: 'beam-network' });
  assert.deepEqual(await inventory(project), before);
  assert.equal((await fs.stat(path.join(project, first.clock))).mtimeMs, clockTime);
  await fs.writeFile(path.join(destination, 'customer-note.txt'), 'Keep local notes');
  const second = await installPack({ project, component: 'model-stage' });
  assert.equal(second.clock, first.clock);
  assert.equal((await fs.stat(path.join(project, second.clock))).mtimeMs, clockTime);
  const final = await inventory(project);
  assert.equal(Object.keys(final).filter(name => name.endsWith('/clock.js')).length, 1);
  for (const [name, value] of Object.entries(before)) assert.equal(final[name], value, `${name} must remain unchanged`);
  assert.equal(await fs.readFile(path.join(destination, 'customer-note.txt'), 'utf8'), 'Keep local notes');
  assert.ok(Object.hasOwn(final, second.script));
  for (const installed of [first, second]) {
    const manifest = JSON.parse(await fs.readFile(path.join(project, installed.manifest), 'utf8'));
    for (const [name, expected] of Object.entries(manifest.files)) assert.equal(digest(await fs.readFile(path.join(destination, name))), expected);
  }
  const anime = await installPack({ project, component: 'title-reveal' });
  assert.equal(anime.status, 'installed');
  assert.equal((await installPack({ project, component: 'number-compare' })).status, 'unchanged');
  assert.equal(await fs.readFile(path.join(project, 'index.html'), 'utf8'), '<p>Keep authored video</p>');
});

test('edited or handwritten files block the full install before any other file changes', async t => {
  for (const modified of ['clock', 'script']) {
    const project = await temporary(t);
    const installed = await installPack({ project, component: 'beam-network' });
    await fs.appendFile(path.join(project, installed[modified]), '\n// author customization\n');
    const before = await inventory(project);
    const component = modified === 'clock' ? 'model-stage' : 'beam-network';
    await assert.rejects(installPack({ project, component }), /preserving existing edits/);
    assert.deepEqual(await inventory(project), before);
  }
  const project = await temporary(t);
  const handmade = path.join(project, 'assets/yingya-components/magic-beam/magic-beam.js');
  await fs.mkdir(path.dirname(handmade), { recursive: true });
  await fs.writeFile(handmade, '// manually authored');
  const before = await inventory(project);
  await assert.rejects(installPack({ project, component: 'beam-network' }), /preserving existing edits/);
  assert.deepEqual(await inventory(project), before, 'even the shared clock must not be partially installed');
});

test('install paths cannot escape through existing assets, pack or file symlinks', async t => {
  for (const relative of ['assets', 'assets/yingya-components/magic-beam', 'assets/yingya-components/clock.js']) {
    const project = await temporary(t), outside = await temporary(t);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'protected');
    const link = path.join(project, relative);
    await fs.mkdir(path.dirname(link), { recursive: true });
    await fs.symlink(relative.endsWith('.js') ? path.join(outside, 'keep.txt') : outside, link);
    const before = await inventory(project);
    await assert.rejects(installPack({ project, component: 'beam-network' }), /Symlinks/);
    assert.deepEqual(await inventory(project), before);
    assert.deepEqual(await fs.readdir(outside), ['keep.txt']);
    assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'protected');
  }
});

test('clock waits for resource readiness and applies the latest pending absolute time exactly once', async () => {
  const { api, seek } = clockHarness(), ready = deferred(), frames = [];
  let disposals = 0;
  const instance = { ready: ready.promise, startSeconds: 2, durationSeconds: 6, renderAt(time) { frames.push(time); }, dispose() { disposals++; } };
  const first = api.register(instance);
  assert.equal(api.register(instance), first);
  assert.equal(api.size, 1);
  assert.equal(api.durationSeconds, 8);
  let completed = false;
  const ahead = seek(6).then(() => { completed = true; });
  const backwards = seek(3);
  await Promise.resolve();
  assert.equal(completed, false);
  assert.deepEqual(frames, []);
  ready.resolve();
  await Promise.all([ahead, backwards, first.ready]);
  assert.deepEqual(frames, [3]);
  await seek(7); await seek(2.5); await seek(7);
  assert.deepEqual(frames.slice(-3), [7, 2.5, 7]);
  first.dispose(); first.dispose();
  await seek(5);
  assert.equal(disposals, 1);
  assert.equal(api.size, 0);
  assert.equal(api.durationSeconds, 0);
  assert.equal(frames.at(-1), 7);
});

test('asset rejection fails capture and emits an error for a preview seek without waitUntil', async () => {
  const harness = clockHarness(), ready = deferred();
  const instance = harness.api.register({ ready: ready.promise, renderAt() { assert.fail('failed assets must never draw'); }, dispose() {} });
  const pending = harness.seek(2);
  const captured = assert.rejects(pending, /model texture unavailable/);
  const direct = assert.rejects(instance.ready, /model texture unavailable/);
  ready.reject(new Error('model texture unavailable'));
  await Promise.all([captured, direct]);
  await assert.rejects(harness.seek(1), /model texture unavailable/);
  harness.previewSeek(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(harness.events.some(event => event.type === 'yingya-component-error' && event.detail.message === 'model texture unavailable'));
  instance.dispose();
  await harness.seek(1);
});

test('disposing an unloaded scene prevents its later ready resolution from resurrecting DOM work', async () => {
  const { api, seek } = clockHarness(), ready = deferred(), frames = [];
  let disposals = 0;
  const handle = api.register({ ready: ready.promise, renderAt(time) { frames.push(time); }, dispose() { disposals++; } });
  const pending = seek(5);
  handle.dispose();
  ready.resolve();
  await Promise.all([pending, handle.ready]);
  assert.equal(api.size, 0);
  assert.equal(disposals, 1);
  assert.deepEqual(frames, []);
  await assert.rejects(seek(-1), /nonnegative/);
});

test('each capture seek waits for its own asynchronous frame commit, beyond initial resource readiness', async () => {
  const { api, seek } = clockHarness(), commits = [], frames = [];
  const handle = api.register({
    renderAt(time) {
      const commit = deferred(); commits.push(commit);
      return commit.promise.then(() => { frames.push(time); });
    },
    dispose() {},
  });
  // Initial drawing may be repeated while the synchronous registration settles.
  await Promise.resolve();
  for (const commit of commits.splice(0)) commit.resolve();
  await handle.ready;
  let completed = false;
  const frame = seek(4).then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false, 'hf-seek.waitUntil must cover the current React frame, not only the first ready promise');
  commits[0].resolve();
  await frame;
  assert.equal(frames.at(-1), 4);
  handle.dispose();
});

test('a synchronous first-frame failure does not leave a broken registered instance', () => {
  const { api } = clockHarness();
  let disposals = 0;
  assert.throws(() => api.register({ renderAt() { throw new Error('cannot draw'); }, dispose() { disposals++; } }), /cannot draw/);
  assert.equal(api.size, 0);
  assert.equal(disposals, 1);
});

test('a later asynchronous frame failure rejects the capture wait', async () => {
  const { api, seek } = clockHarness();
  const handle = api.register({ renderAt(time) { return time > 0 ? Promise.reject(new Error('React frame commit failed')) : Promise.resolve(); }, dispose() {} });
  await handle.ready;
  await assert.rejects(seek(2), /React frame commit failed/);
  handle.dispose();
});

test('mixed synchronous and asynchronous frame errors are all observed without orphaned rejections', () => {
  // Isolate the process-level unhandledRejection probe from the test runner.
  const script = `import vm from 'node:vm';
    const clockSource=${JSON.stringify(clockSource)};
    const harness=(${clockHarness.toString()})();
    const unhandled=[];process.on('unhandledRejection',error=>unhandled.push(error.message));
    const first=harness.api.register({renderAt(time){if(time>0)return Promise.reject(new Error('async frame failed'));},dispose(){}});
    const second=harness.api.register({renderAt(time){if(time>0)throw new Error('sync frame failed');},dispose(){}});
    await Promise.all([first.ready,second.ready]);
    let failure;try{await harness.seek(2);}catch(error){failure=error.message;}
    await new Promise(resolve=>setImmediate(resolve));
    console.log(JSON.stringify({failure,unhandled}));`;
  const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }));
  assert.match(result.failure, /frame failed/);
  assert.deepEqual(result.unhandled, [], 'all pending component frames must remain observed when a sibling throws');
});

test('real preview player drives the shared component clock through play, pause, backwards seek, loop and asset errors', async t => {
  // Browser plugin not available. Reuse installed Playwright against a routed
  // isolated composition document; no development service is started.
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  await page.route('https://component-preview.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><head><meta charset="utf-8"><title>映芽统一组件时钟测试</title></head><body>
    <main data-composition-id="film" data-width="400" data-height="600" data-duration="6"><h1>统一视频时间</h1><output id="frame"></output></main>
    <script>${clockSource}</script><script>
    window.messages=[];addEventListener('message',event=>messages.push(event.data));
    window.instance=YingyaComponents.register({startSeconds:2,durationSeconds:4,renderAt(time){document.querySelector('#frame').textContent=time.toFixed(3);},dispose(){}});
    window.control=(playing,time)=>dispatchEvent(new MessageEvent('message',{source:window,data:{type:'yingya-preview-playback',playing,time}}));
    </script><script>${previewSource}</script></body></html>` }));
  await page.goto('https://component-preview.test/');
  assert.equal(await page.title(), '映芽统一组件时钟测试');
  assert.equal(await page.locator('h1').textContent(), '统一视频时间');
  assert.equal(await page.locator('vite-error-overlay,nextjs-portal').count(), 0);
  await page.evaluate(async () => { control(false, 4); await __yingyaPreviewReady; });
  assert.equal(await page.locator('#frame').textContent(), '4.000');
  await page.evaluate(async () => { control(false, 1); await __yingyaPreviewReady; });
  assert.equal(await page.locator('#frame').textContent(), '1.000');
  await page.clock.runFor(500);
  assert.equal(await page.locator('#frame').textContent(), '1.000');
  await page.evaluate(() => control(true, 5.75));
  await page.clock.runFor(500);
  const loopTime = Number(await page.locator('#frame').textContent());
  assert.ok(loopTime >= .2 && loopTime <= .3, `expected composition loop near .25s, got ${loopTime}`);
  await page.evaluate(async () => {
    control(false, 2.5);
    window.lateTime=null;
    window.late=YingyaComponents.register({ready:new Promise(resolve=>window.resolveLate=resolve),renderAt(time){lateTime=time;},dispose(){}});
    control(false, 3.5);resolveLate();await __yingyaPreviewReady;
  });
  assert.equal(await page.evaluate(() => lateTime), 3.5);
  await page.evaluate(async () => {
    window.broken=YingyaComponents.register({ready:Promise.reject(new Error('missing local model')),renderAt(){},dispose(){}});
    control(false,1);
    try {await __yingyaPreviewReady;} catch {}
  });
  assert.equal(await page.evaluate(() => __yingyaComponentError), 'missing local model');
  await page.clock.runFor(20);
  assert.ok(await page.evaluate(() => messages.some(message=>message.type==='yingya-preview-error' && message.message==='missing local model')));
  await page.evaluate(() => { broken.dispose();late.dispose();instance.dispose(); });
  assert.deepEqual(errors, []);
});

test('a real React adapter commits every captured frame synchronously with flushSync', async t => {
  const { build } = await import('esbuild');
  const bundle = await build({
    stdin: {
      contents: `import {createElement} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
        const root=createRoot(document.querySelector('#react'));
        window.reactScene=YingyaComponents.register({startSeconds:2,durationSeconds:4,
          renderAt(time){flushSync(()=>root.render(createElement('output',{'data-frame':time},'第 '+time.toFixed(2)+' 秒')));},
          dispose(){flushSync(()=>root.unmount());}});`,
      resolveDir: repository, loader: 'js',
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<main id="react"></main>');
  await page.addScriptTag({ content: clockSource });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const time of [4.25, .5, 5, 4.25]) {
    const frame = await page.evaluate(time => {
      // Reading immediately inside the same task proves a committed React
      // frame; a delayed Playwright locator could mask scheduler lag.
      dispatchEvent(new CustomEvent('hf-seek', { detail: { time, waitUntil() {} } }));
      return document.querySelector('output').textContent;
    }, time);
    assert.equal(frame, `第 ${time.toFixed(2)} 秒`);
  }
  await page.evaluate(() => reactScene.dispose());
  assert.equal(await page.locator('#react > *').count(), 0);
  assert.deepEqual(errors, []);
});
