import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Use the repository's named tmux service, rather than spawning a duplicate server.
const baseUrl = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(baseUrl);
  await page.locator('#marketing-title').waitFor();
  assert.equal(await page.title(), '映芽 | 对话式动画视频制作工作台');
  assert.equal(await page.locator('.marketing-example').count(), 6);
  assert.equal(requests.some(url => url.includes('/api/')), false, 'Public homepage must not require authentication or load workspace data');
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await page.waitForFunction(() => document.querySelector('.marketing-main-film video').currentTime > 0.1);
  await page.getByRole('button', { name: '暂停品牌演示', exact: true }).click();
  assert.equal(await page.locator('.marketing-main-film video').evaluate(video => video.paused), true);
  const pausedAt = await page.locator('.marketing-main-film video').evaluate(video => video.currentTime);
  await page.getByRole('button', { name: '播放品牌演示', exact: true }).click();
  await page.waitForFunction(at => document.querySelector('.marketing-main-film video').currentTime !== at, pausedAt);
  await page.getByRole('link', { name: '看看作品', exact: true }).click();
  await page.getByRole('button', { name: '知识动画', exact: true }).click();
  assert.equal(await page.locator('.marketing-example').count(), 1);
  assert.equal(await page.getByRole('button', { name: '知识动画', exact: true }).getAttribute('aria-pressed'), 'true');
  const example = page.getByRole('button', { name: '播放：把复杂知识，讲得简单', exact: true });
  await example.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.waitForFunction(() => document.querySelector('dialog video').readyState >= 2);
  const duration = await dialog.locator('video').evaluate(video => video.duration);
  assert.ok(duration > 0 && Number.isFinite(duration));
  await dialog.locator('video').evaluate(video => { video.pause(); video.currentTime = 3; });
  await page.waitForFunction(() => Math.abs(document.querySelector('dialog video').currentTime - 3) < 0.1);
  await page.getByRole('button', { name: '复制创作需求', exact: true }).click();
  await page.getByRole('button', { name: '已复制需求', exact: true }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /知识点/);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await example.evaluate(el => el === document.activeElement), true, 'Closing a preview returns focus to the invoking example');
  await page.getByRole('button', { name: '全部', exact: true }).click();
  for (const button of await page.locator('.marketing-example').all()) {
    await button.click();
    await page.waitForFunction(() => document.querySelector('dialog video').readyState >= 2);
    assert.equal(await page.locator('dialog video').evaluate(video => video.error), null);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: /1 说说你想做什么/ }).click();
  await page.getByText('用这些图片，做一支 12 秒的品牌短片。', { exact: true }).waitFor();
  await page.getByRole('button', { name: /3 导出成片，继续创作/ }).click();
  await page.getByText('这个版本可以了，导出成片。', { exact: true }).waitFor();
  await page.getByText('我需要会剪辑或写代码吗？', { exact: true }).click();
  assert.equal(await page.locator('details').first().getAttribute('open'), '');
  await page.locator('#showcase').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.marketing-example img')].every(img => img.complete && img.naturalWidth > 0));
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const dimensions = await page.locator('.marketing-page').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client, `No horizontal overflow at ${width}px`);
    await page.getByRole('button', { name: '播放：给品牌，一个记忆点', exact: true }).click();
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `Dialog fits ${width}px`);
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(baseUrl);
  await page.locator('#marketing-title').waitFor();
  assert.equal(await page.locator('.marketing-main-film video').evaluate(video => video.paused), true);
  assert.equal(await page.locator('.marketing-page').evaluate(el => getComputedStyle(el).scrollBehavior), 'auto');
  // Mock auth only for navigation; never create a real account during UI QA.
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.getByRole('link', { name: '登录', exact: true }).click();
  await page.locator('#login-email').waitFor();
  assert.equal(new URL(page.url()).pathname, '/app');
  await page.getByRole('link', { name: '返回映芽首页', exact: true }).click();
  await page.locator('#marketing-title').waitFor();
  await page.goto(`${baseUrl}/#/projects/11111111-1111-4111-8111-111111111111`);
  await page.locator('#login-email').waitFor();
  assert.equal(await page.locator('#marketing-title').count(), 0, 'Legacy project links route to the workspace login');
  assert.deepEqual(errors, []);
  console.log('Marketing QA passed: public entry, media playback/pause/seek, all six videos, filters, copy, dialog focus/Escape, workflow, FAQ, 768/390/320px, reduced motion, login/home and legacy project routing.');
  await context.close();
} finally {
  await browser.close();
}
