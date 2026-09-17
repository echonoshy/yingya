import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { localPath, readModelDocument, validateConfig, validateModelDocument } from '../runtime/components/three-model/source.mjs';

const pack = new URL('../runtime/components/three-model/', import.meta.url);
const [bundle, fixture, provenance] = await Promise.all([
  fs.readFile(new URL('model-scene.js', pack)), fs.readFile(new URL('sample-model.glb', pack)),
  fs.readFile(new URL('PROVENANCE.json', pack), 'utf8').then(JSON.parse),
]);
const config = { modelUrl: 'models/sample-model.glb', startSeconds: 2, durationSeconds: 6, width: 400, height: 300 };
const hash = data => createHash('sha256').update(data).digest('hex');
const asArrayBuffer = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const fixtureDocument = readModelDocument(asArrayBuffer(fixture));
const binaryOffset = 20 + fixture.readUInt32LE(12);
const externalDocument = { ...fixtureDocument, buffers: [{ byteLength: fixture.readUInt32LE(binaryOffset), uri: 'sample-model.bin' }] };
const modelBinary = fixture.subarray(binaryOffset + 8);

test('model stage validates local paths, finite timeline/dimensions and supported glTF before fetching', () => {
  assert.equal(validateConfig(config).motion, 'turntable');
  for (const modelUrl of ['https://cdn.test/product.glb', '//cdn.test/x.glb', '/tmp/x.glb', '../x.glb', 'a/%2e%2e/x.glb', 'a/%5cx.glb', 'a\\x.glb', 'a.glb?x=1', 'a.glb#x', 'x.fbx']) assert.throws(() => validateConfig({ ...config, modelUrl }), /modelUrl/);
  assert.equal(localPath('assets/模型/model.glb'), 'assets/模型/model.glb');
  for (const key of ['width', 'height', 'startSeconds', 'durationSeconds', 'turns']) {
    assert.throws(() => validateConfig({ ...config, [key]: NaN }), new RegExp(key));
    assert.throws(() => validateConfig({ ...config, [key]: '3' }), new RegExp(key));
  }
  for (const extension of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'KHR_texture_basisu']) assert.throws(() => validateModelDocument({ ...fixtureDocument, extensionsUsed: [extension] }), /uncompressed GLB/);
  assert.throws(() => validateModelDocument({ ...fixtureDocument, images: [{ uri: 'https://remote.test/texture.png' }] }), /project-relative/);
  assert.throws(() => validateModelDocument({ ...fixtureDocument, buffers: [{ uri: '../buffer.bin' }] }), /local model directory/);
  assert.throws(() => validateModelDocument({ ...fixtureDocument, asset: { version: '1.0' } }), /glTF 2.0/);
  assert.throws(() => readModelDocument(asArrayBuffer(fixture.subarray(0, fixture.length - 1))), /header/);
  assert.equal(fixtureDocument.animations[0].name, 'detail-slide');
});

test('portable bundle and original fixture retain pinned Three.js provenance and licenses', async () => {
  assert.equal(provenance.dependency.version, '0.186.0');
  assert.equal(provenance.dependency.license, 'MIT');
  for (const [name, expected] of Object.entries(provenance.files)) assert.equal(hash(await fs.readFile(new URL(name, pack))), expected, name);
  assert.match(await fs.readFile(new URL('LICENSE.three.txt', pack), 'utf8'), /Permission is hereby granted/);
  assert.match(await fs.readFile(new URL('LICENSE.sample-model.txt', pack), 'utf8'), /Yingya contributors/);
});

