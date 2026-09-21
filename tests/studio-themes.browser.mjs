import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock, detail } from './ui-qa.mjs';

// Browser plugin not available. Exercise the real frontend with controlled API
// fixtures; these checks never create videos, users, invoices or public shares.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = process.env.YINGYA_THEME_QA_OUT ?? '/tmp/yingya-comic-theme-qa';
const themes = ['comic'];
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
const totals = { calls: 0, knownCalls: 0, pendingCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
const billing = { month: '2026-09', since: 1788192000, until: 1790784000, currency: 'USD', timeZone: 'Asia/Shanghai', priceVersion: 'fixture', prices: [], totals, users: [], lines: [], invoices: [] };

async function addFixtures(page) {
  await installApiMock(page);
  await page.route('**/api/usage?*', route => route.fulfill({ json: { users: [], models: [] } }));
  await page.route('**/api/quota', route => route.fulfill({ json: { tokenLimit: 1000000, usedTokens: 0, reservedTokens: 0, remainingTokens: 1000000, mediaLimit: 0, usedMedia: 0, reservedMedia: 0, remainingMedia: 0, unknownCalls: 0, disabled: false } }));
  await page.route('**/api/billing?*', route => route.fulfill({ json: billing }));
  await page.route('**/api/admin/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/me') ? { user: { id: 'qa-admin', email: 'admin@example.test', isAdmin: true } }
      : path.endsWith('/accounts') ? { users: [] } : path.endsWith('/invites') ? { invites: [] }
      : path.endsWith('/audit') ? { records: [] } : path.endsWith('/billing') ? billing : { shares: [] };
    return route.fulfill({ json });
  });
  await page.route('**/api/public/shares/*', route => route.fulfill({ json: { title: '主题检查示例', version: 'v1', expiresAt: null, duration: 5, width: 1280, height: 720, videoUrl: '/marketing/video/yingya-intro-v4.mp4', posterUrl: '/brand/yingya-ghost.png' } }));
}

