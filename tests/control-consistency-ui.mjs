import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock } from './ui-qa.mjs';

// Browser plugin unavailable; exercise the actual frontend using isolated API fixtures.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = `/tmp/yingya-ui-controls/${base.startsWith('https') ? 'public' : 'local'}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1151 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = [], decorativeMedia = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/opus-motion\/.*\.(mp4|webp)/.test(request.url())) decorativeMedia.push(request.url()); });
const combo = name => page.getByRole('combobox', { name, exact: true });
async function choose(name, label) {
  await combo(name).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  assert.equal(await combo(name).textContent(), label);
  assert.equal(await combo(name).getAttribute('aria-expanded'), 'false');
}
async function bounds(locator) {
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width + 1 && box.y + box.height <= page.viewportSize().height + 1, JSON.stringify(box));
}
async function noDecoration() { assert.equal(await page.locator('.studio-art, .character-glyph, .character-film').count(), 0); }
try {
  await installApiMock(page);
  const longName = '品牌资料与参考素材文件夹'.repeat(6);
  let empty = false;
  const asset = (id, category, sourceName, mimeType) => ({ id, category, sourceName, mimeType, url: '/fixture-file', projectPath: 'assets/' + sourceName, prompt: null, kind: 'uploaded', folderId: null, createdAt: 1781593567000 });
  const assets = [asset('other', 'file', '项目源文件.zip', 'application/zip'), asset('doc', 'document', '创作说明.pdf', 'application/pdf')];
  await page.route(/\/assets\/folders$/, route => route.fulfill({ json: [{ id: 'long', name: longName, createdAt: 1781593567000 }] }));
  await page.route(/\/assets\/library$/, route => route.request().method() === 'GET' ? route.fulfill({ json: { assets: empty ? [] : assets } }) : route.fallback());
  await page.goto(base + '/app#/');
  await page.getByRole('button', { name: '添加素材', exact: true }).click();
  await page.getByRole('menuitem', { name: '素材库', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '从素材库选择', exact: true });
  const folder = combo('参考素材文件夹');
  for (const width of [1400, 1093, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1151 });
    await folder.click();
    await bounds(page.getByRole('listbox', { name: '参考素材文件夹' }));
    await page.screenshot({ path: `${out}/folder-${width}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await picker.isVisible(), true, 'Escape dismisses only the inner menu');
    assert.equal(await folder.evaluate(el => el === document.activeElement), true);
    assert.equal(await folder.getAttribute('aria-expanded'), 'false');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await folder.press('ArrowDown'); await page.keyboard.press('End'); await page.keyboard.press('Enter');
  assert.equal(await folder.textContent(), longName);
  await picker.getByText('没有匹配的素材，可调整筛选或添加附件', { exact: true }).waitFor();
  await folder.press('ArrowDown'); await page.keyboard.press('Home'); await page.keyboard.press('Enter');
  await picker.getByText('已选 0 项 · 找到 2 项', { exact: true }).waitFor();
  await folder.click(); await page.keyboard.press('Tab');
  assert.equal(await folder.getAttribute('aria-expanded'), 'false');
  assert.ok(await picker.evaluate(el => el.contains(document.activeElement)));
  await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1400, height: 1151 });
  assert.equal(await page.getByRole('button', { name: '创作设置', exact: true }).count(), 0);
  await page.getByRole('button', { name: '参考时长：约 30 秒', exact: true }).click();
  await page.getByRole('spinbutton', { name: '参考时长（秒）' }).fill('45');
  await page.getByRole('button', { name: '确定', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '参考时长：约 45 秒', exact: true }).waitFor();
  await page.goto(base + '/app#/assets');
  await page.getByRole('navigation', { name: '素材类型' }).getByRole('button', { name: /^其他/ }).click();
  await page.locator('.asset-card-item', { hasText: '项目源文件.zip' }).waitFor();
  assert.equal(await page.locator('.asset-card-item').count(), 1);
  assert.match(await page.locator('.asset-media-tabs .active').textContent(), /^其他1$/);
  for (const width of [1400, 1093, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1151 });
    await page.locator('.asset-media-tabs .active').scrollIntoViewIfNeeded();
    await bounds(page.locator('.asset-media-tabs .active'));
    await bounds(combo('素材排序'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: `${out}/other-${width}.png` });
  }
  await page.setViewportSize({ width: 1400, height: 1151 });
  await page.getByRole('navigation', { name: '素材类型' }).getByRole('button', { name: /^全部/ }).click();
  const spacing = await page.getByRole('navigation', { name: '素材来源' }).evaluate(el => [...el.children].slice(1).map((item, i) => item.getBoundingClientRect().left - el.children[i].getBoundingClientRect().right));
  assert.ok(spacing.every(gap => gap >= 20), JSON.stringify(spacing));
  await choose('素材排序', '名称排序');
  empty = true; await page.reload();
  await page.getByText('这个分类还没有素材', { exact: true }).waitFor();
  await noDecoration();
  await page.screenshot({ path: `${out}/empty.png` });
  // Source changes must not move or resize the empty-state copy.
  const emptyMetrics = [];
  for (const source of ['上传', 'AI 生成']) {
    await page.getByRole('navigation', { name: '素材来源' }).getByRole('button', { name: source, exact: true }).click();
    await page.locator('.asset-empty-state h2').filter({ hasText: source === 'AI 生成' ? '这里还没有 AI 生成的素材' : '这个分类还没有素材' }).waitFor();
    emptyMetrics.push(await page.locator('.asset-empty-state').evaluate(el => ['h2', 'p', 'button'].map(selector => {
      const item = el.querySelector(selector), rect = item.getBoundingClientRect();
      return { top: rect.top, height: rect.height, font: getComputedStyle(item).font };
    })));
  }
  assert.deepEqual(emptyMetrics[0], emptyMetrics[1]);
  const createMenu = page.getByRole('menu', { name: '创建素材', exact: true });
  await page.getByRole('button', { name: '创建素材', exact: true }).click();
  await createMenu.waitFor();
  await page.locator('.asset-library-header h1').click();
  await createMenu.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '创建素材', exact: true }).press('ArrowDown');
  await page.keyboard.press('End');
  assert.ok(await page.getByRole('menuitem', { name: '创建音色', exact: true }).evaluate(el => el === document.activeElement));
  await page.keyboard.press('Escape');
  await createMenu.waitFor({ state: 'hidden' });
  assert.ok(await page.getByRole('button', { name: '创建素材', exact: true }).evaluate(el => el === document.activeElement));
  await page.getByRole('button', { name: '创建素材', exact: true }).click();
  await page.getByRole('menuitem', { name: '创建音色', exact: true }).click();
  await noDecoration(); await page.keyboard.press('Escape');
  // Admin uses an uncontrolled named select; verify the actual submitted FormData.
  const quota = { tokenLimit: 100, usedTokens: 0, reservedTokens: 0, remainingTokens: 100, mediaLimit: 0, usedMedia: 0, reservedMedia: 0, remainingMedia: 0, disabled: false, unknownCalls: 0 };
  let member = { id: 'member', revision: 1, email: 'member@example.test', username: null, name: '', notes: '', registered: true, isAdmin: false, configuredAdmin: false, archived: false, createdAt: 1781593567000, lastLogin: null, quota };
  let submitted;
  await page.route('**/api/admin/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { user: { id: 'admin', email: 'admin@example.test', isAdmin: true } } });
    if (path.endsWith('/accounts/member/profile') && route.request().method() === 'PATCH') { submitted = route.request().postDataJSON(); member = { ...member, archived: submitted.status === 'archived' }; return route.fulfill({ json: { user: member } }); }
    if (path.endsWith('/accounts')) return route.fulfill({ json: { users: [member] } });
    if (path.endsWith('/invites')) return route.fulfill({ json: { invites: [] } });
    if (path.endsWith('/audit')) return route.fulfill({ json: { records: [] } });
    return route.fallback();
  });
  await page.goto(base + '/admin/users');
  await page.getByRole('button', { name: '管理 member@example.test', exact: true }).click();
  await choose('账号状态', '归档');
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await page.getByText('用户资料已保存', { exact: true }).waitFor();
  assert.equal(submitted.status, 'archived');
  await choose('筛选状态', '已归档');
  await page.screenshot({ path: `${out}/admin.png` });
  assert.deepEqual(errors, []); assert.deepEqual(decorativeMedia, []);
  console.log('PASS shared selects: modal layering, long labels, five widths, keyboard/typeahead/Escape/Tab, disabled settings, persistence, admin FormData; other files/counts, tab gaps and decoration removal. API fixtures only.');
} finally { await browser.close(); }