async function browserFixture(t, options = {}) {
  // Browser plugin not available. Use existing Playwright Chromium and routed
  // local bytes, without starting another dev service or fetching a model CDN.
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: options.width || 400, height: options.height || 300 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  const resources = {
    '/model-scene.js': ['text/javascript', bundle],
    '/models/sample-model.glb': ['model/gltf-binary', fixture],
    '/models/sample-model.gltf': ['model/gltf+json', JSON.stringify(externalDocument)],
    '/models/sample-model.bin': ['application/octet-stream', modelBinary],
    ...(options.resources || {}),
  };
  await page.route('https://three-components.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push(pathname);
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><title>映芽模型镜头验证</title><style>html,body{margin:0;background:#f4f5f7;}#stage{width:100vw;height:100vh}</style></head><body><main id="stage" aria-label="3D 模型镜头"></main><script type="module">
      import { createModelScene } from './model-scene.js';
      window.createModelScene = createModelScene;
      window.scene = createModelScene(document.querySelector('#stage'), ${JSON.stringify({ ...config, ...options.config })});
      window.ready = scene.ready;
      window.loadError = null;
      ready.catch(error => { window.loadError = error.message; });
      window.capture = (seconds) => { scene.renderAt(seconds); return scene.canvas.toDataURL(); };
      </script></body></html>` });
    if (options.beforeResource) await options.beforeResource(pathname);
    const resource = resources[pathname];
    if (!resource) return route.fulfill({ status: 404, body: 'missing model resource' });
    return route.fulfill({ contentType: resource[0], body: resource[1] });
  });
  await page.goto('https://three-components.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.scene);
  return { page, errors, requests };
}

test('real WebGL model renders repeatable arbitrary seeks, fixed pixels, orbit, clip rewind and disposal', async t => {
  const { page, errors, requests } = await browserFixture(t, { config: { animationClip: 'detail-slide', animationLoop: false } });
  await page.evaluate(() => ready);
  assert.equal(await page.title(), '映芽模型镜头验证');
  assert.equal(await page.locator('main').getAttribute('data-yingya-model-state'), 'ready');
  const snapshots = new Map();
  for (const time of [0, 2, 2.5, 3, 4, 7.5, 8]) snapshots.set(time, await page.evaluate(time => capture(time), time));
  assert.notEqual(snapshots.get(2), snapshots.get(4), 'rotation and animation must visibly change the output');
  for (const time of [8, 3, 0, 7.5, 2.5, 4, 2, 3]) assert.equal(await page.evaluate(time => capture(time), time), snapshots.get(time), `seek ${time}s must be independent of earlier visits`);
  assert.deepEqual(await page.evaluate(() => ({ width: scene.canvas.width, height: scene.canvas.height, ratio: scene.renderer.getPixelRatio(), clips: scene.animations })), { width: 400, height: 300, ratio: 1, clips: [{ name: 'detail-slide', duration: 2 }] });
  const pixels = await page.evaluate(() => {
    scene.renderAt(3);
    const gl = scene.renderer.getContext();
    const bytes = new Uint8Array(scene.canvas.width * scene.canvas.height * 4);
    gl.readPixels(0, 0, scene.canvas.width, scene.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    let filled = 0; for (let i = 3; i < bytes.length; i += 4) if (bytes[i]) filled++;
    return filled;
  });
  assert.ok(pixels > 1000, `model must draw meaningful geometry, got ${pixels} opaque pixels`);
  await page.screenshot({ path: '/tmp/yingya-model-stage.png' });
  await page.evaluate(() => { scene.dispose(); scene.dispose(); });
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.evaluate(() => scene.status), 'disposed');
  await page.evaluate(config => { window.scene = createModelScene(document.querySelector('#stage'), { ...config, motion: 'orbit' }); }, config);
  await page.evaluate(() => scene.ready);
  const before = await page.evaluate(() => capture(2.5));
  await page.evaluate(() => capture(7));
  assert.equal(await page.evaluate(() => capture(2.5)), before);
  assert.ok(requests.every(value => ['/', '/model-scene.js', '/models/sample-model.glb'].includes(value)));
  assert.deepEqual(errors, []);
});

test('ready waits for local glTF dependencies and applies the last seek requested during loading', async t => {
  let release;
  const blocker = new Promise(resolve => { release = resolve; });
  const { page, errors, requests } = await browserFixture(t, {
    config: { modelUrl: 'models/sample-model.gltf', width: 300, height: 500, motion: 'orbit' }, width: 300, height: 500,
    beforeResource: pathname => pathname.endsWith('.bin') ? blocker : undefined,
  });
  await page.waitForFunction(() => scene.status === 'loading');
  await page.evaluate(() => { scene.renderAt(7); scene.seek(3); });
  assert.equal(await page.evaluate(() => scene.status), 'loading');
  release();
  await page.evaluate(() => ready);
  const initial = await page.evaluate(() => ({ image: scene.canvas.toDataURL(), time: scene.currentTime }));
  assert.equal(initial.time, 3);
  await page.evaluate(() => scene.renderAt(8));
  assert.equal(await page.evaluate(() => capture(3)), initial.image);
  assert.ok(requests.includes('/models/sample-model.bin'));
  await page.screenshot({ path: '/tmp/yingya-model-stage-portrait.png' });
  assert.deepEqual(errors, []);
});

test('missing texture rejects readiness instead of silently rendering an incomplete model', async t => {
  const withMissingTexture = structuredClone(externalDocument);
  withMissingTexture.images = [{ uri: 'missing-texture.png' }];
  withMissingTexture.textures = [{ source: 0 }];
  withMissingTexture.materials[0].pbrMetallicRoughness.baseColorTexture = { index: 0 };
  const { page, errors } = await browserFixture(t, { config: { modelUrl: 'models/textured.gltf' }, resources: { '/models/textured.gltf': ['model/gltf+json', JSON.stringify(withMissingTexture)] } });
  const error = await page.evaluate(() => ready.then(() => null, error => error.message));
  assert.match(error, /resource failed to load.*missing-texture/);
  assert.equal(await page.evaluate(() => scene.status), 'error');
  await page.evaluate(() => scene.dispose());
  assert.deepEqual(errors, []);
});

test('unsupported compression fails before secondary downloads and dispose during loading is safe', async t => {
  const compressed = { ...externalDocument, extensionsUsed: ['KHR_draco_mesh_compression'] };
  const { page, requests, errors } = await browserFixture(t, { config: { modelUrl: 'models/compressed.gltf' }, resources: { '/models/compressed.gltf': ['model/gltf+json', JSON.stringify(compressed)] } });
  assert.match(await page.evaluate(() => ready.then(() => null, error => error.message)), /uncompressed GLB/);
  assert.ok(!requests.includes('/models/sample-model.bin'));
  await page.evaluate(config => { scene.dispose(); window.scene = createModelScene(document.querySelector('#stage'), config); scene.dispose(); }, config);
  assert.equal(await page.evaluate(() => scene.status), 'disposed');
  assert.equal(await page.locator('canvas').count(), 0);
  assert.ok(await page.evaluate(() => scene.ready.then(() => false, () => true)));
  assert.deepEqual(errors, []);
});
