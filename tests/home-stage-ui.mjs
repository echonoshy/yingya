import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { browserPath } from '../runtime/browser.mjs';
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const browser = await chromium.launch({ executablePath: browserPath() });
const page = await browser.newPage({ viewport: { width: 1448, height: 1086 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  async function checkScrollBoundary() {
    await page.waitForFunction(() => Math.abs(document.querySelector('.marketing-page').clientHeight - window.innerHeight) <= 1);
    const state = await page.evaluate(() => {
      window.scrollTo({ top: 400, behavior: 'instant' });
      const scroll = document.querySelector('.marketing-page');
      const documentScroll = document.scrollingElement;
      return {
        outerScroll: window.scrollY,
        documentHeight: documentScroll.scrollHeight,
        viewportHeight: documentScroll.clientHeight,
        top: scroll.getBoundingClientRect().top,
        height: scroll.clientHeight,
        viewport: window.innerHeight,
      };
    });
    assert.equal(state.outerScroll, 0, 'Hidden accessible text must not create a second page scroll');
    assert.ok(state.documentHeight <= state.viewportHeight + 1, 'No blank document extends below the homepage');
    assert.equal(state.top, 0, 'The homepage stays aligned with the viewport');
    assert.ok(Math.abs(state.height - state.viewport) <= 1, 'The scroll container fills the current viewport');
  }
  await checkScrollBoundary();
  assert.equal((await page.locator('#marketing-title').evaluate(el => { const copy = el.cloneNode(true); copy.querySelectorAll('.sr-only,.playful-word-hint').forEach(node => node.remove()); return copy.textContent; })).replace(/\s/g, ''), '让想法，有画面。');
  assert.match(await page.locator('.home-subtitle').innerText(), /带上参考、剧本与风格/);
  assert.equal(await page.locator('.hero-companion,.character-glyph').count(), 0, 'Homepage has no character or emoji companion');
  await page.getByRole('link', { name: '能做什么', exact: true }).click();
  await page.locator('#inspiration-demo video').waitFor();
  assert.equal(await page.locator('.process-stage').count(), 0, 'Examples replace the repeated workflow');
  assert.equal(await page.locator('.inspiration-pick').count(), 4);
  await page.locator('.marketing-page').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
  assert.equal(await page.locator('.home-brand-mark .yingya-wordmark').innerText(), 'YingYa');
  assert.equal(await page.locator('.home-footer .yingya-wordmark').innerText(), 'YingYa');
  assert.equal(await page.getByRole('link', { name: /宣传片/ }).count(), 0);
  await page.getByRole('link', { name: '风格参考', exact: true }).click();
  assert.ok(await page.locator('#references-title').evaluate(el => document.activeElement === el));
  await page.locator('.marketing-page').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '参考视频', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const line = document.querySelector('.home-source-underline').getBoundingClientRect();
    const active = document.querySelector('.home-sources button[aria-pressed="true"]').getBoundingClientRect();
    return Math.abs(line.x - active.x) < .1 && Math.abs(line.width - active.width) < .1;
  });
  assert.equal(await page.getByRole('button', { name: '参考视频', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '剧本', exact: true }).click();
  assert.equal(await page.locator('.idea-keys,.hero-code,.motion-reel-heading,.film-loading-note').count(), 0, 'Merged hero removes decorative keys and duplicate film copy');
  assert.equal(await page.locator('.home-hero .home-motion-reel').count(), 1, 'Film shares the creation hero');
  await page.locator('#home-idea').fill('');
  await page.getByRole('button', { name: '剧本', exact: true }).focus();
  await page.waitForFunction(() => document.querySelector('.home-typewriter > span')?.textContent === '故事大纲：\n人物、场景与结尾：');
  await page.locator('#home-idea').fill('请介绍这份资料');
  assert.equal(await page.locator('.home-hero').getAttribute('data-has-idea'), 'true');
  await page.getByRole('button', { name: '参考视频', exact: true }).click();
  assert.equal(await page.locator('#home-idea').inputValue(), '请介绍这份资料');
  const idea = page.getByRole('button', { name: /^04 自动剪辑/ });
  await idea.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#home-idea').inputValue(), '请介绍这份资料', 'Previewing a direction does not edit the draft');
  await page.getByRole('button', { name: '用这个功能开始', exact: true }).click();
  const enriched = await page.locator('#home-idea').inputValue();
  assert.ok(enriched.startsWith('请介绍这份资料 '), 'Visual inspiration preserves the original draft');
  assert.match(enriched, /保留完整语义/);
  assert.equal(await page.locator('#home-idea').evaluate(el => el === document.activeElement), true);
  assert.equal(new URL(page.url()).pathname, '/', 'Choosing inspiration never submits a task');
  await idea.click();
  await page.getByRole('button', { name: '用这个功能开始', exact: true }).click();
  assert.equal(await page.locator('#home-idea').inputValue(), enriched, 'Repeated selection does not duplicate text');
  await page.locator('#home-idea').fill('稿'.repeat(6000));
  await page.getByRole('button', { name: /^02 自动配音和字幕/ }).click();
  await page.getByRole('button', { name: '用这个功能开始', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '原有内容已保留' }).waitFor();
  assert.equal((await page.locator('#home-idea').inputValue()).length, 6000, 'A full draft is never silently truncated');
  await page.locator('#home-idea').fill('请介绍这份资料');
  for (const title of ['关于我们', '帮助文档', '联系我们']) {
    const trigger = page.getByRole('button', { name: title, exact: true });
    await trigger.click();
    assert.equal(await page.getByRole('dialog').isVisible(), true);
    await page.waitForFunction(() => document.querySelector('.home-info-dialog').getAnimations().every(animation => animation.playState === 'finished'));
    const exitFrame = await page.getByRole('dialog').evaluate(dialog => {
      const scroll = document.querySelector('.marketing-page').scrollTop;
      dialog.querySelector('header button').click();
      const exit = dialog.getAnimations().find(animation => !(animation instanceof CSSAnimation) && animation.effect?.target === dialog);
      exit.finish();
      return { opacity: Number(getComputedStyle(dialog).opacity), scroll };
    });
    assert.equal(exitFrame.opacity, 0, 'Exit stays transparent until React removes the dialog, without a flash');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Close button restores focus');
    assert.equal(await page.locator('.marketing-page').evaluate(el => el.scrollTop), exitFrame.scroll, 'Focus restore does not scroll the page');
    await trigger.click();
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await trigger.click();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, 'Modal restores focus');
    await checkScrollBoundary();
  }
  await page.locator('#home-idea').fill('');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const [width, height] of [[1280,720],[1448,1086],[1536,1024],[1920,1080],[390,844],[320,568]]) {
    await page.setViewportSize({ width, height });
    await page.locator('.marketing-page').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
    await checkScrollBoundary();
    assert.equal(await page.locator('.marketing-page').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    const stage = await page.locator('#inspiration-demo').boundingBox();
    assert.ok(stage.width > 0 && stage.width <= width);
    const cta = await page.getByRole('button', { name: '准备创作', exact: true }).boundingBox();
    assert.ok(cta.y + cta.height <= height, `Primary action visible without scroll at ${width} × ${height}`);
    await page.waitForFunction(() => {
      const line = document.querySelector('.home-source-underline').getBoundingClientRect();
      const active = document.querySelector('.home-sources button[aria-pressed="true"]').getBoundingClientRect();
      return Math.abs(line.x - active.x) < .1 && Math.abs(line.width - active.width) < .1;
    });
    await page.screenshot({ path: `/tmp/yingya-home-stage-${width}.png` });
  }
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(await page.locator('.marketing-page').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(245, 245, 243)', 'The approved light brand canvas is consistent in dark system mode');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1448, height: 1086 });
  await page.locator('#home-idea').fill('把我的资料做成一分钟讲解');
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: {} }));
  await page.getByRole('button', { name: '准备创作', exact: true }).click();
  await page.locator('#login-email').waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('yingya-marketing-draft-v1')), '把我的资料做成一分钟讲解');
  assert.deepEqual(errors, []);
  const reduced = await browser.newPage({ reducedMotion: 'reduce' });
  const movies = [];
  reduced.on('request', r => { if (r.resourceType() === 'media') movies.push(r.url()); });
  await reduced.goto(base);
  await reduced.locator('#inspiration-demo').scrollIntoViewIfNeeded();
  assert.equal(await reduced.locator('#inspiration-demo video').getAttribute('src'), null, 'Reduced motion retains the poster without loading the movie');
  assert.equal(await reduced.locator('.home-brand-mark .yingya-wordmark').innerText(), 'YingYa');
  await reduced.getByRole('button', { name: '复刻网站', exact: true }).click();
  assert.equal(await reduced.locator('.home-source-underline').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
  assert.equal(await reduced.locator('.home-caret').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.deepEqual(movies, []);
  assert.equal(await reduced.locator('.character-glyph').count(), 0);
  await reduced.close();
  const touch = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await touch.goto(base);
  await touch.getByRole('button', { name: '复刻网站', exact: true }).tap();
  assert.equal(await touch.getByRole('button', { name: '复刻网站', exact: true }).getAttribute('aria-pressed'), 'true');
  await touch.locator('#home-idea').fill('在手机上写一个故事');
  assert.equal(await touch.locator('#home-idea').inputValue(), '在手机上写一个故事');
  await touch.close();
  console.log(`PASS ${base}: viewport scroll containment/no bottom blank space, English wordmark/reference navigation, sources/keyboard/resize, code accents, touch, draft safety, footer modals/Escape/focus, six widths and reduced motion, unauthenticated draft handoff (auth mocked), no console errors`);
} finally { await browser.close(); }
