import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { installApiMock, detail } from './ui-qa.mjs';

// The real frontend runs against isolated API fixtures; this never changes user data.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = '/tmp/yingya-approved-ui-qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, reducedMotion: 'reduce' });
page.on('pageerror', error => errors.push(error.message));
try {
  await installApiMock(page);
  let loggedIn = false, loginPayload, renamePayload;
  await page.route('**/api/auth/me', route => route.fulfill({ status: loggedIn ? 200 : 401, json: loggedIn ? { user: { id: 'qa-user', email: 'qa@example.com', isAdmin: false } } : { message: '未登录' } }));
  await page.route('**/api/auth/login', route => { loginPayload = route.request().postDataJSON(); loggedIn = true; return route.fulfill({ json: { user: { id: 'qa-user', email: 'qa@example.com', isAdmin: false } } }); });
  const records = Array.from({ length: 6 }, (_, i) => ({ ...detail, id: `${i + 1}1111111-1111-4111-8111-111111111111`, title: ['把想法变成故事', '一段城市里的光', '春日记录', '产品介绍', '灵感笔记', '第一次创作'][i], posterUrl: '/src/assets/home-cinema/02-sunset-panorama.webp', updatedAt: detail.updatedAt + i }));
  await page.route(url => /^\/api(?:\/u\/[^/]+)?\/agent-projects$/.test(url.pathname), route => route.request().method() === 'GET' ? route.fulfill({ json: records }) : route.fallback());
  await page.route(url => /^\/api(?:\/u\/[^/]+)?\/agent-projects\/[^/]+$/.test(url.pathname), route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    renamePayload = route.request().postDataJSON();
    const record = records.find(item => item.id === new URL(route.request().url()).pathname.split('/').at(-1));
    record.title = renamePayload.title;
    return route.fulfill({ json: record });
  });
  await page.goto(base + '/');
  await page.getByRole('heading', { name: '让想法 有声有色' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'GitHub' }).getAttribute('href'), 'https://github.com/echonoshy/yingya');
  await page.screenshot({ path: out + '/home.png' });
  await page.getByRole('link', { name: '开始创作', exact: true }).click();
  await page.locator('#login-email').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out + '/login.png' });
  assert.equal(await page.locator('.editorial-character video').evaluate(video => video.hasAttribute('controls')), false);
  await page.locator('#login-email').fill('qa@example.com');
  await page.locator('#login-password').fill('test-password-only');
  await page.getByRole('button', { name: '登录并开始创作' }).click();
  await page.locator('.home-create textarea').waitFor();
  assert.equal(loginPayload.email, 'qa@example.com');
  assert.equal(new URL(page.url()).pathname, '/app');
  assert.equal(await page.locator('.recent-creations').count(), 0);
  assert.equal(await page.getByText('账号信息未提交', { exact: false }).count(), 0);
  await page.locator('.home-create textarea').fill('讲清楚一个有趣的想法');
  for (const width of [1536, 1280, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.screenshot({ path: `${out}/create-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `create overflow ${width}`);
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.getByRole('button', { name: '我的作品', exact: true }).click();
  await page.locator('.home-project-list > article').first().waitFor();
  assert.equal(new URL(page.url()).hash, '#/projects');
  await page.getByLabel('搜索项目', { exact: true }).fill('春日');
  assert.equal(await page.locator('.home-project-list > article').count(), 1);
  await page.getByRole('button', { name: '清除搜索' }).click();
  await page.getByLabel('作品排序').selectOption('oldest');
  const menu = page.getByRole('button', { name: '项目操作 把想法变成故事' });
  await menu.click();
  await page.getByRole('button', { name: '重命名', exact: true }).click();
  await page.getByLabel('作品名称', { exact: true }).fill('作品新名称');
  await page.getByRole('button', { name: '保存名称' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(renamePayload.title, '作品新名称');
  assert.ok(await page.getByRole('button', { name: '项目操作 作品新名称' }).isVisible());
  await page.getByRole('button', { name: '新建视频', exact: true }).click();
  assert.equal(await page.locator('.home-create textarea').inputValue(), '讲清楚一个有趣的想法');
  await page.getByRole('button', { name: '我的作品', exact: true }).click();
  for (const width of [1536, 1280, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.screenshot({ path: `${out}/projects-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `projects overflow ${width}`);
  }
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.getByRole('button', { name: '素材工坊', exact: true }).click();
  await page.getByRole('heading', { name: '我的素材', exact: true }).waitFor();
  await page.locator('.asset-card-item').first().waitFor();
  assert.equal(new URL(page.url()).hash, '#/assets');
  assert.equal(await page.locator('.editorial-inspector').count(), 0);
  await page.getByLabel('搜索素材', { exact: true }).fill('秋日');
  await page.waitForFunction(() => document.querySelectorAll('.asset-card-item').length === 1);
  assert.equal(await page.locator('.asset-card-item').count(), 1);
  await page.getByLabel('搜索素材', { exact: true }).fill('');
  await page.waitForFunction(() => document.querySelectorAll('.asset-card-item').length === 4);
  await page.getByLabel('素材排序').selectOption('name');
  await page.locator('.asset-card-item').first().locator('button').click();
  const inspector = page.locator('.editorial-inspector');
  await inspector.waitFor();
  assert.equal(await inspector.evaluate(dialog => dialog.matches(':modal')), true);
  await page.screenshot({ path: out + '/asset-detail.png' });
  await page.keyboard.press('Escape');
  await inspector.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.asset-card-item button').first().evaluate(button => button === document.activeElement), true);
  await page.getByRole('button', { name: '批量整理', exact: true }).click();
  await page.getByRole('button', { name: '选择素材 秋日背景音乐.mp3', exact: true }).click();
  await page.getByRole('toolbar', { name: '批量整理素材' }).getByLabel('批量移动到文件夹').selectOption('folder-brand');
  await page.getByRole('button', { name: '移动', exact: true }).click();
  await page.getByText('已将 1 项素材移动到“品牌素材”', { exact: true }).waitFor();
  const tabs = page.getByRole('navigation', { name: '素材类型' });
  await tabs.getByRole('button', { name: /^视频/ }).click();
  assert.equal(await page.locator('.asset-card-item').count(), 1);
  await tabs.getByRole('button', { name: /^全部/ }).click();
  for (const width of [1536, 1280, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    await page.screenshot({ path: `${out}/assets-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `assets overflow ${width}`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS editorial UI: login API and routing, creation draft persistence, project search/sort/rename, asset search/type/sort/bulk move, modal keyboard/focus, five viewport widths, reduced motion. API fixtures only.');
} catch (error) {
  await page.screenshot({ path: out + '/failure.png' });
  throw error;
} finally { await browser.close(); }
