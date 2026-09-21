// Real avatar APIs and account database; unrelated video APIs use controlled fixtures.
// Browser plugin not available: use the repository's Playwright installation.
import assert from 'node:assert/strict';
import { chromium, request } from 'playwright';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installApiMock } from './ui-qa.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const port = 8823, base = `http://127.0.0.1:${port}`, session = 'yingya-avatar-qa';
const out = '/tmp/yingya-avatar-qa'; mkdirSync(out, { recursive: true });
assert.notEqual(spawnSync('tmux', ['has-session', '-t', `=${session}`], { stdio: 'ignore' }).status, 0, 'QA session already exists');
assert.equal(await fetch(base + '/health').catch(() => null), null, 'QA port must be free');
const root = mkdtempSync('/tmp/yingya-avatar-data-');
const env = { ...process.env, YINGYA_RESOURCE_DIR: repo, YINGYA_APP_DATA_DIR: root, YINGYA_RUNTIME_DIR: root + '/runtime', YINGYA_ENV_FILE: root + '/empty.env', YINGYA_MODE: 'gateway', YINGYA_ADDR: `127.0.0.1:${port}`, YINGYA_SECURE_COOKIES: 'false', YINGYA_ADMIN_EMAILS: 'avatar@example.test' };
const binary = `${repo}/target/debug/yingya-server`;
const owner = JSON.parse(execFileSync(binary, ['admin-create', 'avatar', 'avatar@example.test'], { cwd: repo, env, encoding: 'utf8' }));
execFileSync('tmux', ['new-session', '-d', '-s', session, '-c', repo, ...Object.entries(env).filter(([key]) => !['TMUX', 'TMUX_PANE'].includes(key)).flatMap(([key, value]) => ['-e', `${key}=${value}`]), binary]);
let browser;
const errors = [], assertions = [];
async function json(response) { assert.ok(response.ok(), `${response.status()}: ${await response.text()}`); return response.json(); }
try {
  for (let attempt = 0; attempt < 100; attempt++) { if ((await fetch(base + '/health').catch(() => null))?.ok) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await json(await context.request.post(base + '/api/auth/login', { data: { email: owner.email, password: owner.password }, headers: { Origin: base } }));
  const initial = await json(await context.request.get(base + '/api/auth/avatar'));
  assert.match(initial.url, /^\/avatars\/(cat|bunny|fox|panda)-v1.webp$/);
  assert.deepEqual(await json(await context.request.get(base + '/api/auth/avatar')), initial);
  const anonymous = await request.newContext();
  assert.equal((await anonymous.get(base + '/api/auth/avatar')).status(), 401);
  assert.equal((await anonymous.get(base + '/api/auth/avatar/image')).status(), 401);
  await anonymous.dispose();
  assert.equal((await context.request.patch(base + '/api/auth/avatar', { data: { presetId: 'fox' }, headers: { Origin: 'https://elsewhere.test' } })).status(), 403);
  assert.equal((await context.request.patch(base + '/api/auth/avatar', { data: { presetId: '../../secret' }, headers: { Origin: base } })).status(), 400);
  // Registration itself assigns the avatar, and a second session reads the same choice.
  const invite = await json(await context.request.post(base + '/api/admin/invites', { data: { email: 'new-avatar@example.test', expiresInDays: 7, maxUses: 1, tokenLimit: 1000, mediaLimit: 1 }, headers: { Origin: base } }));
  const member = await request.newContext();
  await json(await member.post(base + '/api/auth/register', { data: { email: 'new-avatar@example.test', password: 'avatar-test-password', invite_code: invite.code }, headers: { Origin: base } }));
  const memberAvatar = await json(await member.get(base + '/api/auth/avatar'));
  assert.match(memberAvatar.url, /^\/avatars\/(cat|bunny|fox|panda)-v1.webp$/);
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await installApiMock(page);
  await page.route(url => url.pathname.startsWith('/api/auth/avatar') || url.pathname === '/api/auth/me', route => route.continue());
  await page.goto(base + '/app#/');
  const trigger = page.locator('.account-panel > summary:visible');
  await trigger.locator('img').waitFor();
  assert.equal(await page.locator('.account-settings').count(), 0);
  await trigger.focus(); await page.keyboard.press('Enter');
  assert.ok(await trigger.locator('.account-avatar').evaluate(el => el.getAnimations().length > 0), 'keyboard click animates avatar');
  await page.getByRole('button', { name: '更换头像', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '更换头像', exact: true });
  await dialog.waitFor();
  const next = initial.presetId === 'fox' ? '软软兔兔' : '小狐狸';
  await dialog.getByRole('button', { name: next, exact: true }).click();
  await dialog.getByRole('button', { name: '保存头像', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  const selected = await json(await context.request.get(base + '/api/auth/avatar'));
  assert.notEqual(selected.presetId, initial.presetId);
  assert.equal(await trigger.locator('img').getAttribute('src'), selected.url);
  await page.reload(); await trigger.locator('img').waitFor();
  assert.equal(await trigger.locator('img').getAttribute('src'), selected.url);
  await trigger.click(); await page.getByRole('button', { name: '更换头像', exact: true }).click();
  await dialog.getByRole('button', { name: '随机挑一个', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.deepEqual(await json(await context.request.get(base + '/api/auth/avatar')), selected, 'cancel does not persist');
  await trigger.click(); await page.getByRole('button', { name: '更换头像', exact: true }).click();
  await dialog.getByLabel('头像图片', { exact: true }).setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await dialog.getByRole('alert').filter({ hasText: '请选择 PNG' }).waitFor();
  await dialog.getByLabel('头像图片', { exact: true }).setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await dialog.getByRole('alert').filter({ hasText: '不能超过 5 MB' }).waitFor();
  await dialog.getByLabel('头像图片', { exact: true }).setInputFiles('web/public/avatars/panda-v1.webp');
  await dialog.getByText('自己的头像', { exact: true }).waitFor();
  // A failed upload preserves the draft and the original account avatar, then retries.
  let failUpload = true;
  await page.route(url => url.pathname === '/api/auth/avatar/image', route => route.request().method() === 'PUT' && failUpload ? route.fulfill({ status: 503, json: { message: '暂时无法保存，请重试' } }) : route.continue());
  await dialog.getByRole('button', { name: '保存头像', exact: true }).click();
  await dialog.getByRole('alert').filter({ hasText: '暂时无法保存' }).waitFor();
  assert.deepEqual(await json(await context.request.get(base + '/api/auth/avatar')), selected);
  failUpload = false;
  await dialog.getByRole('button', { name: '保存头像', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const uploaded = await json(await context.request.get(base + '/api/auth/avatar'));
  assert.equal(uploaded.presetId, null);
  assert.match(uploaded.url, /^\/api\/auth\/avatar\/image\?v=/);
  const image = await context.request.get(base + uploaded.url);
  assert.equal(image.headers()['content-type'], 'image/png');
  const png = await image.body(); assert.equal(png.readUInt32BE(16), 256); assert.equal(png.readUInt32BE(20), 256);
  assert.equal((await member.get(base + uploaded.url)).status(), 404, 'private image is scoped by the viewer session');
  assert.deepEqual(await json(await member.get(base + '/api/auth/avatar')), memberAvatar);
  assert.equal((await context.request.put(base + '/api/auth/avatar/image', { data: Buffer.from('<svg/>'), headers: { Origin: base, 'Content-Type': 'image/png' } })).status(), 400);
  assert.deepEqual(await json(await context.request.get(base + '/api/auth/avatar')), uploaded);
  const second = await request.newContext();
  await json(await second.post(base + '/api/auth/login', { data: { email: owner.email, password: owner.password }, headers: { Origin: base } }));
  assert.deepEqual(await json(await second.get(base + '/api/auth/avatar')), uploaded);
  await second.dispose(); await member.dispose();
  await page.reload(); await trigger.locator('img').waitFor();
  for (const [width, height] of [[1440,900],[1024,768],[390,844],[320,568]]) {
    await page.setViewportSize({ width, height });
    await trigger.click(); await page.getByRole('button', { name: '更换头像', exact: true }).click();
    await dialog.waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const bounds = await dialog.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.screenshot({ path: `${out}/picker-${width}.png` });
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await trigger.click(); assert.equal(await trigger.locator('.account-avatar').evaluate(el => el.getAnimations().length), 0);
  assert.deepEqual(errors, []);
  assertions.push('Persistent random assignment at registration; account isolation; preset save; cancel; valid WebP upload -> normalized PNG; unsupported/oversized rejection; retry; reload and second session; gear absent; keyboard focus; click animation and reduced motion; four viewport sizes');
  writeFileSync(`${out}/result.json`, JSON.stringify({ base, session, port, assertions, errors, limitation: 'Avatar/auth APIs real; unrelated video APIs mocked' }, null, 2));
  console.log('PASS avatar UI + real API:', assertions.join('; '));
} catch (error) {
  const page=browser?.contexts()[0]?.pages().at(-1);
  if(page){await page.screenshot({path:out+"/failure.png"});console.log((await page.locator("body").innerText()).slice(-2500));}
  throw error;
} finally {
  await browser?.close();
  execFileSync('tmux', ['kill-session', '-t', `=${session}`]);
}