async function check(page, theme, surface, variant, width = 1440) {
  const headings = { home: '今天想做什么视频？', projects: '我的作品', assets: '素材工坊', usage: '用量统计', billing: 'API 等价账单', admin: '用户管理', 'admin-invites': '邀请码', 'admin-audit': '操作记录', 'admin-shares': '视频分享', 'admin-billing': 'API 等价账单' };
  if (headings[surface]) await page.getByRole('heading', { name: headings[surface], exact: true }).waitFor();
  else await page.locator(`.studio-art[data-artwork="${variant}"]:visible`).first().waitFor();
  if (surface === 'home') {
    assert.equal(await page.locator('.home-create .studio-art--home').count(), 1, 'Creation uses the selected comic hero');
    assert.equal(await page.locator('.paper-accent').count(), 0, 'No legacy paper decoration');
    assert.equal(await page.locator('.studio-motion-toggle').count(), 0, 'No orphan illustration control');
    assert.equal(await page.locator('.studio-shell').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)');
  }
  await page.locator('.studio-art:visible img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('html').getAttribute('data-studio-theme'), theme, `${surface}: stable theme`);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  const art = await page.locator('.studio-art:visible').evaluateAll(nodes => nodes.map(node => ({ theme: node.dataset.theme, variant: node.dataset.artwork, width: node.clientWidth, image: node.querySelector('img').naturalWidth, visible: getComputedStyle(node.querySelector('img')).visibility })));
  assert.ok(art.length > 0, `${surface}: comic artwork present`);
  assert.ok(art.every(item => item.theme === theme && item.width > 0 && item.image > 0 && item.visible !== 'hidden'), `${surface}: complete matching art`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${surface}: no viewport overflow at ${width}`);
  const path = `${out}/${theme}-${surface}-${width}.png`;
  await page.screenshot({ path, fullPage: false });
  results.push({ theme, surface, width, variant, path, artwork: art });
}

try {
  for (const theme of themes) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript(id => { if (!sessionStorage.getItem('yingya-studio-theme-v1')) sessionStorage.setItem('yingya-studio-theme-v1', id); }, theme);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ theme, error: error.message }));
    await addFixtures(page);
    await page.goto(`${base}/app#/`);
    await page.locator('.home-create textarea').waitFor();
    await check(page, theme, 'home', 'home');
    const draft = `保留${theme}的创作草稿`;
    await page.locator('.home-create textarea').fill(draft);
    await page.getByRole('button', { name: '我的作品', exact: true }).click();
    await check(page, theme, 'projects', 'projects');
    await page.getByRole('searchbox', { name: '搜索项目' }).fill('没有这个作品');
    await page.getByText('没有符合条件的项目', { exact: true }).waitFor();
    assert.equal(await page.locator('.home-project-empty .studio-art').getAttribute('data-theme'), theme);
    await page.getByRole('button', { name: '素材工坊', exact: true }).click();
    await check(page, theme, 'assets', 'assets');
    await page.getByRole('button', { name: '新建视频', exact: true }).click();
    assert.equal(await page.locator('.home-create textarea').inputValue(), draft);
    await page.locator('.app-account-dock summary').click();
    await page.getByRole('button', { name: '用量统计', exact: true }).click();
    await page.getByRole('heading', { name: '用量统计', exact: true }).waitFor();
    await check(page, theme, 'usage', 'account');
    await page.locator('.app-account-dock summary:visible').click();
    await page.getByRole('button', { name: 'API 等价账单', exact: true }).click();
    await page.getByRole('heading', { name: 'API 等价账单', exact: true }).waitFor();
    await check(page, theme, 'billing', 'account');
    await page.getByRole('button', { name: '新建视频', exact: true }).click();
    await page.goto(`${base}/app#/projects/${detail.id}`);
    await page.locator('.knowledge-workspace').waitFor();
    await check(page, theme, 'workspace', 'workspace');
    assert.equal(await page.locator('.studio-backdrop').count(), 0);
    await page.goto(`${base}/s/${'a'.repeat(64)}`);
    await page.getByRole('heading', { name: '主题检查示例' }).waitFor();
    await check(page, theme, 'share', 'workspace');
    await page.goto(`${base}/admin/users`);
    await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor();
    await check(page, theme, 'admin', 'account');
    for (const [route, heading] of [['invites', '邀请码管理'], ['audit', '操作审计'], ['shares', '视频分享'], ['billing', 'API 等价账单']]) {
      await page.goto(`${base}/admin/${route}`);
      await check(page, theme, `admin-${route}`, 'account');
    }
    await page.goto(base);
    await page.locator('#marketing-title').waitFor();
    await check(page, theme, 'marketing', 'marketing');

    // Phone and narrow viewport checks retain the same selected family.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${base}/app#/`);
      await page.locator('.home-create textarea').waitFor();
      await check(page, theme, 'home', 'home', width);
      for (const name of ['新建视频', '我的作品', '素材工坊', '生成方案']) {
        const box = await page.getByRole('button', { name, exact: true }).boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `${theme}: ${name} fits at ${width}`);
      }
      assert.equal(await page.locator('.home-create textarea').evaluate(el => getComputedStyle(el).fontSize), '16px');
      const tools = await page.locator('.composer-more-trigger, .home-create .model-trigger, .home-create .send-button').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().y));
      assert.ok(Math.max(...tools) - Math.min(...tools) < 2, 'Mobile composer actions stay on one row');
      await page.getByRole('button', { name: '添加素材与设置', exact: true }).click();
      await page.getByLabel('视频画幅', { exact: true }).selectOption('9:16');
      assert.equal(await page.getByLabel('视频画幅', { exact: true }).inputValue(), '9:16');
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button', { name: '添加素材与设置', exact: true }).evaluate(el => el === document.activeElement), true);

      await page.getByRole('button', { name: '我的作品', exact: true }).click();
      await check(page, theme, 'projects', 'projects', width);
      await page.getByRole('button', { name: '素材工坊', exact: true }).click();
      await check(page, theme, 'assets', 'assets', width);
      await page.goto(`${base}/app#/projects/${detail.id}`);
      await page.locator('.knowledge-workspace').waitFor();
      await check(page, theme, 'workspace', 'workspace', width);
      await page.goto(`${base}/app#/`);
      await page.locator('.app-account-dock summary').click();
      await page.getByRole('button', { name: '用量统计', exact: true }).click();
      await check(page, theme, 'usage', 'account', width);
      await page.locator('.app-account-dock summary:visible').click();
      await page.getByRole('button', { name: 'API 等价账单', exact: true }).click();
      await check(page, theme, 'billing', 'account', width);
      await page.goto(`${base}/s/${'a'.repeat(64)}`);
      await check(page, theme, 'share', 'workspace', width);
      await page.goto(`${base}/admin/shares`);
      await check(page, theme, 'admin-shares', 'account', width);
      await page.goto(base);
      await check(page, theme, 'marketing', 'marketing', width);
    }

    // Legacy theme compatibility survives navigation/reload without mutating the draft.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/app#/`);
    await page.locator('.home-create textarea').waitFor();
    assert.equal(await page.locator('.home-create textarea').inputValue(), draft);
    await page.locator('.app-account-dock summary').click();
    assert.equal(await page.getByRole('button', { name: /^换个画风/ }).count(), 0);
    await page.reload();
    await page.locator('.home-create textarea').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-studio-theme'), 'comic');
    assert.equal(await page.locator('.home-create textarea').inputValue(), draft);
    await context.close();

    const guest = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await guest.addInitScript(id => sessionStorage.setItem('yingya-studio-theme-v1', id), theme);
    const login = await guest.newPage();
    login.on('pageerror', error => errors.push({ theme, error: error.message }));
    await login.route('**/api/auth/me', route => route.fulfill({ status: 401, json: {} }));
    await login.goto(`${base}/app`);
    await login.locator('#login-email').waitFor();
    await check(login, theme, 'login', 'access');
    await login.getByRole('button', { name: '邀请注册', exact: true }).click();
    await login.locator('#login-invite').waitFor();
    await check(login, theme, 'register', 'access');
    for (const width of [390, 320]) {
      await login.setViewportSize({ width, height: 844 });
      await check(login, theme, 'register', 'access', width);
    }
    await login.setViewportSize({ width: 1440, height: 1000 });
    await login.goto(`${base}/app#reset=theme-qa&email=qa%40example.test`);
    await login.getByRole('heading', { name: '重置密码', exact: true }).waitFor();
    await check(login, theme, 'reset', 'access');
    await login.setViewportSize({ width: 320, height: 844 });
    await check(login, theme, 'reset', 'access', 320);
    await guest.close();
    console.log(`Theme ${theme}: app, library, assets, usage, billing, workbench, share, admin, marketing, login/register/reset, 390/320, comic surfaces and draft persistence passed.`);
  }
  assert.deepEqual(errors, [], 'No frontend runtime errors');
  await writeFile(`${out}/results.json`, JSON.stringify({ result: 'passed', base, browser: 'Playwright; Browser plugin not available', api: 'isolated mocks', themes, results, errors }, null, 2));
  console.log(`${results.length} rendered states verified at ${base}; evidence ${out}`);
} finally {
  await browser.close();
}
