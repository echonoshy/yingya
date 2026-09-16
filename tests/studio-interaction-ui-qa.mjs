import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

// Browser plugin unavailable. Deliberately disable WebGL to cover embedded
// browsers: the gripper gesture must still render with 2D.
const baseUrl = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const output = process.env.YINGYA_STUDIO_QA_OUTPUT ?? '/tmp/yingya-studio-motion';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--disable-webgl'] });
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
await context.addInitScript(() => {
  window.studioRotationPeaks = { left: 0, right: 0 };
  const rotate = CanvasRenderingContext2D.prototype.rotate;
  CanvasRenderingContext2D.prototype.rotate = function (angle) {
    if (this.canvas.classList.contains('studio-motion')) {
      window.studioRotationPeaks.left = Math.max(window.studioRotationPeaks.left, angle);
      window.studioRotationPeaks.right = Math.min(window.studioRotationPeaks.right, angle);
    }
    return rotate.call(this, angle);
  };
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const scene = page.locator('.studio-scene');
async function open() {
  await page.goto(baseUrl);
  await page.locator('.studio-illustration').evaluate(image => image.decode());
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.title(), '映芽 | 对话式动画视频制作工作台');
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
}
async function point(x, y) {
  const bounds = await scene.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
}
async function settled() {
  await page.waitForFunction(() => !document.querySelector('.studio-scene').hasAttribute('data-moving'));
}
try {
  await open();
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.endsWith('/marketing/studio-clean-plate.png') && entry.responseEnd));
  const resting = await scene.screenshot();
  await page.screenshot({ path: `${output}/desktop-rest.png` });

  // A deliberate approach gives one short gesture, then remains still even
  // while the pointer stays near the arm. Foreground photos stay fixed.
  await point(.2, .85);
  await page.waitForTimeout(250);
  assert.equal(await scene.getAttribute('data-rendered'), null, 'Loose photos do not respond to pointer movement');
  assert.deepEqual(await scene.screenshot(), resting, 'Hovering the lower photos preserves the original image');
  await point(.294, .29);
  await page.waitForFunction(() => document.querySelector('.studio-scene').dataset.rendered === 'true');
  await page.waitForTimeout(450);
  assert.equal(await scene.evaluate(root => {
    const active = root.querySelector('canvas');
    const reference = document.createElement('canvas');
    reference.width = active.width; reference.height = active.height;
    const ctx = reference.getContext('2d', { alpha: false });
    ctx.drawImage(root.querySelector('img'), 0, 0, reference.width, reference.height);
    const top = Math.ceil(active.height * .74);
    const a = active.getContext('2d').getImageData(0, top, active.width, active.height - top).data;
    const b = ctx.getImageData(0, top, reference.width, reference.height - top).data;
    return a.every((value, index) => value === b[index]);
  }), true, 'Lower photos remain pixel-identical during the arm gesture');
  const responding = await scene.screenshot();
  assert.notDeepEqual(responding, resting, 'The pointer changes the rendered illustration');
  await page.screenshot({ path: `${output}/desktop-left-response.png` });
  await page.waitForTimeout(350);
  assert.equal(await scene.getAttribute('data-moving'), null, 'The faster response finishes within 900ms of approach');
  await settled();
  assert.ok(await page.evaluate(() => window.studioRotationPeaks.left > .05), 'The left gripper actually rotates; the gesture must be visible');
  const held = await scene.screenshot();
  assert.deepEqual(held, resting, 'The gesture returns to the original while still hovered');
  await page.waitForTimeout(450);
  assert.deepEqual(await scene.screenshot(), held, 'No perpetual motion while the pointer is held');

  await point(.72, .31);
  await page.waitForTimeout(450);
  assert.ok(await page.evaluate(() => window.studioRotationPeaks.right < -.05), 'The right gripper actually rotates');
  assert.equal(await scene.evaluate(root => {
    const active = root.querySelector('canvas');
    const reference = document.createElement('canvas');
    reference.width = active.width; reference.height = active.height;
    const ctx = reference.getContext('2d', { alpha: false });
    ctx.drawImage(root.querySelector('img'), 0, 0, reference.width, reference.height);
    // Includes both fingers, their contact shadows, and the screen's right border.
    const x = Math.ceil(1290 * active.width / 1942), y = Math.ceil(250 * active.height / 809);
    const w = Math.floor(130 * active.width / 1942), h = Math.floor(345 * active.height / 809);
    const a = active.getContext('2d').getImageData(x, y, w, h).data;
    const b = ctx.getImageData(x, y, w, h).data;
    return a.every((value, index) => value === b[index]);
  }), true, 'Right gripper contact and screen border remain pixel-identical during motion');
  await page.screenshot({ path: `${output}/desktop-right-response.png` });
  await page.mouse.move(720, 180);
  await settled();
  assert.equal(await scene.getAttribute('data-rendered'), null);
  assert.deepEqual(await scene.screenshot(), resting, 'Leaving restores the exact original illustration');

  // Fly-by entry must cancel its pending gesture when the pointer exits.
  await point(.294, .29);
  await page.mouse.move(720, 180);
  await page.waitForTimeout(1000);
  assert.equal(await scene.getAttribute('data-rendered'), null);
  assert.equal(await scene.getAttribute('data-moving'), null);

  await point(.72, .31);
  await page.getByRole('button', { name: '观看演示', exact: true }).click();
  assert.equal(await page.locator('dialog').isVisible(), true);
  assert.equal(await scene.getAttribute('data-rendered'), null);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: '观看演示', exact: true }).evaluate(el => el === document.activeElement), true);

  await point(.294, .29);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await point(.72, .31);
  assert.equal(await scene.getAttribute('data-rendered'), null);
  assert.equal(await scene.locator('canvas').isVisible(), false);
  await page.screenshot({ path: `${output}/reduced-motion.png` });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.mouse.move(720, 180);
  await point(.72, .31);
  await page.waitForFunction(() => document.querySelector('.studio-scene').dataset.rendered === 'true');

  // Desktop split panes still have a mouse. Window width must not disable it.
  for (const width of [640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForTimeout(1500); // Respect the previous approach cooldown after resizing.
    await point(.72, .31);
    await page.waitForFunction(() => document.querySelector('.studio-scene').dataset.rendered === 'true');
    assert.equal(await scene.locator('canvas').isVisible(), true);
    assert.equal(await page.locator('.marketing-page').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${output}/narrow-mouse-${width}.png` });
  }

  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.waitForTimeout(100);
  for (const name of ['播放左侧机械臂动作', '播放右侧机械臂动作']) {
    const button = page.getByRole('button', { name, exact: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.evaluate(() => { window.studioRotationPeaks = { left: 0, right: 0 }; });
      await button.click();
      await page.waitForFunction(() => document.querySelector('.studio-scene').dataset.rendered === 'true');
      await settled();
      const peaks = await page.evaluate(() => window.studioRotationPeaks);
      assert.ok(name.includes('左') ? peaks.left > .05 : peaks.right < -.05, 'Repeated clicks replay the full gesture without hover cooldown');
    }
    await button.focus();
    for (const key of ['Enter', 'Space']) {
      await page.keyboard.press(key);
      await page.waitForFunction(() => document.querySelector('.studio-scene').dataset.rendered === 'true');
      await settled();
    }
  }
  const replay = page.getByRole('button', { name: '播放右侧机械臂动作', exact: true });
  for (let i = 0; i < 4; i++) { await replay.click(); await page.waitForTimeout(60); }
  await page.mouse.move(720, 180);
  await page.waitForFunction(() => window.studioRotationPeaks.right < -.05);
  await settled();
  await page.waitForTimeout(600);
  assert.equal(await scene.getAttribute('data-moving'), null, 'Rapid clicks do not leave an animation queue');
  await replay.focus();
  await page.screenshot({ path: `${output}/keyboard-focus.png` });

  const fallbackContext = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await fallbackContext.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type === '2d' ? null : getContext.call(this, type, ...args);
    };
  });
  const fallback = await fallbackContext.newPage();
  fallback.on('pageerror', error => errors.push(error.message));
  await fallback.goto(baseUrl);
  await fallback.locator('.studio-illustration').evaluate(image => image.decode());
  await fallback.waitForFunction(() => performance.getEntriesByType('resource').some(entry => entry.name.endsWith('/marketing/studio-clean-plate.png') && entry.responseEnd));
  await fallback.locator('.studio-scene').hover();
  assert.equal(await fallback.locator('.studio-scene').getAttribute('data-rendered'), null);
  assert.equal(await fallback.locator('.studio-illustration').isVisible(), true);
  await fallback.getByRole('button', { name: '观看演示', exact: true }).click();
  assert.equal(await fallback.locator('dialog').isVisible(), true);
  await fallbackContext.close();

  const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const touchPage = await touchContext.newPage();
  const touchRequests = [];
  touchPage.on('request', request => touchRequests.push(request.url()));
  await touchPage.goto(baseUrl);
  await touchPage.locator('.studio-illustration').evaluate(image => image.decode());
  await touchPage.locator('.studio-scene').tap();
  assert.equal(await touchPage.locator('.studio-scene').getAttribute('data-rendered'), null);
  assert.equal(touchRequests.some(url => url.endsWith('/marketing/studio-clean-plate.png')), false, 'Touch devices do not download the extra motion plate');
  for (let i = 0; i < 2; i++) {
    await touchPage.getByRole('button', { name: '播放右侧机械臂动作', exact: true }).tap();
    await touchPage.waitForFunction(() => document.querySelector('.studio-scene').dataset.rendered === 'true');
    await touchPage.waitForFunction(() => !document.querySelector('.studio-scene').hasAttribute('data-moving'));
  }
  assert.equal(touchRequests.some(url => url.endsWith('/marketing/studio-clean-plate.png')), true, 'Explicit touch activation loads motion assets on demand');
  await touchPage.screenshot({ path: `${output}/mobile-touch-390.png` });
  await touchContext.close();

  // Entering before the plate finishes must still respond once it loads, even
  // if the user stops moving the pointer over the gripper.
  const delayed = await browser.newContext({ viewport: { width: 640, height: 900 } });
  let releasePlate;
  const plateGate = new Promise(resolve => { releasePlate = resolve; });
  await delayed.route('**/marketing/studio-clean-plate.png', async route => { await plateGate; await route.continue(); });
  const waiting = await delayed.newPage();
  await waiting.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await waiting.locator('.studio-illustration').evaluate(image => image.decode());
  await waiting.evaluate(() => document.fonts.ready);
  await waiting.getByRole('button', { name: '播放左侧机械臂动作', exact: true }).focus();
  await waiting.keyboard.press('Enter');
  assert.equal(await waiting.locator('.studio-scene').getAttribute('data-rendered'), null);
  releasePlate();
  await waiting.waitForFunction(() => document.querySelector('.studio-scene').dataset.rendered === 'true');
  await delayed.close();
  assert.deepEqual(errors, []);
  console.log(`Studio interaction QA passed at ${baseUrl}: both arms actually move with WebGL disabled, fixed screen contact, stronger/faster gesture, static foreground photos, single gesture, idle stop, exact return, fly-by cancellation, modal suspension, reduced motion, 640/390/320 px mouse interaction, repeated clicks, rapid replay, keyboard activation, touch activation, delayed asset click recovery, Canvas fallback, no page errors. Evidence: ${output}`);
} finally {
  await browser.close();
}
