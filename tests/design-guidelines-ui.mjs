import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock } from './ui-qa.mjs';

// Browser plugin unavailable. Exercise the actual frontend with isolated API fixtures.
// Flow: creation dialog -> recover from failure -> preview on mobile -> account/admin navigation.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = '/tmp/yingya-design-guidelines-qa';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10000);
let failImage = true, failVoices = true, failAdmin = false, previewPayload;
try {
  await installApiMock(page);
  await page.route('**/image-jobs', route => route.request().method() === 'POST' && failImage
    ? route.fulfill({ status: 503, json: { message: '图片服务暂时不可用' } }) : route.fallback());
  await page.route('**/voices', route => failVoices
    ? route.fulfill({ status: 503, json: { message: '音色服务暂时不可用' } }) : route.fallback());
  await page.route('**/voices/preview', route => {
    previewPayload = route.request().postDataJSON();
    // A valid, silent PCM clip verifies the audio control without external generation.
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
    return route.fulfill({ contentType: 'audio/wav', body: wav });
  });
  await page.route('**/api/usage?*', route => route.fulfill({ json: { users: [], models: [] } }));
  await page.route('**/api/quota', route => route.fulfill({ json: { tokenLimit: 100, usedTokens: 0, reservedTokens: 0, remainingTokens: 100, mediaLimit: 0, usedMedia: 0, reservedMedia: 0, remainingMedia: 0, unknownCalls: 0, disabled: false } }));
  await page.route('**/api/admin/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/me')) return route.fulfill({ json: { user: { id: 'qa-admin', email: 'admin@example.test', isAdmin: true } } });
    if (path.endsWith('/accounts')) return route.fulfill({ status: failAdmin ? 503 : 200, json: failAdmin ? { message: '读取用户失败' } : { users: [] } });
    if (path.endsWith('/invites')) return route.fulfill({ json: { invites: [] } });
    if (path.endsWith('/audit')) return route.fulfill({ json: { records: [] } });
    if (path.endsWith('/shares')) return route.fulfill({ json: { shares: [] } });
    return route.fallback();
  });

  await page.goto(base + '/app#/assets');
  const create = page.getByRole('button', { name: '创建素材', exact: true });
  async function open(kind) { await create.click(); await page.getByRole('menuitem', { name: kind, exact: true }).click(); }
  await open('生成图片');
  const image = page.getByRole('dialog', { name: '生成图片', exact: true });
  assert.equal(await image.evaluate(el => el.matches(':modal')), true);
  await image.getByLabel('画面描述').fill('清晨的树林，横幅插画');
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await image.evaluate(el => el.contains(document.activeElement)), true, 'Tab stays in modal');
  }
  await image.getByRole('button', { name: /^制作助手模型/ }).click();
  await page.getByRole('menu').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('menu').waitFor({ state: 'hidden' });
  assert.equal(await image.isVisible(), true, 'Escape closes the model menu before the dialog');
  await image.getByRole('button', { name: '生成图片', exact: true }).click();
  await image.getByRole('alert').waitFor();
  assert.equal(await image.getByLabel('画面描述').inputValue(), '清晨的树林，横幅插画');
  await page.screenshot({ path: `${out}/image-retry.png` });
  await page.keyboard.press('Escape');
  await image.waitFor({ state: 'hidden' });
  assert.equal(await create.evaluate(el => el === document.activeElement), true);
  await open('生成图片');
  assert.equal(await image.getByLabel('画面描述').inputValue(), '清晨的树林，横幅插画');
  failImage = false;
  await image.getByRole('button', { name: '生成图片', exact: true }).click();
  await image.waitFor({ state: 'hidden' });
  await page.getByRole('dialog', { name: '生成记录', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^全部/ }).first().click();

  await open('创建音色');
  const voice = page.getByRole('dialog', { name: '创建音色', exact: true });
  await voice.getByLabel('音色名称').fill('保留的音色草稿');
  await voice.getByRole('button', { name: '重新加载音色' }).waitFor();
  failVoices = false;
  await voice.getByRole('button', { name: '重新加载音色' }).click();
  await voice.getByRole('button', { name: '试听 映芽讲解', exact: true }).waitFor();
  assert.equal(await voice.getByLabel('音色名称').inputValue(), '保留的音色草稿');
  for (const width of [1280, 1440, 1536, 1920, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await voice.getByRole('button', { name: '试听 映芽讲解', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await voice.evaluate(el => el.scrollWidth <= el.clientWidth), true, `Dialog fits ${width}`);
    await page.screenshot({ path: `${out}/voice-${width}.png` });
  }
  await voice.getByLabel('试听文案').fill('验证手机上的音色试听');
  await voice.getByRole('button', { name: '试听 映芽讲解', exact: true }).click();
  await voice.locator('audio').waitFor();
  await page.waitForFunction(() => document.querySelector('.studio-voice-audio')?.readyState >= 2);
  assert.deepEqual(previewPayload, { voiceId: '映芽讲解', text: '验证手机上的音色试听' });
  await voice.getByRole('button', { name: '设为默认', exact: true }).click();
  assert.equal(await voice.locator('article', { hasText: '映芽讲解' }).getByRole('button', { name: '新项目默认' }).isDisabled(), true);
  await page.screenshot({ path: `${out}/voice-mobile-playing.png` });
  await voice.getByRole('button', { name: '克隆音色', exact: true }).focus();
  await page.keyboard.press('Enter');
  await voice.getByLabel('参考音频原文').waitFor();
  assert.equal(await voice.getByRole('button', { name: '克隆音色' }).getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  await voice.waitFor({ state: 'hidden' });
  assert.equal(await create.evaluate(el => el === document.activeElement), true);

  await page.getByLabel('账号：qa@example.com', { exact: true }).click();
  await page.getByRole('button', { name: '使用情况', exact: true }).click();
  await page.getByRole('button', { name: '用量统计', exact: true }).click();
  await page.getByRole('heading', { name: '用量统计' }).waitFor();
  const navigation = page.getByRole('navigation', { name: '映芽功能' }).filter({ visible: true });
  for (const button of await navigation.getByRole('button').all()) {
    const bounds = await button.boundingBox();
    assert.ok(bounds.height >= 44, 'Account navigation remains touchable on mobile');
  }
  await navigation.getByRole('button', { name: '新建视频' }).click();
  await page.locator('.home-create textarea').waitFor();

  await page.goto(base + '/admin/users');
  await page.getByText('还没有用户', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '搜索', exact: true }).fill('找不到的用户');
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: '搜索', exact: true }).inputValue(), '');
  failAdmin = true;
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '重新加载数据' }).waitFor();
  assert.equal(await page.getByText('还没有用户', { exact: true }).count(), 0, 'Failure is not an empty result');
  failAdmin = false;
  await page.getByRole('button', { name: '重新加载数据' }).click();
  await page.getByText('还没有用户', { exact: true }).waitFor();
  await page.getByRole('link', { name: '视频分享', exact: true }).click();
  await page.getByLabel('搜索当前页分享').fill('不存在的分享');
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  assert.equal(await page.getByLabel('搜索当前页分享').inputValue(), '');
  await page.getByRole('region', { name: '视频分享列表，可横向滚动' }).focus();
  assert.equal(await page.getByRole('region', { name: '视频分享列表，可横向滚动' }).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS design guidelines: modal keyboard containment/restoration and nested Escape, image retry/draft, mobile voice preview/default/retry, six widths, account navigation, admin empty/error recovery and table keyboard access. API fixtures only.');
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png` });
  throw error;
} finally { await browser.close(); }
