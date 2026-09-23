import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Browser plugin not available. Use the existing tmux frontend or public release.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1487, height: 1058 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const video = page.locator('.ink-preview video');
  await video.waitFor({ state: 'attached' });
  assert.equal(await video.evaluate(el => el.paused), true, 'No autoplay');
  assert.equal(await video.getAttribute('preload'), 'none', 'Clip loads only on demand');
  await page.getByRole('button', { name: '播放山水预览', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.ink-preview video').currentTime > .3);
  assert.equal(await video.evaluate(el => el.error), null);
  assert.ok(Math.abs(await video.evaluate(el => el.duration) - 12) < .1);
  await page.getByRole('button', { name: '暂停山水预览', exact: true }).click();
  assert.equal(await video.evaluate(el => el.paused), true);
  await page.getByRole('button', { name: '跳转到第 8 秒画面' }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('.ink-preview video').currentTime - 8) < .1);
  assert.equal(await page.getByRole('button', { name: '跳转到第 8 秒画面' }).getAttribute('aria-pressed'), 'true');
  const progress = page.getByRole('slider', { name: '山水预览播放进度' });
  await progress.focus(); await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.ink-preview video').currentTime > 8);
  await page.getByRole('button', { name: '播放山水预览', exact: true }).click();
  await page.getByRole('button', { name: '观看演示', exact: true }).click();
  assert.equal(await video.evaluate(el => el.paused), true, 'Opening demo pauses hero');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '播放山水预览', exact: true }).click();
  await page.locator('.workflow-showcase').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('.ink-preview video').paused);
  await page.locator('.marketing-page').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '全屏查看山水预览' }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.evaluate(() => document.exitFullscreen());
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload(); await video.waitFor({ state: 'attached' });
  assert.equal(await video.evaluate(el => el.paused), true, 'Reduced motion never starts a clip');
  // Loading and seeking a never-played clip works, including keyboard navigation.
  await page.getByRole('button', { name: '跳转到第 4 秒画面' }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('.ink-preview video').currentTime - 4) < .1);
  for (const width of [1487, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width > 1000 ? 1058 : 1000 });
    assert.ok(await page.locator('.marketing-page').evaluate(el => el.scrollWidth <= el.clientWidth), `No overflow at ${width}`);
    for (const control of await page.locator('.ink-preview-controls button, .ink-preview-controls input, .ink-preview-shots button').all()) {
      await control.scrollIntoViewIfNeeded();
      assert.ok(await control.evaluate(el => { const r=el.getBoundingClientRect(); const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2); return el===hit || el.contains(hit); }), `Preview controls not covered by creatures at ${width}`);
    }
  }
  assert.deepEqual(errors, []);
  console.log('Ink preview passed: real playback/pause, keyboard seek, direct unloaded seek, shot selection, fullscreen, modal/offscreen pause, reduced motion and unobstructed controls at five widths.');
} finally { await browser.close(); }
