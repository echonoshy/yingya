import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock, detail } from './ui-qa.mjs';

// Browser plugin unavailable. Exercise the served frontend with isolated API
// fixtures and a simulated next release; never submit real production work.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8806';
const current = await (await fetch(base + '/app-version.json')).json();
const next = { ...current, buildId: 'qa-next-build', version: '0.5.65', changes: ['版本更新测试：保留当前输入与制作状态。'] };
const out = `/tmp/yingya-app-update/${base.startsWith('https') ? 'public' : 'local'}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const badge = () => page.getByRole('button', { name: '新版本，查看更新说明', exact: true });
const dialog = () => page.getByRole('dialog', { name: '新版本可用', exact: true });
let latest = current, mode = 'ok', checks = 0, navigations = 0;
page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
await page.route('**/app-version.json', route => {
  checks++;
  if (mode === 'offline') return route.abort();
  return route.fulfill({ json: mode === 'invalid' ? { maintenance: true } : latest });
});
await page.clock.install();
async function poll() {
  const before = checks;
  await page.clock.fastForward(61_000);
  // Let network I/O settle before moving the virtual clock again (otherwise
  // the next fast-forward can abort a response via the 10s request timeout).
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(checks > before, 'Visible pages periodically check for a release');
}
async function bounds(locator) {
  const box = await locator.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= page.viewportSize().width + 1, JSON.stringify(box));
}
try {
  await page.goto(base);
  await page.locator('#home-idea').fill('更新提示不能清掉这段创作描述');
  assert.equal(await badge().count(), 0);
  const loaded = navigations;
  mode = 'offline'; await poll(); mode = 'invalid'; await poll();
  assert.equal(await badge().count(), 0, 'Failed checks never invent an update');
  mode = 'ok'; latest = next; await poll(); await badge().waitFor();
  assert.equal(navigations, loaded, 'Version detection does not navigate');
  assert.equal(await page.locator('#home-idea').inputValue(), '更新提示不能清掉这段创作描述');
  assert.equal(await page.locator('#home-idea').evaluate(el => el === document.activeElement), true, 'Detection does not steal focus');
  assert.equal(await dialog().count(), 0, 'Details require an explicit click');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await bounds(badge());
    await page.screenshot({ path: `${out}/home-${width}.png` });
    await badge().focus(); await page.keyboard.press('Enter'); await bounds(dialog());
    await page.screenshot({ path: `${out}/dialog-${width}.png` });
    await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' });
    assert.ok(await badge().evaluate(el => el === document.activeElement));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight <= innerHeight + 1), true);
  }
  // Returning to an existing tab/BFCache restoration only checks; it never reloads.
  await page.clock.fastForward(16_000);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(navigations, loaded);
  latest = current; await poll(); await badge().waitFor({ state: 'hidden' });
  // A rollback (lower semantic version, different build) must still be detectable.
  latest = { ...next, version: '0.5.1', buildId: 'qa-rollback' }; await poll(); await badge().waitFor();
  await badge().click(); await page.getByText('v0.5.1', { exact: true }).waitFor();
  latest = current;
  await page.getByRole('button', { name: '刷新更新', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.app-update-badge'));
  assert.ok(navigations > loaded, 'Only the explicit update action reloads');
  await page.reload(); await page.locator('#home-idea').waitFor();
  assert.equal(await badge().count(), 0, 'A freshly loaded current release has no update badge');

  // Account entry, draft preservation, upload blocker and task view.
  await installApiMock(page); latest = next;
  await page.goto(base + '/app#/');
  await page.locator('#creation-prompt').fill('保留制作草稿');
  await page.locator('.account-update-label').waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 }); await bounds(page.locator('.account-update-label'));
    await page.locator('.account-panel > summary').click(); await bounds(badge());
    await page.screenshot({ path: `${out}/account-${width}.png` });
    await badge().click(); await dialog().waitFor(); await page.keyboard.press('Escape'); await dialog().waitFor({ state: 'hidden' });
    assert.ok(await page.locator('.account-panel > summary').evaluate(el => el === document.activeElement));
  }
  assert.equal(await page.locator('#creation-prompt').inputValue(), '保留制作草稿');
  await page.setViewportSize({ width: 1440, height: 1000 });
  let finishUpload, uploadStarted = false;
  await page.route(/\/assets\/library$/, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    uploadStarted = true;
    await new Promise(resolve => { finishUpload = resolve; });
    return route.fulfill({ status: 500, json: { message: '受控测试：上传结束' } });
  });
  await page.goto(base + '/app#/assets');
  await page.locator('.asset-library-header input[type="file"]').setInputFiles({ name: '更新测试.txt', mimeType: 'text/plain', buffer: Buffer.from('test') });
  await page.getByRole('region', { name: '素材上传进度' }).waitFor();
  assert.ok(uploadStarted);
  await page.locator('.account-panel > summary').click(); await badge().click();
  const beforeUploadRefresh = navigations;
  await page.getByRole('button', { name: '刷新更新', exact: true }).click();
  await dialog().getByRole('alert').filter({ hasText: '素材仍在上传或保存' }).waitFor();
  assert.equal(navigations, beforeUploadRefresh, 'The explicit update button cannot abort an upload');
  await page.screenshot({ path: `${out}/upload-blocked.png` });
  finishUpload(); await page.getByText('受控测试：上传结束', { exact: true }).waitFor();
  latest = current;
  await page.getByRole('button', { name: '刷新更新', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.account-update-label'));
  assert.ok(navigations > beforeUploadRefresh);
  await page.goto(base + '/app#/projects/' + detail.id);
  await page.locator('.workspace').waitFor();
  const beforeTask = navigations;
  latest = next; await poll(); await page.locator('.account-update-label').waitFor();
  assert.equal(navigations, beforeTask, 'The task view survives update detection');
  await page.screenshot({ path: `${out}/workspace.png` });

  // Logged-out entry and admin entry are also usable at narrow widths.
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { message: '请登录' } }));
  await page.route('**/api/admin/**', route => route.fulfill({ status: 401, json: { message: '请登录' } }));
  for (const path of ['/app#/', '/admin', '/s/invalid']) {
    await page.goto(base + path); await page.reload(); await badge().waitFor();
    for (const width of [1440, 320]) {
      await page.setViewportSize({ width, height: 900 }); await bounds(badge());
      await page.screenshot({ path: `${out}/${path.split('/')[1]}-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS: release polling, offline/invalid manifest, no navigation/focus/draft loss, focus/BFCache, rollback, explicit refresh, new document, upload protection, task view, keyboard dialog, desktop/390/320px. API and next release simulated.');
} catch (error) { await page.screenshot({ path: `${out}/failure.png` }); throw error; }
finally { await browser.close(); }
