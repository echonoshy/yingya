import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock } from './ui-qa.mjs';
// Browser plugin not available. Sample the real rendered animations with isolated API fixtures.
// Flow: open a floating panel -> close / interrupt / reopen -> no opaque frame before removal.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = `/tmp/yingya-popover-flicker/${base.startsWith('https') ? 'public' : 'local'}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1293, height: 1151 }, reducedMotion: 'no-preference' });
const errors = [], evidence = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.setDefaultTimeout(10000);
const task = () => page.getByRole('button', { name: '任务中心', exact: true });
async function settled(selector) {
  await page.locator(selector).waitFor();
  await page.locator(selector).evaluate(async el => { await Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))); });
}
async function closeFrames(selector, action, label) {
  await page.evaluate(selector => {
    window.__motionDone = new Promise(resolve => {
      const frames = []; let missing = 0; const start = performance.now();
      const sample = () => {
        const el = document.querySelector(selector), style = el && getComputedStyle(el), box = el?.getBoundingClientRect();
        frames.push({ time: performance.now() - start, mounted: !!el, exiting: Boolean(el?.inert), opacity: style ? Number(style.opacity) : 0, x: box?.x, y: box?.y });
        missing = el ? 0 : missing + 1;
        if (missing >= 2 || performance.now() - start > 650) resolve(frames); else requestAnimationFrame(sample);
      }; requestAnimationFrame(sample);
    });
  }, selector);
  await action();
  const frames = await page.evaluate(() => window.__motionDone);
  const exiting = frames.filter(frame => frame.mounted && frame.exiting);
  for (let n = 1; n < exiting.length; n++) assert.ok(exiting[n].opacity <= exiting[n-1].opacity + .005, `${label}: closing opacity rebounded: ${JSON.stringify(exiting)}`);
  assert.equal(await page.locator(selector).count(), 0, `${label}: panel removed`);
  evidence.push({ label, frames });
}
async function finishBoundary(trigger, selector) {
  await trigger.click(); await settled(selector);
  await trigger.click();
  await page.waitForFunction(selector => document.querySelector(selector)?.inert, selector);
  const result = await page.locator(selector).evaluate(el => {
    const animations = el.getAnimations();
    animations.forEach(animation => animation.finish());
    return { count: animations.length, opacity: Number(getComputedStyle(el).opacity), transform: getComputedStyle(el).transform };
  });
  assert.ok(result.count >= 2, `${selector}: tested real exit animations`);
  assert.equal(result.opacity, 0, `${selector}: holds transparent last frame before React unmount`);
  assert.notEqual(result.transform, 'none', `${selector}: holds final position`);
  await page.locator(selector).waitFor({ state: 'detached' });
  evidence.push({ selector, boundary: result });
}
try {
  await installApiMock(page);
  await page.goto(base + '/app#/');
  assert.match(page.url(), /\/app#\/$/); assert.match(await page.title(), /映芽|YingYa|Yingya/i);
  await page.locator('#creation-prompt').waitFor();
  for (const width of [1920,1536,1440,1280,390,320]) {
    await page.setViewportSize({ width, height: 1151 });
    const triggerBox = await task().boundingBox();
    assert.equal(await task().innerText(), '', 'Task access stays icon-only');
    assert.equal(await task().getAttribute('title'), '任务中心');
    assert.ok(triggerBox.width >= 44 && triggerBox.height >= 44 && width - triggerBox.x - triggerBox.width <= 24, 'Bell stays touchable in the top-right corner');
    await task().click(); await settled('.task-center-panel');
    const box = await page.locator('.task-center-panel').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0);
    await page.screenshot({ path: `${out}/task-open-${width}.png` });
    await closeFrames('.task-center-panel', () => page.getByRole('button', { name: '关闭任务中心' }).click(), `close button ${width}`);
    assert.ok(await task().evaluate(el => el === document.activeElement));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 1293, height: 1151 });
  for (const [label, close] of [['Escape', () => page.keyboard.press('Escape')], ['outside', () => page.locator('h1').click()], ['trigger', () => task().click()]]) {
    await task().click(); await settled('.task-center-panel'); await closeFrames('.task-center-panel', close, label);
  }
  for (const [trigger, selector] of [[task(), '.task-center-panel'], [page.getByRole('button', { name: '添加素材', exact: true }), '.composer-more-menu'], [page.getByRole('button', { name: '首页视频画幅' }), '.aspect-menu'], [page.locator('.home-create .model-trigger'), '.model-menu']]) {
    await finishBoundary(trigger, selector);
    for (let n = 0; n < 3; n++) {
      await trigger.evaluate(el => el.click());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await trigger.evaluate(el => el.click());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await trigger.evaluate(el => el.click());
      await settled(selector);
      assert.equal(await page.locator(selector).evaluate(el => Number(getComputedStyle(el).opacity)), 1);
      assert.equal(await page.locator(selector).evaluate(el => el.inert), false);
      await closeFrames(selector, () => page.keyboard.press('Escape'), `${selector} rapid reopen ${n}`);
    }
  }
  await page.goto(base + '/app#/projects');
  await finishBoundary(page.locator('.home-project-menu-button').first(), '.home-project-menu');
  await page.goto(base + '/app#/');
  // Native dialogs already hold the exit frame; check their boundary and focus too.
  await page.getByRole('button', { name: '添加素材', exact: true }).click();
  await page.getByRole('menuitem', { name: '素材库', exact: true }).click();
  await page.locator('.cap-modal').waitFor();await page.keyboard.press('Escape');await page.locator('.cap-modal').waitFor({state:'detached'});
  await page.getByRole('button', { name: '添加素材', exact: true }).click();
  await page.getByRole('menuitem', { name: '内置内容', exact: true }).click();
  await settled('.action-dialog');
  await closeFrames('.action-dialog', () => page.keyboard.press('Escape'), 'builtin content dialog');
  // Native popovers use immediate dismissal: no retained flash or stale open state.
  await page.getByRole('button', { name: /参考时长：/ }).click();
  await page.getByRole('dialog', { name: '参考时长', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.duration-panel').evaluate(el => el.matches(':popover-open')), false);
  await page.goto(base + '/app#/assets');
  await page.getByRole('combobox', { name: '素材排序' }).click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.select-control-menu:popover-open').count(), 0);
  await page.goto(base + '/app#/');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await task().click(); await page.locator('.task-center-panel').waitFor();
  assert.equal(await page.locator('.task-center-panel').evaluate(el => el.getAnimations().length), 0);
  await page.getByRole('button', { name: '关闭任务中心' }).click();
  await page.locator('.task-center-panel').waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await task().click(); await page.locator('.task-center-panel').waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Escape');await page.locator('.task-center-panel').waitFor({ state: 'detached' });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route(url => /^\/api(?:\/u\/[^/]+)?\/agent-projects$/.test(url.pathname), route => route.request().method() === 'GET' ? route.fulfill({json: []}) : route.fallback());
  await page.reload();await page.setViewportSize({width:1293,height:1151});
  await task().click();await settled('.task-center-panel');await page.getByText('当前没有待处理任务',{exact:true}).waitFor();
  await page.screenshot({path:`${out}/task-empty.png`});
  await closeFrames('.task-center-panel', () => page.getByRole('button',{name:'关闭任务中心'}).click(), 'empty task center');
  await page.screenshot({ path: `${out}/task-closed.png` });
  assert.equal(await page.locator('vite-error-overlay').count(), 0); assert.deepEqual(errors, []);
  await writeFile(`${out}/motion-evidence.json`, JSON.stringify(evidence, null, 2));
  console.log('PASS: monotonic close frames, transparent finish boundary, X/Escape/outside/trigger, rapid reopen, focus, six widths, reduced-motion preference changes; task/material/aspect/model/project menus, asset modal, duration/select/create popovers. Real frontend with isolated API fixtures. Browser plugin not available; Playwright Chromium.');
} catch (error) { await page.screenshot({ path: `${out}/failure.png` }); throw error; }
finally { await browser.close(); }
