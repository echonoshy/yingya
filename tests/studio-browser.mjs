import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock, detail } from './ui-qa.mjs';

// Use isolated API responses: verify real frontend navigation and animation without
// creating production videos or reading an account's private projects.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = process.env.YINGYA_STUDIO_QA_OUT ?? '/tmp/yingya-studio-qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1488, height: 1058 } });
  page.on('pageerror', error => errors.push(error.message));
  await installApiMock(page);
  await page.goto(`${base}/app#/`);
  const prompt = page.locator('.home-create textarea');
  const artwork = page.locator('.home-create .studio-art');
  await prompt.waitFor();
  await artwork.locator('img').evaluate(image => image.decode());
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.home-projects, .knowledge-example-grid, .home-header').count(), 0);
  await page.waitForTimeout(500);
  await artwork.hover();
  assert.ok(await artwork.evaluate(el => el.getAnimations().length > 0), 'Hover triggers short illustration response');
  await prompt.fill('解释海浪形成的原因');
  await page.waitForTimeout(450);
  await page.mouse.move(10, 400);
  await artwork.hover();
  assert.equal(await artwork.evaluate(el => el.getAnimations().length), 0, 'Typing prevents decoration motion');
  await page.getByRole('button', { name: '暂停插画动效', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: '播放插画动效', exact: true }).waitFor();
  assert.equal(await artwork.evaluate(el => el.getAnimations().length), 0, 'Pause preference survives reload');
  assert.equal(await prompt.inputValue(), '解释海浪形成的原因', 'Draft survives reload');
  await page.getByRole('button', { name: '播放插画动效', exact: true }).click();
  await page.getByRole('button', { name: '我的作品', exact: true }).click();
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor();
  assert.equal(await page.locator('.home-create').count(), 0);
  assert.equal(await page.getByRole('button', { name: '我的作品', exact: true }).getAttribute('aria-current'), 'page');
  await page.screenshot({ path: `${out}/projects.png` });
  await page.getByRole('button', { name: '素材工坊', exact: true }).click();
  await page.getByRole('heading', { name: '素材工坊', exact: true }).waitFor();
  assert.equal(await page.locator('.app-navigation-surface').count(), 1);
  await page.screenshot({ path: `${out}/assets.png` });
  await page.getByRole('button', { name: '新建视频', exact: true }).click();
  assert.equal(await prompt.inputValue(), '解释海浪形成的原因');
  // Both home and account pages use the same functional compact navigation.
  await page.locator('.app-account-dock summary').click();
  await page.getByRole('button', { name: '用量统计', exact: true }).click();
  await page.locator('.usage-page').waitFor();
  await page.getByRole('button', { name: '我的作品', exact: true }).click();
  await page.getByRole('heading', { name: '我的作品', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建视频', exact: true }).click();

  for (const width of [1024, 800, 390, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 768 : 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}`);
    for (const name of ['新建视频', '我的作品', '素材工坊', '生成方案']) {
      const button = page.getByRole('button', { name, exact: true });
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, `${name} is visible at ${width}`);
    }
    // Keyboard navigation and mobile task/account controls must not overlap.
    const dock = await page.locator('.app-account-dock').boundingBox();
    const task = await page.locator('.task-center-trigger').boundingBox();
    if (width <= 800 && task) assert.ok(dock.x + dock.width <= task.x + 1, `Account/task controls don't overlap at ${width}`);
    await page.screenshot({ path: `${out}/home-${width}.png` });
    await page.getByRole('button', { name: '素材工坊', exact: true }).click();
    await page.getByRole('heading', { name: '素材工坊', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Assets fit ${width}`);
    await page.getByRole('button', { name: '新建视频', exact: true }).click();
    await prompt.waitFor();
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await artwork.hover();
  assert.equal(await artwork.evaluate(el => el.getAnimations().filter(a => a.playState === 'running').length), 0, 'Reduced motion disables illustration animation');
  await page.setViewportSize({ width: 1752, height: 898 });
  await prompt.fill('');
  await prompt.blur();
  await page.screenshot({ path: `${out}/home-reference.png` });
  await page.goto(`${base}/app#/projects/${detail.id}`);
  await page.locator('.knowledge-workspace').waitFor();
  assert.equal(await page.locator('.studio-backdrop').count(), 0, 'Workbench has no ambient animation');
  await page.screenshot({ path: `${out}/workbench.png` });
  await page.goto(`${base}/app#/`);
  await prompt.fill('主题等待页测试');
  let releaseCreation;
  const creationGate = new Promise(resolve => { releaseCreation = resolve; });
  await page.route(/\/api\/(?:u\/[^/]+\/)?agent-projects$/, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await creationGate;
    return route.fulfill({ json: detail });
  });
  await page.getByRole('button', { name: '生成方案', exact: true }).click();
  await page.locator('.creation-pending-card .studio-art img').evaluate(image => image.decode());
  await page.screenshot({ path: `${out}/pending.png` });
  assert.equal(await page.locator('.creation-pending-card .studio-art').getAttribute('data-theme'), await page.locator('html').getAttribute('data-studio-theme'));
  releaseCreation();
  await page.locator('.knowledge-workspace').waitFor();
  assert.deepEqual(errors, [], 'No frontend runtime errors');
  console.log(JSON.stringify({ result: 'passed', base, out, checks: 'motion, focus, pause persistence, drafts, navigation, account, responsive, reduced motion, workbench', api: 'isolated mocks' }));
} finally {
  await browser.close();
}
