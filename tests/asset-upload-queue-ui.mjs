import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock } from './ui-qa.mjs';

// Browser plugin not available. Assets -> external file drop -> captured folder
// and unified upload/generation queue. Isolated API fixtures, real DOM transfers.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = `/tmp/yingya-asset-upload-queue/${base.startsWith('https') ? 'public' : 'local'}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
const requests = [], stored = [], held = new Map();
let failedOnce = false, automatic = false, concurrent = 0, peak = 0;
const jobs = [{ id: 'running-image', prompt: '晨光里的蓝色纸屋，保留纸张的纹理与留白', model: 'gpt-6.1-sol', reasoningEffort: 'medium', referenceImages: [], status: 'running', images: [], error: null, createdAt: Date.now(), updatedAt: Date.now() }];
const waitFor = async check => { for (let n = 0; n < 300; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('Condition timed out'); };
async function transfer(names, type = 'Files') {
  return page.evaluateHandle(({ names, type }) => { const data = new DataTransfer(); if (type === 'Files') names.forEach(name => data.items.add(new File(['queue fixture'], name, { type: 'text/plain' }))); else data.setData(type, names[0]); return data; }, { names, type });
}
const queue = page.getByRole('region', { name: '素材任务记录' });
const folder = name => page.getByRole('navigation', { name: '素材文件夹' }).getByRole('button', { name: new RegExp('^' + name) });
const uploads = () => queue.locator('li[data-kind=upload]');
async function drop(names, destination) {
  const data = await transfer(names);
  await page.locator('.asset-main').dispatchEvent('dragenter', { dataTransfer: data });
  await page.locator('.asset-main').dispatchEvent('dragover', { dataTransfer: data });
  await page.getByText(`松开即可上传到「${destination}」`, { exact: true }).waitFor();
  await page.locator('.asset-catalog').dispatchEvent('drop', { dataTransfer: data });
  await page.locator('.asset-upload-drop').waitFor({ state: 'detached' });
  await data.dispose();
}
try {
  await installApiMock(page);
  await page.route(/\/assets\/folders$/, route => route.fulfill({ json: [{ id: 'test', name: '测试', createdAt: 1 }, { id: 'other', name: '另一文件夹', createdAt: 2 }] }));
  await page.route(/\/assets\/image-jobs$/, route => route.fulfill({ json: jobs }));
  await page.route(/\/assets\/library$/, async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { assets: stored } });
    const body = route.request().postDataBuffer().toString();
    const name = /filename="([^"]+)"/.exec(body)[1];
    const folderId = /name="folderId"\r\n\r\n([^\r]+)/.exec(body)?.[1] ?? null;
    requests.push({ name, folderId }); concurrent++; peak = Math.max(peak, concurrent);
    if (!automatic) await new Promise(resolve => held.set(name, resolve));
    concurrent--;
    if (name === '文件-1.txt' && !failedOnce) { failedOnce = true; return route.fulfill({ status: 503, json: { message: '测试：网络中断，请重试' } }); }
    const item = { id: name, category: 'document', sourceName: name, mimeType: 'text/plain', url: '/fixture.txt', projectPath: 'assets/' + name, prompt: null, kind: 'uploaded', folderId, createdAt: Date.now() };
    stored.push(item); return route.fulfill({ json: item });
  });
  await page.goto(base + '/app#/assets'); await folder('测试').click();
  assert.equal(new URL(page.url()).hash, '#/assets'); assert.ok(await page.title()); assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.equal(await queue.isVisible(), false);
  // Nested drag events must retain the overlay until the entire area is left.
  const nested = await transfer(['文件-1.txt']);
  await page.locator('.asset-main').dispatchEvent('dragenter', { dataTransfer: nested });
  await page.locator('.asset-catalog').dispatchEvent('dragenter', { dataTransfer: nested });
  await page.locator('.asset-catalog').dispatchEvent('dragleave', { dataTransfer: nested });
  await page.locator('.asset-upload-drop > div').waitFor(); await page.screenshot({ path: `${out}/drop-target.png` });
  await page.locator('.asset-main').dispatchEvent('dragleave', { dataTransfer: nested });
  await page.locator('.asset-upload-drop').waitFor({ state: 'detached' }); await nested.dispose();
  await drop(['文件-1.txt', '文件-2.txt', '文件-3.txt', '文件-4.txt'], '测试');
  await waitFor(() => requests.length === 3); await folder('另一文件夹').click();
  await drop(['第二批-1.txt', '第二批-2.txt'], '另一文件夹');
  await page.getByRole('link', { name: /^任务记录/ }).click();
  await waitFor(async () => await uploads().count() === 6);
  assert.equal(requests.length, 3, 'second drop shares the same three transfer slots');
  assert.equal(await queue.getByText('等待上传', { exact: true }).count(), 3);
  assert.equal(await queue.locator('li[data-kind=image]').count(), 1);
  for (const width of [1280, 1440, 1536, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `page overflow ${width}`);
    assert.equal(await queue.evaluate(el => el.scrollWidth > el.clientWidth), false, `queue overflow ${width}`);
    assert.equal(await queue.locator('.asset-task-name').first().evaluate(el => getComputedStyle(el).fontSize), '14px');
    await queue.screenshot({ path: `${out}/queue-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('navigation', { name: '映芽功能' }).filter({ visible: true }).getByRole('button', { name: '新建视频', exact: true }).click();
  await page.locator('.upload-dock').waitFor();
  for (const name of ['文件-1.txt', '文件-2.txt', '文件-3.txt']) held.get(name)();
  await waitFor(() => requests.length === 6);
  for (const name of ['文件-4.txt', '第二批-1.txt', '第二批-2.txt']) held.get(name)();
  await page.getByText('已完成 5/6 · 1 项失败', { exact: true }).waitFor();
  await page.getByRole('button', { name: '素材工坊', exact: true }).click();
  await folder('另一文件夹').click(); automatic = true;
  await page.getByRole('link', { name: /^任务记录/ }).click();
  await queue.getByRole('button', { name: '重试上传 文件-1.txt', exact: true }).waitFor();
  await queue.getByRole('button', { name: '重试上传 文件-1.txt', exact: true }).click();
  await waitFor(async () => await uploads().filter({ hasText: '已完成' }).count() === 6);
  assert.ok(requests.filter(item => item.name.startsWith('文件')).every(item => item.folderId === 'test'), 'original folder survives switching and retry');
  assert.ok(requests.filter(item => item.name.startsWith('第二批')).every(item => item.folderId === 'other'));
  assert.equal(peak, 3);
  await page.getByRole('link', { name: '素材库', exact: true }).click();
  for (const name of ['全部素材', '未整理']) { await folder(name).click(); await drop([`${name}-上传.txt`], '未整理'); }
  await waitFor(() => requests.length === 9); assert.ok(requests.slice(-2).every(item => item.folderId === null));
  // Text/links and existing library drags are not treated as local file uploads.
  for (const type of ['text/uri-list', 'application/x-yingya-library-assets']) { const data = await transfer(['fixture'], type); await page.locator('.asset-main').dispatchEvent('dragover', { dataTransfer: data }); await page.locator('.asset-main').dispatchEvent('drop', { dataTransfer: data }); assert.equal(await page.locator('.asset-upload-drop').count(), 0); await data.dispose(); }
  assert.equal(requests.length, 9);
  await page.getByRole('link', { name: /^任务记录/ }).click();
  await queue.getByRole('navigation', { name: '任务来源' }).getByRole('button', { name: /^图片/ }).click(); assert.equal(await uploads().count(), 0);
  const detailButton = queue.getByRole('button', { name: /查看生成记录/ }); await detailButton.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: '图片生成记录', exact: true }); await dialog.waitFor(); await page.keyboard.press('Escape');
  assert.equal(await detailButton.evaluate(el => document.activeElement === el), true);
  await queue.getByRole('navigation', { name: '任务来源' }).getByRole('button', { name: /^上传/ }).click();
  await queue.getByRole('combobox', { name: '任务状态' }).click(); await page.getByRole('option', { name: /^失败/ }).click(); await queue.getByText('没有符合条件的任务').waitFor();
  await queue.getByRole('combobox', { name: '任务状态' }).click(); await page.getByRole('option', { name: /^全部状态/ }).click();
  await queue.getByRole('button', { name: '清理已完成', exact: true }).click(); assert.equal(await uploads().count(), 0);
  await queue.getByRole('navigation', { name: '任务来源' }).getByRole('button', { name: /^全部任务/ }).click(); assert.equal(await queue.locator('li').count(), 1, 'clearing uploads preserves AI jobs');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, base, requests: requests.length, peak, screenshots: out, checks: 'folder snapshot, repeated drops, progress, partial failure, retry, route survival, type/status filters, keyboard, six widths, internal drag isolation', errors }));
} catch (error) { await page.screenshot({ path: `${out}/failure.png` }); throw error; } finally { await browser.close(); }
