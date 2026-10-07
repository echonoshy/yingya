import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock } from './ui-qa.mjs';

// Browser plugin not available. Library -> drag card(s) to folder -> persisted folder/count updates.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = `/tmp/yingya-asset-drag/${base.startsWith('https') ? 'public' : 'local'}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1151 } });
page.setDefaultTimeout(12000);
const errors = [], moves = [];
page.on('pageerror', error => errors.push(error.message));
const now = Date.now();
let assets = [
  { id: 'image', category: 'image', sourceName: '画面参考.webp', mimeType: 'image/webp', folderId: 'brand', url: '/mock-reference.webp' },
  { id: 'audio', category: 'audio', sourceName: '节奏音乐.mp3', mimeType: 'audio/mpeg', folderId: null },
  { id: 'file', category: 'file', sourceName: '项目源文件.zip', mimeType: 'application/zip', folderId: null },
  { id: 'document', category: 'document', sourceName: '拍摄计划.pdf', mimeType: 'application/pdf', folderId: 'brand' },
].map((asset, i) => ({ url: '/mock-empty-file', ...asset, prompt: null, kind: 'uploaded', projectPath: `assets/${asset.sourceName}`, createdAt: now - i }));
const folders = [{ id: 'brand', name: '品牌素材', createdAt: now }, { id: 'scene', name: '场景参考', createdAt: now }];
const fail = new Set();
let holdMove;
const folder = id => page.locator(`[data-folder-id="${id}"]`);
const card = name => page.locator('.asset-card-item').filter({ hasText: name }).locator('.asset-card-open');
async function waitForMoves(count) { await page.waitForFunction(() => document.querySelectorAll('.asset-card-item.is-dragging').length === 0); assert.equal(moves.length, count); }
async function nativeDrag(source, target) {
  await source.scrollIntoViewIfNeeded(); await target.scrollIntoViewIfNeeded();
  const a = await source.boundingBox(), b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 45);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 45, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2);
}
async function done(text) { await page.getByRole('status').filter({ hasText: text }).waitFor(); }
try {
  await installApiMock(page);
  await page.route('**/mock-reference.webp', async route => route.fulfill({ contentType: 'image/webp', body: await readFile('web/src/assets/showcase/demo-9.webp') }));
  await page.route(/\/assets\/folders$/, route => route.fulfill({ json: folders }));
  await page.route(/\/assets\/library$/, route => route.fulfill({ json: { assets } }));
  await page.route(/\/assets\/library\/(image|audio|file|document)$/, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const body = route.request().postDataJSON();
    moves.push({ id, folderId: body.folderId ?? null });
    if (holdMove) await holdMove;
    if (fail.has(id)) return route.fulfill({ status: 503, json: { message: '测试：文件夹更新暂时失败' } });
    assets = assets.map(asset => asset.id === id ? { ...asset, folderId: body.folderId ?? null } : asset);
    return route.fulfill({ status: 204 });
  });
  await page.goto(base + '/app#/assets');
  await card('节奏音乐.mp3').waitFor();
  assert.equal(new URL(page.url()).hash, '#/assets');
  assert.ok(await page.title());
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await folder('unfiled').click();
  await nativeDrag(card('节奏音乐.mp3'), folder('brand'));
  await page.locator('[data-drop-target="true"]').waitFor();
  assert.match(await folder('brand').textContent(), /移入/);
  assert.equal(await page.locator('.is-dragging').count(), 1);
  await page.screenshot({ path: `${out}/drag-target.png` });
  let releaseMove;
  holdMove = new Promise(resolve => { releaseMove = resolve; });
  await page.mouse.up();
  await done('正在移动 1 项素材');
  assert.equal(await card('项目源文件.zip').getAttribute('draggable'), 'false');
  assert.equal(await page.getByRole('button', { name: '批量整理', exact: true }).isDisabled(), true);
  releaseMove(); holdMove = undefined;
  await done('已将 1 项素材移动到“品牌素材”');
  assert.deepEqual(moves, [{ id: 'audio', folderId: 'brand' }]);
  assert.equal(await card('节奏音乐.mp3').count(), 0);
  assert.match(await folder('brand').textContent(), /3$/);
  assert.equal(await page.locator('.editorial-inspector').count(), 0);
  await page.reload(); await folder('brand').click(); await card('节奏音乐.mp3').waitFor();
  // Same-folder drops, cancellation, collection views and external drags never move anything.
  await card('节奏音乐.mp3').dragTo(folder('brand')); await waitForMoves(1);
  await nativeDrag(card('节奏音乐.mp3'), folder('unfiled'));
  await page.keyboard.press('Escape'); await page.mouse.up(); await waitForMoves(1);
  assert.equal(await page.locator('[data-drop-target="true"]').count(), 0);
  await card('节奏音乐.mp3').dragTo(page.getByRole('button', { name: /^全部素材/ })); await waitForMoves(1);
  const external = await page.evaluateHandle(() => { const data = new DataTransfer(); data.setData('application/x-yingya-library-assets', '["audio"]'); data.items.add(new File(['external'], 'external.txt')); return data; });
  await folder('scene').dispatchEvent('dragover', { dataTransfer: external });
  await folder('scene').dispatchEvent('drop', { dataTransfer: external }); await waitForMoves(1); await external.dispose();
  // Drag a selection as a group; retain failed items for an exact retry.
  await page.getByRole('button', { name: '批量整理', exact: true }).click();
  await card('节奏音乐.mp3').click(); await card('画面参考.webp').click(); fail.add('image');
  await nativeDrag(card('节奏音乐.mp3'), folder('scene'));
  assert.equal(await page.locator('.is-dragging').count(), 2);
  await page.screenshot({ path: `${out}/batch-drag.png` }); await page.mouse.up();
  await page.getByRole('alert').filter({ hasText: '1 项素材移动失败' }).waitFor();
  await done('已将 1 项素材移动到“场景参考”');
  assert.equal(await page.locator('.batch-selected').count(), 1);
  assert.equal(await card('画面参考.webp').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('combobox', { name: '批量移动到文件夹' }).textContent(), '场景参考');
  assert.equal(assets.find(asset => asset.id === 'image').folderId, 'brand');
  await page.screenshot({ path: `${out}/partial-failure.png` });
  fail.clear(); await page.getByRole('button', { name: '移动', exact: true }).click();
  await page.getByRole('toolbar', { name: '批量整理素材' }).waitFor({ state: 'hidden' });
  assert.deepEqual(moves.slice(1).map(move => move.id).sort(), ['audio', 'image', 'image']);
  assert.equal(assets.find(asset => asset.id === 'image').folderId, 'scene');
  // An unselected card starts its own drag instead of silently moving the previous selection.
  await page.getByRole('button', { name: /^全部素材/ }).click();
  await page.getByRole('button', { name: '批量整理', exact: true }).click(); await card('画面参考.webp').click();
  await card('拍摄计划.pdf').dragTo(folder('scene'));
  await page.getByRole('toolbar', { name: '批量整理素材' }).waitFor({ state: 'hidden' });
  assert.deepEqual(moves.at(-1), { id: 'document', folderId: 'scene' });
  // Return to 未整理 and avoid redundant requests for items already at the destination.
  await card('节奏音乐.mp3').dragTo(folder('unfiled')); await done('已将 1 项素材移动到“未整理”');
  assert.equal(assets.find(asset => asset.id === 'audio').folderId, null);
  await page.getByRole('button', { name: '批量整理', exact: true }).click(); await card('画面参考.webp').click(); await card('节奏音乐.mp3').click();
  const count = moves.length;
  await card('画面参考.webp').dragTo(folder('scene')); await page.getByRole('toolbar', { name: '批量整理素材' }).waitFor({ state: 'hidden' });
  assert.equal(moves.length, count + 1); assert.equal(moves.at(-1).id, 'audio');
  // Keyboard and narrow-screen alternatives stay available; no pointer drag required on touch devices.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  const toggle = page.getByRole('button', { name: '批量整理', exact: true }); await toggle.focus(); await page.keyboard.press('Enter');
  await card('项目源文件.zip').focus(); await page.keyboard.press('Space');
  const select = page.getByRole('combobox', { name: '批量移动到文件夹' }); await select.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await select.textContent(), '品牌素材');
  await page.screenshot({ path: `${out}/mobile-keyboard.png` });
  await page.getByRole('button', { name: '移动', exact: true }).focus(); await page.keyboard.press('Enter');
  await done('已将 1 项素材移动到“品牌素材”');
  assert.equal(assets.find(asset => asset.id === 'file').folderId, 'brand');
  await page.reload(); await card('项目源文件.zip').waitFor();
  assert.match(await card('项目源文件.zip').textContent(), /品牌素材/);
  assert.deepEqual(errors, []);
  console.log('PASS native single/batch asset drag, folder/unfiled/counts/reload, pending lock, same-folder/no-op, cancel/invalid/external drops, partial-failure retry, unselected-card drag, keyboard and 320/390/768px alternatives. API fixtures only.');
} finally { await browser.close(); }
