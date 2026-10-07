import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserPath } from '../runtime/browser.mjs';
import { installApiMock } from './ui-qa.mjs';
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const browser = await chromium.launch({ executablePath: browserPath() });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const activeGestures = () => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target?.matches('.kinetic-letter,.home-title-selection,.paper-delivery-plane,.paper-delivery-receipt'));
try {
  await page.goto(base);
  // Hero effects have their own current regression suite in hero-type-ui.mjs.
  await page.locator('#home-idea').fill('保留这段想法');
  await page.getByRole('button', { name: '用这个功能开始', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.paper-delivery-plane').getAnimations().length > 0);
  assert.ok((await page.locator('#home-idea').inputValue()).startsWith('保留这段想法'));
  await page.waitForFunction(() => document.querySelector('.paper-delivery-plane').getAnimations().length === 0 && document.querySelector('.paper-delivery-receipt').getAnimations().length === 0);
  assert.equal(await page.locator('.paper-delivery-plane').evaluate(el => getComputedStyle(el).opacity), '0');
  for (const width of [320,390,768,1280,1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.inspiration-pick').nth(2).click();
    assert.equal(await page.locator('.inspiration-pick').nth(2).getAttribute('aria-pressed'), 'true');
    assert.ok(await page.locator('#inspiration-demo').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Film content fits at ${width}px`);
  }
  await installApiMock(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/app?playful-qa=1#/`);
  const input = page.locator('#creation-prompt'); await input.waitFor();
  await input.fill('我已有的内容');
  await page.getByRole('button', { name: '添加素材', exact: true }).click();
  await page.getByRole('menuitem', { name: '内置内容', exact: true }).click();
  await page.getByRole('dialog', { name: '选用内置内容', exact: true }).getByRole('button', { name: /^产品介绍/ }).click();
  assert.ok((await input.inputValue()).startsWith('我已有的内容\n'));
  assert.ok(await input.evaluate(el => el === document.activeElement));
  await page.waitForFunction(() => document.querySelector('.paper-delivery-plane').getAnimations().length > 0);
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await page.locator('.home-project-open').first().waitFor();
  await page.keyboard.press('Tab');
  await page.locator('.home-project-open').first().focus();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.home-project-open .home-project-cover'), '::after').transform === 'matrix(1, 0, 0, 1, 0, 0)');
  await page.getByRole('button', { name: '素材工坊', exact: true }).click();
  await page.keyboard.press('Tab');
  await page.locator('.asset-card-open').first().focus();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.asset-card-image'), '::after').transform === 'matrix(1, 0, 0, 1, 0, 0)');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target?.matches('.kinetic-letter,.home-title-selection,.paper-delivery-plane,.paper-delivery-receipt')).length === 0, null, { timeout: 1000 });
  assert.equal((await page.evaluate(activeGestures)).length, 0);
  assert.deepEqual(errors, []);
  console.log(`PASS ${base}: live reduced-motion cancellation, draft-preserving delivery, video examples at five widths, catalog focus feedback, route cleanup, no browser exceptions. Product API fixtures only.`);
} finally { await browser.close(); }
