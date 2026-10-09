import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock, detail } from './ui-qa.mjs';

// Browser plugin unavailable. Exercise native files against isolated API fixtures.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = `/tmp/yingya-composer-attachments/${base.startsWith('https') ? 'public' : 'local'}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = [], uploads = [], roles = [], turns = [];
page.on('pageerror', error => errors.push(error.message));
const files = [
  { name: '参考画面.jpg', type: 'image/jpeg', bytes: [...await readFile('tests/fixtures/media/explainer.jpg')] },
  { name: '参考视频.mp4', type: 'video/mp4', bytes: [...await readFile('tests/fixtures/media/explainer.mp4')] },
  { name: '说明.md', type: 'text/markdown', bytes: [...Buffer.from('# 参考资料\n\n保留这个说明。')] },
];
let fail = true;
const form = page.locator('.thread-footer .composer');
async function drop(target, values, event = 'drop') {
  const data = await page.evaluateHandle(values => { const data = new DataTransfer(); for (const value of values) data.items.add(new File([new Uint8Array(value.bytes)], value.name, { type: value.type, lastModified: 123 })); return data; }, values);
  if (event === 'paste') await target.evaluate((el, clipboardData) => el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })), data);
  else await target.dispatchEvent(event, { dataTransfer: data });
  await data.dispose();
}
async function noRedundantUI(target) {
  assert.equal(await target.locator('.asset-role-select').count(), 0);
  assert.doesNotMatch(await target.innerText(), /已添加\s*\d+\s*个附件|附件已暂存|提交时上传/);
}
try {
  await installApiMock(page, { ...structuredClone(detail), status: 'idle', statusLabel: '准备就绪', queue: [], queueDepth: 0, queuePaused: false });
  await page.route(/\/agent-projects\/[^/]+\/assets$/, async route => {
    const body = route.request().postDataBuffer();
    const name = body.toString().match(/filename="([^"]+)"/)?.[1]; uploads.push(name);
    assert.ok(body.includes(Buffer.from(files.find(file => file.name === name).bytes)), 'Original file bytes are uploaded');
    if (fail && name === '说明.md') return route.fulfill({ status: 503, json: { message: '测试：说明上传失败，请重试' } });
    return route.fulfill({ json: { path: `assets/${name}`, name } });
  });
  await page.route(/\/asset-roles$/, route => { roles.push(route.request().postDataJSON()); return route.fallback(); });
  await page.route(/\/turns$/, route => { if (route.request().method() === 'POST') turns.push(route.request().postDataJSON()); return route.fallback(); });
  await page.goto(`${base}/app#/projects/${detail.id}`);
  await form.locator('textarea').fill('参照附件调整画面');
  await drop(form, files);
  await form.locator('.composer-attachment').nth(2).waitFor();
  await noRedundantUI(form);
  assert.equal(uploads.length, 0, 'Adding draft attachments must not send a turn');
  await form.locator('.composer-attachment img').evaluate(img => img.decode());
  await page.waitForFunction(() => document.querySelector('.composer-attachment video')?.readyState >= 2);
  for (const [name, selector] of [['参考画面.jpg', 'img'], ['参考视频.mp4', 'video[controls]'], ['说明.md', '.markdown-body h1']]) {
    const button = form.getByRole('button', { name: `预览附件 ${name}`, exact: true });
    await button.click();
    const dialog = page.getByRole('dialog');
    await dialog.locator(selector).waitFor();
    assert.equal(await dialog.evaluate(el => !!el.closest('form')), false);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.ok(await button.evaluate(el => el === document.activeElement));
  }
  assert.equal(turns.length, 0, 'Preview never submits');
  await page.reload(); await form.locator('.composer-attachment').nth(2).waitFor();
  assert.equal(await form.locator('textarea').inputValue(), '参照附件调整画面');
  await form.locator('.composer-attachment img').evaluate(img => img.decode());
  await page.waitForFunction(() => document.querySelector('.composer-attachment video')?.readyState >= 2);
  for (const width of [1280, 1440, 1536, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 }); await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await form.evaluate(el => el.scrollWidth <= el.clientWidth));
    const send = await form.getByRole('button', { name: '发送消息', exact: true }).boundingBox();
    assert.ok(send.y + send.height <= 1000, 'Send stays visible');
    await page.screenshot({ path: `${out}/attachments-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await drop(form, [{ ...files[0], name: '粘贴画面.jpg' }], 'paste');
  await form.getByRole('button', { name: '预览附件 粘贴画面.jpg', exact: true }).waitFor();
  await noRedundantUI(form);
  await form.getByRole('button', { name: '移除 粘贴画面.jpg', exact: true }).click();
  assert.equal(await form.locator('.composer-attachment').count(), 3);
  await form.getByRole('button', { name: '发送消息', exact: true }).click();
  await form.locator('.composer-attachment[data-state="error"]').waitFor();
  await page.getByRole('button', { name: '重试发送消息', exact: true }).waitFor();
  assert.equal(turns.length, 0); assert.equal(uploads.length, 3);
  assert.equal(await form.locator('.composer-attachment').count(), 3);
  assert.equal(await form.locator('textarea').inputValue(), '参照附件调整画面');
  fail = false;
  await page.getByRole('button', { name: '重试发送消息', exact: true }).click();
  await form.locator('.composer-attachments').waitFor({ state: 'detached' });
  assert.deepEqual(uploads.slice(0, 3).sort(), ['参考画面.jpg', '参考视频.mp4', '说明.md'].sort());
  assert.equal(uploads.length, 4); assert.equal(uploads[3], '说明.md');
  assert.equal(turns.length, 1); assert.equal(turns[0].attachments.length, 3);
  assert.equal(roles.length, 3); assert.ok(roles.every(item => item.role === 'reference'));
  await form.getByRole('button', { name: '添加素材', exact: true }).click();
  await page.getByRole('menuitem', { name: '选择素材', exact: true }).click();
  await page.getByRole('checkbox', { name: '秋日背景音乐.mp3', exact: true }).check();
  await page.getByRole('button', { name: '关闭素材选择', exact: true }).click();
  await form.getByRole('button', { name: '预览附件 秋日背景音乐.mp3', exact: true }).waitFor();
  await noRedundantUI(form);
  await form.getByRole('button', { name: '移除 秋日背景音乐.mp3', exact: true }).click();
  // The creation page shares the same attachment strip.
  await page.goto(base + '/app#/');
  const create = page.locator('form').filter({ has: page.locator('#creation-prompt') });
  await page.locator('#creation-prompt').fill('新视频草稿'); await drop(create, [files[0]]);
  await create.locator('.composer-attachment img').evaluate(img => img.decode());
  await noRedundantUI(create);
  await create.getByRole('button', { name: '移除 参考画面.jpg', exact: true }).click();
  assert.equal(await create.locator('.composer-attachments').count(), 0);
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await installApiMock(touch); await touch.goto(`${base}/app#/projects/${detail.id}`);
  await touch.locator('.thread-footer textarea').fill('触屏参考');
  await touch.locator('.thread-footer input[type=file]').setInputFiles({ name: files[0].name, mimeType: files[0].type, buffer: Buffer.from(files[0].bytes) });
  const remove = touch.getByRole('button', { name: '移除 参考画面.jpg', exact: true });
  const hit = await remove.boundingBox(); assert.ok(hit.width >= 44 && hit.height >= 44);
  await touch.screenshot({ path: `${out}/attachments-touch.png` }); await remove.tap();
  assert.equal(await touch.locator('.composer-attachment').count(), 0); await touch.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', base, out, checks: 'native drop/paste, no role or success banners, preview/focus, reload draft, six widths, original upload bytes, partial failure retry reuse, reference roles, creation reuse', data: 'isolated API fixtures; real image/video bytes' }));
} catch (error) { await page.screenshot({ path: `${out}/failure.png` }); throw error; }
finally { await browser.close(); }
