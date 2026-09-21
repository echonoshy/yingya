import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Browser plugin unavailable; use the existing tmux frontend and approved Playwright fallback.
const baseUrl = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1400 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(baseUrl);
  await page.locator('#marketing-title').waitFor();
  assert.equal(await page.title(), '映芽 | 对话式动画视频制作工作台');
  assert.equal(await page.locator('#marketing-title').innerText(), '对话式视频制作');
  assert.equal(await page.locator('a[href="https://github.com/echonoshy/yingya"]').count(), 2);
  assert.equal(await page.locator('.marketing-example').count(), 6);
  assert.equal(await page.locator('vite-error-overlay, [data-arm], .factory-viewport, .cinema-feed').count(), 0);
  await page.waitForFunction(() => document.querySelector('.studio-marketing-art .studio-art img').complete && document.querySelector('.studio-marketing-art .studio-art img').naturalWidth > 0);
  assert.equal(await page.locator('.studio-marketing-art .studio-art img').evaluate(i => getComputedStyle(i).animationName), 'none');
  await page.locator('#showcase').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.marketing-example img')].every(i => i.src.endsWith('.webp') && i.complete && i.naturalWidth));
  assert.equal(new Set(await page.locator('.marketing-example img').evaluateAll(imgs => imgs.map(i => i.src))).size, 6);
  const before = await page.locator('.marketing-gallery').screenshot();
  await page.waitForTimeout(1000);
  const after = await page.locator('.marketing-gallery').screenshot();
  assert.notDeepEqual(before, after, 'Supplied WebP animation actually changes frames');
  assert.equal(await page.locator('.motion-gallery-tools, .motion-gallery-heading a, .motion-gallery-bottom p, .marketing-header nav').count(), 0);
  const expand = page.getByRole('button', { name: '展开更多例子', exact: true });
  assert.equal(await expand.innerText(), '', 'Expansion uses only an icon');
  await expand.click();
  assert.equal(await page.locator('.marketing-example').count(), 12);
  const collapse = page.getByRole('button', { name: '收起更多例子', exact: true });
  assert.equal(await collapse.evaluate(el => document.activeElement === el), true);
  await collapse.press('Enter');
  assert.equal(await page.locator('.marketing-example').count(), 6);
  await expand.press('Enter');
  assert.equal(await page.locator('.marketing-example').count(), 12);
  for (const button of await page.locator('.marketing-example').all()) {
    await button.click();
    await page.waitForFunction(() => document.querySelector('dialog video').readyState >= 2);
    assert.equal(await page.locator('dialog video').evaluate(v => v.error), null);
    assert.match(await page.locator('dialog').innerText(), /第三方效果参考/);
    assert.equal(await page.locator('.marketing-example img').evaluateAll(xs => xs.every(x => x.src.endsWith('.jpg'))), true);
    await page.getByRole('button', { name: '复制创作需求', exact: true }).click();
    await page.getByRole('button', { name: '已复制需求', exact: true }).waitFor();
    assert.ok((await page.evaluate(() => navigator.clipboard.readText())).length > 20);
    await page.keyboard.press('Escape');
    assert.equal(await button.evaluate(el => document.activeElement === el), true);
  }
  const watch = page.getByRole('button', { name: '观看演示', exact: true });
  await watch.click();
  await page.waitForFunction(() => document.querySelector('dialog video').currentTime > .1);
  assert.ok(Math.abs(await page.locator('dialog video').evaluate(v => v.duration) - 65.833) < .1);
  await page.keyboard.press('Escape');
  assert.equal(await watch.evaluate(el => document.activeElement === el), true);
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1400 : 1000 });
    await page.locator('.marketing-page').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
    assert.equal(await page.locator('.marketing-page').evaluate(el => el.scrollWidth <= el.clientWidth), true, `No overflow at ${width}`);
    assert.equal(await page.locator('.studio-marketing-art .studio-art img').evaluate(el => el.getAnimations().length), 0, 'Theme artwork has no autonomous animation');
    await page.locator('#showcase').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(450);
    const box = await page.locator('.motion-more').boundingBox();
    assert.ok(box.height >= 40 && box.width >= 40 && box.x >= 0 && box.x + box.width <= width);
    await page.screenshot({ path: `/tmp/motion-gallery-${width}.png` });
  }
  await page.goto(baseUrl);
  const workflow = page.locator('.workflow-showcase');
  await workflow.scrollIntoViewIfNeeded();
  assert.deepEqual(await workflow.locator('li').allTextContents(), ['提供素材与要求', '确认方案', '用自然语言修改', '导出成片']);
  assert.equal(await workflow.locator('button, img, h2, [role="tabpanel"]').count(), 0);
  await page.waitForFunction(() => document.querySelector('.workflow-showcase').dataset.revealed === 'true');
  assert.ok(await workflow.evaluate(el => el.getAnimations({ subtree: true }).length > 0));
  await page.waitForTimeout(700);
  assert.equal(await workflow.locator('li').evaluateAll(items => items.every(el => getComputedStyle(el).opacity === '1')), true);
  await workflow.locator('li').first().hover();
  await page.waitForTimeout(260);
  assert.notEqual(await workflow.locator('.workflow-icon').first().evaluate(el => getComputedStyle(el).transform), 'none');
  for (const width of [1440, 903, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 });
    await workflow.scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.marketing-page').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    for (const step of await workflow.locator('li').all()) {
      const box = await step.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width);
      assert.equal(await step.locator('span').evaluate(el => { const text = el.getBoundingClientRect(), cell = el.parentElement.getBoundingClientRect(); return text.left >= cell.left && text.right <= cell.right && el.scrollWidth <= el.clientWidth; }), true, 'Step text fits');
    }
    await page.screenshot({ path: `/tmp/workflow-qa-${width}.png` });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(baseUrl);
  await page.locator('#showcase').scrollIntoViewIfNeeded();

  assert.equal(await page.locator('.marketing-example img').evaluateAll(xs => xs.every(x => x.src.endsWith('.jpg'))), true);
  await page.locator('.workflow-showcase').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.motion-tile').evaluateAll(xs => xs.every(x => x.getAnimations().length === 0)), true, 'Reduced motion disables layout animations');
  assert.equal(await page.locator('.workflow-showcase').evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  await watch.click();
  await page.waitForFunction(() => document.querySelector('dialog video').currentTime > .1);
  await page.keyboard.press('Escape');
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.getByRole('link', { name: '登录', exact: true }).click();
  await page.locator('#login-email').waitFor();
  await page.getByRole('link', { name: '返回映芽首页', exact: true }).click();
  await page.locator('#marketing-title').waitFor();
  assert.deepEqual(errors, []);
  console.log('Marketing QA passed: centered reference layout, selected theme artwork, 12 WebPs, six-card initial page, icon expansion/collapse, removed controls, concise four-step workflow, 12 dialog conversions, full intro, focus/copy, responsive widths, reduced motion, GitHub and login.');
  await context.close();
} finally { await browser.close(); }
