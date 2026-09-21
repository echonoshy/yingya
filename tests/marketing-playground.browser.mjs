import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
// Browser plugin not available. Flow: homepage -> tug/click/keyboard/touch ->
// connected film responds, rigid characters retain their proportions and settle.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = process.env.YINGYA_PLAYGROUND_QA_OUT ?? '/tmp/yingya-tug-qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
async function rigid(page) {
  const valid = await page.locator('.hero-depth-actor, .hero-actor-motion, .hero-toss-body, .hero-toss-key, .hero-toss-arm').evaluateAll(elements => elements.every(element => {
    const m = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return Math.abs(Math.hypot(m.a, m.b) - 1) < .00001 && Math.abs(Math.hypot(m.c, m.d) - 1) < .00001 && Math.abs(m.a * m.c + m.b * m.d) < .00001;
  }));
  assert.ok(valid, 'Characters preserve lengths and angles throughout interaction (no stretch or shear)');
}
const idle = page => page.waitForFunction(() => document.querySelector('.hero-connected-scene')?.dataset.playing === 'idle');
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'no-preference', hasTouch: width < 800, isMobile: width < 800 });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    assert.match(await page.title(), /映芽/);
    assert.equal(await page.locator('#marketing-title').innerText(), '对话式视频制作');
    assert.equal(await page.locator('vite-error-overlay').count(), 0);
    const scene = page.locator('.hero-connected-scene');
    await page.waitForFunction(() => document.querySelector('.hero-connected-scene')?.dataset.engine === 'gsap-rigid');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await scene.locator('.hero-ribbon-texture').isVisible(), false);
    assert.equal(await scene.locator('.hero-scene-fallback').isVisible(), false);
    const before = await scene.boundingBox();
    const ribbon = scene.locator('canvas');
    const imageBefore = await ribbon.evaluate(element => element.toDataURL());
    const depthTransform = selector => scene.locator(selector).evaluate(element => {
      const m = new DOMMatrixReadOnly(getComputedStyle(element).transform); return [m.e, m.f];
    });
    const depthFront = '.hero-depth-props--front', depthRear = '.hero-depth-props--rear';
    if (width === 1440) {
      const hitAreas = () => scene.locator('.hero-scene-character').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().toJSON()));
      const originalHitAreas = await hitAreas();
      await page.mouse.move(before.x + before.width * .88, before.y + before.height * .25);
      await page.waitForTimeout(600);
      const front = await depthTransform(depthFront), rear = await depthTransform(depthRear);
      assert.ok(front[0] > 15 && rear[0] < -3, 'Foreground and background respond at different depths');
      assert.ok(front[1] < 0 && rear[1] > 0, 'Depth responds vertically as well');
      assert.deepEqual(await hitAreas(), originalHitAreas, 'Click and keyboard focus targets stay fixed while artwork moves');
      assert.notEqual(await ribbon.evaluate(element => element.toDataURL()), imageBefore, 'Film follows displaced hands');
      await rigid(page);
      await page.screenshot({ path: `${out}/depth-right.png` });
      const box = await scene.locator('.hero-ribbon-handle').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(600); await page.mouse.down();
      const held = await depthTransform(depthFront);
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 - 20);
      await page.waitForTimeout(200);
      assert.deepEqual(await depthTransform(depthFront), held, 'Camera stays fixed during direct manipulation');
      await page.mouse.up(); await idle(page);
      await page.mouse.move(before.x + before.width * .12, before.y + before.height * .75);
      await page.waitForTimeout(600);
      assert.ok((await depthTransform(depthFront))[0] < -15);
      await page.screenshot({ path: `${out}/depth-left.png` });
      await page.mouse.move(2, 2); await page.waitForTimeout(600);
      assert.deepEqual(await depthTransform(depthFront), [0, 0]);
      assert.deepEqual(await depthTransform(depthRear), [0, 0]);
      assert.equal(await ribbon.evaluate(element => element.toDataURL()), imageBefore);
    } else {
      await scene.locator('[data-character="play"]').tap();
      await page.waitForTimeout(200);
      assert.deepEqual(await depthTransform(depthFront), [0, 0], 'Touch gestures do not move the camera');
      await idle(page);
    }
    for (const id of ['play', 'film', 'tumble']) {
      const button = page.locator(`[data-character="${id}"]`);
      await button.focus(); await page.keyboard.press('Enter');
      assert.equal(await scene.getAttribute('data-playing'), id);
      await page.waitForTimeout(400); await rigid(page);
      if (width === 1440) await page.screenshot({ path: `${out}/${id}-motion.png` });
      await idle(page);
    }
    assert.equal(await page.locator('.hero-play-hint, .hero-hint-pointer, .hero-hint-touch').count(), 0, 'No visible instruction caption');
    const left = scene.locator('.hero-toss-body');
    const key = scene.locator('.hero-toss-key');
    const keyRest = await key.evaluate(element => getComputedStyle(element).transform);
    // Observe the whole arc instead of assuming a screenshot takes no time.
    await page.evaluate(() => {
      const scene = document.querySelector('.hero-connected-scene');
      const key = scene.querySelector('.hero-toss-key');
      window.__tossCapture = { minY: 0, phases: [], done: false };
      scene.addEventListener('click', () => {
        const sample = () => {
          const trace = window.__tossCapture;
          const phase = scene.dataset.leftPhase;
          trace.minY = Math.min(trace.minY, new DOMMatrixReadOnly(getComputedStyle(key).transform).f);
          if (!trace.phases.includes(phase)) trace.phases.push(phase);
          if (phase === 'idle' && trace.phases.includes('airborne')) trace.done = true;
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, { once: true });
    });
    await scene.locator('[data-character="play"]').click();
    await page.waitForFunction(() => document.querySelector('.hero-connected-scene').dataset.leftPhase === 'airborne');
    await rigid(page);
    await page.screenshot({ path: `${out}/toss-apex-${width}.png` });
    await page.waitForFunction(() => window.__tossCapture.done);
    const trace = await page.evaluate(() => window.__tossCapture);
    assert.ok(trace.minY < -150 * before.width / 1200, `Play key rises independently at ${width}px: ${trace.minY}`);
    assert.ok(trace.phases.includes('catch'), 'Throw passes through the catch phase');
    await page.mouse.move(2, 2);
    await idle(page);
    assert.equal(await key.evaluate(element => getComputedStyle(element).transform), keyRest, 'Caught key returns exactly to its original grip');
    const rest = await left.evaluate(element => getComputedStyle(element).transform);
    await scene.locator('[data-character="play"]').hover(); await page.waitForTimeout(400);
    await scene.locator('[data-character="tumble"]').hover(); await page.waitForTimeout(400);
    assert.equal(await left.evaluate(element => getComputedStyle(element).transform), rest, 'Cursor following cannot rotate the left character');
    // Use real pointer clicks to exercise fast, overlapping gestures.
    const clickActor = async id => {
      const box = await scene.locator(`[data-character="${id}"]`).boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };
    await clickActor('tumble');
    await clickActor('play');
    assert.equal(await scene.getAttribute('data-left-playing'), 'play');
    assert.equal(await scene.getAttribute('data-playing'), 'tumble', 'Left action does not cancel the film action');
    await page.waitForTimeout(350);
    assert.notEqual(await left.evaluate(element => getComputedStyle(element).transform), rest);
    await clickActor('play');
    await clickActor('film');
    assert.equal(await scene.getAttribute('data-left-playing'), 'play', 'Film action does not cancel left action');
    await page.waitForTimeout(900);
    assert.equal(await scene.getAttribute('data-left-playing'), 'idle', 'Repeated click did not restart the left animation');
    assert.equal(await left.evaluate(element => getComputedStyle(element).transform), rest, 'Left returns exactly to rest');
    await idle(page);
    const handle = scene.locator('.hero-ribbon-handle');
    await handle.focus(); await page.keyboard.down('ArrowRight'); await page.waitForTimeout(180);
    assert.equal(await scene.getAttribute('data-playing'), 'dragging'); await rigid(page);
    assert.notEqual(await ribbon.evaluate(element => element.toDataURL()), imageBefore, 'Independent ribbon changes');
    await page.keyboard.up('ArrowRight'); await idle(page);
    if (width === 1440) {
      const box = await handle.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 - 35, { steps: 12 });
      await page.waitForTimeout(180); assert.equal(await scene.getAttribute('data-playing'), 'dragging'); await rigid(page);
      await page.screenshot({ path: `${out}/drag.png` });
      // Release outside the hit target. Pointer capture must release and settle.
      await page.mouse.move(before.x + before.width + 20, before.y + 20); await page.mouse.up(); await idle(page);
      await page.mouse.move(2, 2); await page.waitForTimeout(600);
      assert.ok(await ribbon.evaluate(element => element.toDataURL()) === imageBefore, 'Returns to identical resting ribbon');
    } else {
      await scene.locator('[data-character="film"]').tap();
      assert.equal(await scene.getAttribute('data-playing'), 'film'); await idle(page);
      assert.equal(await page.locator('.hero-play-hint').count(), 0);
      // Real touch vertical swipe across the ribbon must continue page scrolling.
      const box = await handle.boundingBox(); const cdp = await page.context().newCDPSession(page);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 6; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 18 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(350);
      assert.ok(await page.locator('.marketing-page').evaluate(element => element.scrollTop > 0), 'Touch can scroll over the interaction');
      await page.locator('.marketing-page').evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' }));
      await cdp.detach(); await idle(page);
    }
    assert.deepEqual(await scene.boundingBox(), before, 'No layout shifts');
    assert.ok(await page.locator('.marketing-page').evaluate(element => element.scrollWidth <= element.clientWidth));
    await page.mouse.move(2, 2); await page.waitForTimeout(450);
    await page.screenshot({ path: `${out}/tug-${width}.png` });
    await scene.locator('[data-character="film"]').click(); await scene.locator('[data-character="play"]').click(); await page.emulateMedia({ reducedMotion: 'reduce' }); await idle(page);
    assert.equal(await scene.getAttribute('data-left-playing'), 'idle');
    assert.equal(await scene.getAttribute('data-left-phase'), 'idle');
    assert.equal(await key.evaluate(element => getComputedStyle(element).transform), keyRest);
    assert.deepEqual(await depthTransform(depthFront), [0, 0], 'Reduced motion resets all depth layers');
    assert.deepEqual(await depthTransform(depthRear), [0, 0]);
    const reduced = await ribbon.evaluate(element => element.toDataURL());
    await scene.locator('[data-character="tumble"]').click(); await page.waitForTimeout(400);
    assert.equal(await scene.getAttribute('data-playing'), 'idle');
    assert.equal(await ribbon.evaluate(element => element.toDataURL()), reduced);
    await rigid(page);
    await page.getByRole('button', { name: '观看演示', exact: true }).click(); await page.locator('dialog[open]').waitFor(); await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: '观看演示', exact: true }).evaluate(element => document.activeElement === element), true);
    await page.close();
  }
  // A canvas failure keeps the original complete still image, rather than fragments.
  const fallback = await browser.newPage();
  await fallback.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await fallback.goto(base); await fallback.waitForFunction(() => document.querySelector('.hero-connected-scene')?.dataset.engine === 'static');
  assert.equal(await fallback.locator('.hero-scene-fallback').isVisible(), true);
  await fallback.close(); assert.deepEqual(errors, []);
  console.log('PASS layered depth, fixed drag camera, touch/reduced-motion depth reset, independent startled toss and catch, separated prop arc, exact catch alignment, no cursor conflict, no caption, rigid actors, real ribbon drag, interruptible clicks, keyboard, touch tap/scroll, release outside, exact rest, reduced motion, canvas fallback, desktop/390/320, demo CTA and no page errors');
} finally { await browser.close(); }
