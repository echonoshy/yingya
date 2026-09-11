import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Use the repository's named tmux service, rather than spawning a duplicate server.
const baseUrl = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.goto(baseUrl);
  await page.locator('#marketing-title').waitFor();
  assert.doesNotMatch(await page.locator('body').innerText(), /hyperframes/i);
  assert.equal(await page.locator('a[href*="hyperframes"]').count(), 0);
  assert.equal(await page.getByRole('link', { name: '进入映芽工作台', exact: true }).getAttribute('href'), '/app');
  assert.equal(await page.title(), '映芽 | 对话式动画视频制作工作台');
  assert.equal(await page.locator('.marketing-example').count(), 6);
  assert.equal(requests.some(url => url.includes('/api/')), false, 'Public homepage must not require authentication or load workspace data');
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  const logo = page.locator('.marketing-header .marketing-brand-toy');
  async function checkLogoPassage() {
    const nav = await page.locator('.marketing-header nav').boundingBox();
    await logo.click();
    assert.equal(await logo.locator('text').count(), 2, 'Wordmark uses one copy of each character');
    // The visible mouth and its mask must stay aligned while text crosses it.
    // There is one copy of each character, so no foreground/background handoff.
    for (const progress of [.24, .3, .71, .82]) {
      const deltas = await logo.evaluate((el, progress) => {
        for (const animation of el.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = Number(animation.effect.getTiming().duration) * progress;
        }
        const opening = el.querySelector('.brand-mouth-opening').getScreenCTM();
        const mask = el.querySelector('.brand-mouth-mask').getScreenCTM();
        return ['a', 'b', 'c', 'd', 'e', 'f'].map(key => Math.abs(opening[key] - mask[key]));
      }, progress);
      assert.ok(deltas.every(delta => delta < .01), 'Text must not jump or double at the lip');
    }
    assert.deepEqual(await page.locator('.marketing-header nav').boundingBox(), nav, 'Logo animation keeps navigation in place');
    await logo.evaluate(el => el.getAnimations({ subtree: true }).forEach(animation => animation.finish()));
    await page.waitForFunction(() => document.querySelector('.marketing-header .marketing-brand-toy').dataset.playing === 'false');
    assert.equal(await logo.evaluate(el => el.getAnimations({ subtree: true }).length), 0);
  }
  await checkLogoPassage();
  await page.waitForFunction(() => document.querySelector('.marketing-main-film video').currentTime > 0.1);
  await page.getByRole('button', { name: '暂停映芽介绍短片', exact: true }).click();
  assert.equal(await page.locator('.marketing-main-film video').evaluate(video => video.paused), true);
  const pausedAt = await page.locator('.marketing-main-film video').evaluate(video => video.currentTime);
  await page.getByRole('button', { name: '播放映芽介绍短片', exact: true }).click();
  await page.waitForFunction(at => document.querySelector('.marketing-main-film video').currentTime !== at, pausedAt);
  const hero = page.locator('.marketing-main-film video');
  const heroMedia = await hero.evaluate(video => ({ src: video.currentSrc, duration: video.duration, muted: video.muted }));
  assert.match(heroMedia.src, /\/marketing\/video\/yingya-intro-v4\.mp4$/);
  assert.ok(Math.abs(heroMedia.duration - 65.833) < .1, 'Homepage uses the complete fourth draft with Sichuan-style narration');
  assert.equal(heroMedia.muted, true, 'Automatic preview is silent');
  const watchIntro = page.getByRole('button', { name: '有声观看映芽介绍短片', exact: true });
  await watchIntro.click();
  await page.getByRole('heading', { name: '66 秒认识映芽', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('dialog video').currentTime > .1);
  const introMedia = await page.locator('dialog video').evaluate(video => ({ src: video.currentSrc, muted: video.muted, volume: video.volume, error: video.error }));
  assert.equal(introMedia.src, heroMedia.src);
  assert.equal(introMedia.muted, false, 'User-initiated full playback includes narration');
  assert.equal(introMedia.volume, 1);
  assert.equal(introMedia.error, null);
  assert.equal(await hero.evaluate(video => video.paused), true, 'Preview pauses while the full film is open');
  await page.locator('dialog video').evaluate(video => { video.pause(); video.currentTime = 30; });
  await page.waitForFunction(() => !document.querySelector('dialog video').seeking && Math.abs(document.querySelector('dialog video').currentTime - 30) < .1);
  await page.keyboard.press('Escape');
  assert.equal(await watchIntro.evaluate(el => el === document.activeElement), true);
  await hero.evaluate(video => { video.currentTime = 5; });
  await page.waitForFunction(() => !document.querySelector('.marketing-main-film video').seeking);
  await page.screenshot({ path: '/tmp/yingya-home-intro-desktop.png' });
  const featuredSources = new Set([heroMedia.src]);
  for (const button of await page.locator('.marketing-side-film').all()) {
    await button.click();
    await page.waitForFunction(() => document.querySelector('dialog video').currentTime > .1);
    assert.doesNotMatch(await page.locator('dialog').innerText(), /hyperframes/i);
    const media = await page.locator('dialog video').evaluate(video => ({ src: video.currentSrc, width: video.videoWidth, height: video.videoHeight }));
    featuredSources.add(media.src);
    if (await button.getAttribute('aria-label') === '播放品牌动效示例') {
      assert.match(media.src, /\/marketing\/video\/warm-grain\.mp4$/);
      assert.equal(media.width, 1920, 'Featured example uses the original brand motion video');
      assert.equal(media.height, 1080);
      assert.equal(await button.locator('img').evaluate(img => img.naturalWidth), 1920, 'Cover is extracted at full resolution');
    }
    await page.keyboard.press('Escape');
    assert.equal(await button.evaluate(el => el === document.activeElement), true);
  }
  await page.getByRole('link', { name: '看看作品', exact: true }).click();
  await page.getByRole('button', { name: '知识动画', exact: true }).click();
  assert.equal(await page.locator('.marketing-example').count(), 2);
  assert.equal(await page.getByRole('button', { name: '知识动画', exact: true }).getAttribute('aria-pressed'), 'true');
  const example = page.getByRole('button', { name: '播放：把复杂知识，讲得简单', exact: true });
  await example.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.waitForFunction(() => document.querySelector('dialog video').readyState >= 2);
  const duration = await dialog.locator('video').evaluate(video => video.duration);
  assert.ok(duration > 0 && Number.isFinite(duration));
  await dialog.locator('video').evaluate(video => { video.pause(); video.currentTime = 3; });
  await page.waitForFunction(() => Math.abs(document.querySelector('dialog video').currentTime - 3) < 0.1);
  await page.getByRole('button', { name: '复制创作需求', exact: true }).click();
  await page.getByRole('button', { name: '已复制需求', exact: true }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /知识点/);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await example.evaluate(el => el === document.activeElement), true, 'Closing a preview returns focus to the invoking example');
  await page.getByRole('button', { name: '全部', exact: true }).click();
  for (const button of await page.locator('.marketing-example').all()) {
    await button.click();
    await page.waitForFunction(() => document.querySelector('dialog video').readyState >= 2);
    assert.doesNotMatch(await page.locator('dialog').innerText(), /hyperframes/i);
    assert.equal(await page.locator('dialog video').evaluate(video => video.error), null);
    assert.equal(featuredSources.has(await page.locator('dialog video').evaluate(video => video.currentSrc)), false, 'Gallery never repeats a featured video');
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: /1 说说你想做什么/ }).click();
  await page.getByText('用这些图片，做一支 12 秒的品牌短片。', { exact: true }).waitFor();
  await page.getByRole('button', { name: /3 导出成片，继续创作/ }).click();
  await page.getByText('这个版本可以了，导出成片。', { exact: true }).waitFor();
  await page.getByText('我需要会剪辑或写代码吗？', { exact: true }).click();
  assert.equal(await page.locator('details').first().getAttribute('open'), '');
  await page.locator('#showcase').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => [...document.querySelectorAll('.marketing-example img')].every(img => img.complete && img.naturalWidth > 0));
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await checkLogoPassage();
    const dimensions = await page.locator('.marketing-page').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    assert.ok(dimensions.scroll <= dimensions.client, `No horizontal overflow at ${width}px`);
    await watchIntro.click();
    await page.waitForFunction(() => document.querySelector('dialog video').readyState >= 2);
    const bounds = await page.getByRole('dialog').boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `Dialog fits ${width}px`);
    await page.keyboard.press('Escape');
    if (width === 390) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: '/tmp/yingya-home-intro-390.png' });
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(baseUrl);
  await page.locator('#marketing-title').waitFor();
  assert.equal(await page.locator('.marketing-main-film video').evaluate(video => video.paused), true);
  assert.equal(await page.locator('.marketing-page').evaluate(el => getComputedStyle(el).scrollBehavior), 'auto');
  await logo.click();
  assert.equal(await logo.locator('[data-brand-mouth]').evaluateAll(elements => elements.every(el => getComputedStyle(el).opacity === '0')), true, 'Reduced motion keeps the mouth hidden');
  // Mock auth only for navigation; never create a real account during UI QA.
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.getByRole('link', { name: '登录', exact: true }).click();
  await page.locator('#login-email').waitFor();
  assert.equal(new URL(page.url()).pathname, '/app');
  await page.getByRole('link', { name: '返回映芽首页', exact: true }).click();
  await page.locator('#marketing-title').waitFor();
  await page.goto(`${baseUrl}/#/projects/11111111-1111-4111-8111-111111111111`);
  await page.locator('#login-email').waitFor();
  assert.equal(await page.locator('#marketing-title').count(), 0, 'Legacy project links route to the workspace login');
  assert.deepEqual(errors, []);
  console.log('Marketing QA passed: public entry, complete draft-4 intro, silent preview and audible playback/seek, logo mouth continuity, all six gallery videos, filters, copy, dialog focus/Escape, workflow, FAQ, 768/390/320px, reduced motion, login/home and legacy project routing.');
  await context.close();
} finally {
  await browser.close();
}
