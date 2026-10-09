import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock } from './ui-qa.mjs';

// Browser plugin unavailable: Playwright exercises the rendered frontend with
// isolated jobs, including delayed completion, network loss and reloads.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = '/tmp/yingya-image-generation-qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
const jobs = [], submissions = [];
let offline = false, loseReceipt = true;
const prompt = '海边的纸质小屋，蓝色屋顶与细腻的晨光；保留这段描述和参考图。';
try {
  await installApiMock(page);
  await page.route('**/assets/uploads/reference.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5V0AAAAASUVORK5CYII=', 'base64') }));
  await page.route('**/image-jobs', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: offline ? 503 : 200, json: offline ? { message: '暂时离线' } : jobs });
    const input = route.request().postDataJSON();
    submissions.push(input);
    const existing = jobs.find(job => job.id === input.clientRequestId);
    const job = existing ?? { ...input, id: input.clientRequestId, status: 'running', createdAt: Date.now(), updatedAt: Date.now(), error: null, images: [] };
    if (!existing) jobs.unshift(job);
    if (loseReceipt) { loseReceipt = false; return route.abort('failed'); }
    return route.fulfill({ json: job });
  });
  await page.goto(base + '/app#/assets');
  await page.getByRole('link', { name: '生成素材', exact: true }).click();
  const composer = page.getByRole('region', { name: '图片生成工作区', exact: true });
  await composer.getByLabel('画面描述').fill(prompt);
  await composer.locator('input[type=file]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5V0AAAAASUVORK5CYII=', 'base64') });
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '图片生成记录', exact: true });
  await composer.getByText('生成中', { exact: true }).waitFor();
  assert.equal(jobs.length, 1, 'lost response retry uses one durable job');
  assert.equal(submissions.length, 2);
  assert.equal(submissions[0].clientRequestId, submissions[1].clientRequestId);
  await page.getByRole('link', { name: /^任务记录/ }).click();
  const history = page.getByRole('region', { name: '素材任务记录' });
  await history.getByRole('button', { name: new RegExp(prompt) }).waitFor();
  await page.reload();
  await history.getByText('生成中', { exact: true }).last().waitFor();
  await page.getByRole('navigation', { name: '映芽功能' }).filter({ visible: true }).getByRole('button', { name: '新建视频' }).click();
  await page.goto(base + '/app#/assets/tasks');
  await history.getByRole('button', { name: new RegExp(prompt) }).waitFor();
  offline = true;
  await history.getByRole('alert').waitFor();
  assert.equal(await history.locator('li').count(), 1, 'failed polling preserves visible jobs');
  offline = false;
  await history.getByRole('button', { name: '重新读取' }).click();
  await history.getByRole('alert').waitFor({ state: 'hidden' });
  jobs[0].status = 'failed'; jobs[0].error = '图片生成服务繁忙，请稍后重试或切换模型。';
  await history.locator('.asset-task-state--failed').waitFor();
  await history.locator('li[data-state=failed]').getByRole('button', { name: /查看生成记录.*海边/ }).click();
  await dialog.getByText(jobs[0].error, { exact: true }).waitFor();
  for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true); }
  await dialog.getByRole('button', { name: '编辑后重试' }).click();
  assert.equal(await composer.getByLabel('画面描述').inputValue(), prompt);
  await composer.getByRole('button', { name: '移除参考图 1' }).waitFor();
  await composer.getByRole('button', { name: '生成图片', exact: true }).click();
  await composer.getByText('生成中', { exact: true }).waitFor();
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0].referenceImages, jobs[1].referenceImages);
  jobs[0].status = 'completed'; jobs[0].images = [{ id: 'result', url: '/avatars/cat-v1.webp', projectPath: 'assets/generated/result.webp', mimeType: 'image/webp', revisedPrompt: prompt }];
  await composer.getByText('已完成', { exact: true }).waitFor();
  await page.getByRole('link', { name: /^任务记录/ }).click();
  await history.locator('li[data-state=completed]').getByRole('button', { name: /查看生成记录/ }).click();
  await dialog.getByRole('link', { name: '下载' }).waitFor();
  for (const width of [1280, 1440, 1536, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, `detail fits ${width}`);
    await page.screenshot({ path: `${out}/detail-${width}.png` });
  }
  await page.keyboard.press('Escape');
  await history.getByRole('combobox', { name: '任务状态' }).click(); await page.getByRole('option', { name: /^失败/ }).click();
  assert.equal(await history.locator('li').count(), 1);
  await history.getByRole('combobox', { name: '任务状态' }).click(); await page.getByRole('option', { name: /^进行中/ }).click();
  await history.getByText('没有符合条件的任务').waitFor();
  await history.getByRole('combobox', { name: '任务状态' }).click(); await page.getByRole('option', { name: /^全部状态/ }).click();
  for (const width of [1280, 1440, 1536, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `page fits ${width}`);
    await page.screenshot({ path: `${out}/history-${width}.png` });
  }
  const row = history.locator('li[data-state=failed]').getByRole('button', { name: /查看生成记录.*海边/ });
  await row.focus(); await page.keyboard.press('Enter'); await dialog.waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await row.evaluate(el => el === document.activeElement), true, 'closing a record restores focus to its row');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, jobs: jobs.length, submissions: submissions.length, screenshots: out, base }));
} finally { await browser.close(); }
