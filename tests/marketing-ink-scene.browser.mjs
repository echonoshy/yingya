import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Browser plugin is unavailable; exercise the real rendered frontend with Playwright.
const baseUrl = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1762, height: 1232 } });
  const page = await context.newPage();
  const errors = [];
  const assets = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => assets.push(request.url()));
  await page.goto(baseUrl);
  await page.locator('.ink-visitor').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.querySelectorAll('.ink-landscape img')].every(img => img.complete && img.naturalWidth));
  assert.equal(await page.locator('.hero-playground, .studio-marketing-art').count(), 0);
  assert.ok(!assets.some(url => /toss-body|tug-director|tug-tumble|heroTug/.test(url)), 'Old 3D scene is not loaded');
  const visitors = page.locator('.ink-visitor');
  assert.equal(await visitors.count(), 3);
  const idle = () => page.locator('.ink-landscape').evaluate(el => el.getAnimations({ subtree: true }).length);
  assert.equal(await idle(), 0);
  for (const visitor of await visitors.all()) {
    const restingImage = await visitor.locator('img').boundingBox();
    await visitor.click();
    assert.equal(await visitor.getAttribute('data-playing'), 'true');
    assert.equal(await visitor.locator('img').evaluate(el => el.getAnimations()[0].effect.getTiming().duration), 800, 'CSS seconds convert to a visible 800ms action');
    await page.waitForTimeout(250);
    assert.equal(await visitor.getAttribute('data-playing'), 'true', 'Action remains visible after 250ms');
    const movingImage = await visitor.locator('img').boundingBox();
    assert.ok(Math.abs(movingImage.y - restingImage.y) > .5 || Math.abs(movingImage.width - restingImage.width) > .5, 'Rendered animal visibly moves');
    await visitor.click();
    assert.equal(await visitor.locator('img').evaluate(el => el.getAnimations().length), 1, 'Repeated click does not stack animations');
    await page.waitForFunction(() => [...document.querySelectorAll('.ink-visitor')].every(el => el.dataset.playing === 'false'));
    assert.equal(await visitor.locator('img').evaluate(el => getComputedStyle(el).transform), 'none');
  }
  await visitors.first().evaluate(el => el.style.setProperty('--motion-quick', '160ms'));
  await visitors.first().click();
  assert.equal(await visitors.first().locator('img').evaluate(el => el.getAnimations()[0].effect.getTiming().duration), 800, 'Milliseconds remain correct too');
  await page.waitForFunction(() => document.querySelector('.ink-visitor').dataset.playing === 'false');
  await visitors.first().evaluate(el => el.style.removeProperty('--motion-quick'));
  await visitors.first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await visitors.first().getAttribute('data-playing'), 'true');
  assert.equal(await visitors.first().evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
  await page.waitForFunction(() => document.querySelector('.ink-visitor').dataset.playing === 'false');
  await page.keyboard.press('Space');
  assert.equal(await visitors.first().getAttribute('data-playing'), 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.ink-landscape').getAnimations({ subtree: true }).length === 0);
  assert.equal(await idle(), 0, 'Preference changes cancel active motion');
  await visitors.first().click();
  const frames = await visitors.first().locator('img').evaluate(el => el.getAnimations()[0]?.effect.getKeyframes() ?? []);
  assert.ok(frames.length > 0 && frames.every(frame => !frame.transform), 'Reduced motion uses opacity only');
  await page.waitForFunction(() => document.querySelector('.ink-visitor').dataset.playing === 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await visitors.first().click();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  assert.equal(await idle(), 0, 'Blur cancels motion');
  await visitors.first().click();
  await page.locator('.workflow-showcase').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.ink-visitor').dataset.playing === 'false');
  assert.equal(await idle(), 0, 'Offscreen motion cancels');
  await page.evaluate(() => document.activeElement?.blur());
  for (const width of [1762, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 1000 ? 1232 : 1000 });
    await page.locator('.marketing-page').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(120);
    assert.equal(await page.locator('.marketing-page').evaluate(el => el.scrollWidth <= el.clientWidth), true, `No overflow at ${width}`);
    for (const visitor of await visitors.all()) {
      const box = await visitor.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `Visible touch target at ${width}`);
      assert.equal(await visitor.evaluate(el => { const b = el.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === el; }), true, 'Scene button is not covered');
    }
    assert.equal(await page.locator('#showcase').evaluate(el => el.getBoundingClientRect().width), width, 'Gallery paper spans full viewport');
    assert.equal(await idle(), 0);
    await page.screenshot({ path: `/tmp/yingya-ink-verified-${width}.png` });
  }
  const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await touch.newPage();
  await mobile.goto(baseUrl);
  await mobile.locator('.ink-visitor').first().tap();
  assert.equal(await mobile.locator('.ink-visitor').first().getAttribute('data-playing'), 'true');
  assert.equal(await mobile.locator('.ink-visitor').first().evaluate(el => getComputedStyle(el).touchAction), 'pan-y pinch-zoom');
  assert.deepEqual(errors, []);
  console.log('Ink scene QA passed: no legacy scene assets, three independent finite interactions, keyboard/focus, touch, cancellation, reduced motion, full-width gallery, six responsive widths, no page errors.');
  await touch.close();
  await context.close();
} finally { await browser.close(); }
