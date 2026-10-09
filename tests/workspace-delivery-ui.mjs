import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { detail, installApiMock } from './ui-qa.mjs';
const base = process.env.YINGYA_UI_QA_URL || 'http://127.0.0.1:8798';
const tag = base.startsWith('https') ? 'live' : 'local';
const out = '/tmp/yingya-workspace-delivery'; await mkdir(out, { recursive: true });
const version = { id: 'draft-1', label: '静摩擦力 · 版本1', sourcePath: '.yingya/versions/draft-1', videoPath: 'video.mp4', createdAt: Date.now() };
const project = { ...structuredClone(detail), title: '静摩擦力：为什么箱子没有动', aspectRatio: '16:9', model: 'gpt-6-astra', status: 'completed', statusLabel: '已导出', queue: [], queueDepth: 0, queuePaused: false,
  messages: [{ ...detail.messages[0], text: '用 30 秒解释静摩擦力。' }, { ...detail.messages[1], text: '视频已完成。可以播放检查，也可以描述需要修改的地方。' }],
  manifest: { ...structuredClone(detail.manifest), outputSpec: { fps: 30 }, phase: 'completed', dirty: true, checkpoint: null, currentDraft: version.id, versions: [version] }, renderJobs: [] };
const scenes = ['推了，为什么还没动？', '它阻碍什么？', '你加力，它也加力', '上限，不是固定大小'].map((title, index) => ({ id: `scene-${index}`, title, startSeconds: index * 2, durationSeconds: 2 }));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1285, height: 1170 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(error.message));
let releaseRender, renderInput, shareInput, renderObserved, failRender = true, configUnavailable = false, renderCount = 0;
const studioRequests = [];
page.on('request', request => { if (/\/studio(?:\/|$)/.test(new URL(request.url()).pathname)) studioRequests.push(request.url()); });
try {
  await installApiMock(page, project);
  await page.route(url => url.pathname.endsWith(`/agent-projects/${project.id}`), route => route.fulfill({ json: project }));
  await page.route(url => url.pathname.endsWith('/workbench'), route => {
    const workspace = { sourcePath: '.', scenesRevision: 'qa-scenes', scenes, assets: [], sourceBindings: null };
    return route.fulfill({ json: { ...workspace, workspace, versionId: version.id, currentVersionId: version.id, requirements: {}, assetRoles: [], recipeCatalog: { schemaVersion: 1, recipes: [] }, editable: false, editReason: '' } });
  });
  await page.route(/\/files\/(video|old)\.mp4$/, async route => {
    const body = await readFile('tests/fixtures/media/explainer.mp4'), range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
    return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4', headers: { 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}) }, body: body.subarray(start, end + 1) });
  });
  await page.route('**/files/**/remotion.json', route => route.fulfill(configUnavailable
    ? { status: 503, json: { message: '暂不可用' } }
    : { json: { engine: 'remotion', composition: { fps: route.request().url().includes('draft-old/') ? 60 : 24 } } }));
  await page.route(url => url.pathname.endsWith('/render'), async route => {
    renderCount++;
    renderInput = route.request().postDataJSON();
    await new Promise(resolve => { releaseRender = resolve; renderObserved?.(renderInput); renderObserved = undefined; });
    if (failRender) return route.fulfill({ status: 500, json: { message: '测试：导出暂不可用' } });
    project.renderJobs = [{ id: 'job-1', versionId: version.id, status: 'running', quality: 'high', resolution: renderInput.resolution, fps: renderInput.fps, progress: 25, message: '', startedAt: Date.now(), updatedAt: Date.now() }];
    return route.fulfill({ json: { jobId: 'job-1', status: 'rendering', resolution: '3840x2160', fps: renderInput.fps } });
  });
  await page.route(url => url.pathname === '/api/shares', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { shares: [] } });
    shareInput = route.request().postDataJSON();
    return route.fulfill({ json: { id: 'share-1', projectId: project.id, ownerId: 'qa-user', artifactId: 'video', title: project.title, version: version.label, createdAt: 1750000000, expiresAt: null, status: 'active', bytes: 1024, reservedBytesToday: 0, url: '/s/' + 'a'.repeat(64) } });
  });
  await page.goto(base + '/app#/projects/' + project.id); await page.locator('.video-stage video').waitFor(); await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.scene-edit-tools,.scene-edit-hint,.dirty-chip,.export-destination,.current-video-actions,.preview-mode,.live-composition,iframe').count(), 0);
  await page.getByRole('group', { name: '选择镜头' }).getByRole('button').nth(2).click();
  await page.waitForFunction(() => document.querySelector('.video-stage video').currentTime === 4);
  const textarea = page.getByRole('textbox', { name: '修改描述', exact: true });
  await textarea.fill('已有的修改草稿');
  const entry = page.getByRole('button', { name: '分享与下载', exact: true });
  const dialog = page.getByRole('dialog', { name: '分享与下载', exact: true });
  for (const width of [1920, 1536, 1440, 1285, 1280, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    const thread = page.getByRole('button', { name: '对话', exact: true }); if (await thread.isVisible()) await thread.click();
    const metrics = await page.locator('.composer-toolbar').evaluate(el => [...el.querySelectorAll('.composer-more-trigger,.model-trigger,.send-button')].map(button => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, height: r.height, font: getComputedStyle(button).fontSize }; }));
    assert.ok(metrics.every((r, i) => Math.abs(r.y - metrics[0].y) < 1 && r.right <= width && (!i || r.x >= metrics[i - 1].right)), `one row ${width}`);
    assert.equal(metrics[1].font, width <= 600 ? '12px' : '13px');
    assert.ok(await page.locator('.project-heading').evaluate(el => [...el.children].every(child => child.getBoundingClientRect().right <= el.getBoundingClientRect().right + 1)), `Header content fits ${width}`);
    await page.screenshot({ path: `${out}/${tag}-workspace-${width}.png` });
    await entry.click(); await dialog.waitFor();
    assert.equal(await page.getByRole('button', { name: '分享当前视频', exact: true }).count(), 1);
    assert.equal(await dialog.getByRole('link', { name: '下载当前视频' }).count(), 1);
    assert.equal(await dialog.locator('.export-settings').getAttribute('open'), null);
    assert.ok(await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth; }));
    await page.screenshot({ path: `${out}/${tag}-delivery-${width}.png` });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); assert.ok(await entry.evaluate(el => el === document.activeElement));
    assert.equal(await textarea.inputValue(), '已有的修改草稿');
  }
  await entry.click();
  const download = dialog.getByRole('link', { name: '下载当前视频' });
  assert.equal(await download.getAttribute('download'), '');
  const downloadUrl = await download.getAttribute('href');
  assert.equal(downloadUrl, await page.locator('.video-stage video').getAttribute('src'));
  // Verify the selected download resource with an in-page request that stays inside the API fixture.
  assert.equal(await page.evaluate(async url => (await (await fetch(url)).arrayBuffer()).byteLength, downloadUrl), (await readFile('tests/fixtures/media/explainer.mp4')).byteLength);
  const share = dialog.getByRole('button', { name: '分享当前视频', exact: true }); await share.click();
  const shareDialog = page.getByRole('dialog', { name: '分享当前视频', exact: true });
  await shareDialog.getByRole('button', { name: '创建分享链接', exact: true }).click(); await shareDialog.getByRole('button', { name: '复制链接', exact: true }).waitFor(); assert.equal(shareInput.versionId, version.id);
  await page.keyboard.press('Escape'); await shareDialog.waitFor({ state: 'detached' }); assert.ok(await share.evaluate(el => el === document.activeElement)); assert.ok(await dialog.isVisible());
  await dialog.locator('.export-settings > summary').click();
  await dialog.getByRole('combobox', { name: '分辨率' }).click(); await page.getByRole('option', { name: '3840 × 2160 p', exact: true }).click();
  assert.equal(await dialog.getByRole('combobox', { name: '帧率' }).count(), 0);
  await page.screenshot({ path: `${out}/${tag}-export-320.png` });
  const firstRender = page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/render')); await dialog.getByRole('button', { name: '导出已有版本', exact: true }).click(); await firstRender;
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  assert.ok(releaseRender); releaseRender();
  await entry.click(); await dialog.getByRole('alert').waitFor(); assert.match(await dialog.getByRole('alert').innerText(), /导出暂不可用/);
  assert.match(await dialog.getByRole('combobox', { name: '分辨率' }).textContent(), /3840/);
  assert.deepEqual(renderInput, { versionId: version.id, resolution: 'landscape-4k', fps: 24 });
  failRender = false; releaseRender = null;
  const retryRequest = page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/render')); await dialog.getByRole('button', { name: '导出已有版本', exact: true }).click(); await retryRequest;
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' }); releaseRender();
  await page.waitForFunction(() => document.querySelector('.export-button').textContent.includes('正在导出'));
  await entry.click(); await dialog.getByText('已完成 25%', { exact: true }).waitFor(); assert.ok(await dialog.getByRole('button', { name: '分享当前视频' }).isEnabled());
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  // A historical export follows its own snapshot, even with a legacy HTML entry path.
  const historical = { ...version, id: 'draft-old', label: '静摩擦力 · 旧版', sourcePath: '.yingya/versions/draft-old/index.html', videoPath: 'old.mp4' };
  project.manifest.versions = [historical, version]; project.renderJobs = [];
  await page.setViewportSize({ width: 1285, height: 1000 }); await page.reload();
  await page.getByRole('combobox', { name: '视频版本', exact: true }).click();
  await page.getByRole('option', { name: historical.label, exact: true }).click();
  await entry.click(); assert.match(await dialog.getByRole('link', { name: '下载当前视频' }).getAttribute('href'), /old\.mp4$/);
  await dialog.locator('.export-settings > summary').click();
  configUnavailable = true;
  const countBefore = renderCount;
  await dialog.getByRole('button', { name: '导出已有版本', exact: true }).click();
  await dialog.getByText('暂时无法读取这个版本的导出信息，请重试。', { exact: true }).waitFor();
  assert.equal(renderCount, countBefore, 'No render is submitted with a guessed frame rate');
  assert.ok(await dialog.getByRole('link', { name: '下载当前视频' }).isVisible());
  configUnavailable = false; failRender = true;
  const historicalRequest = new Promise(resolve => { renderObserved = resolve; });
  await dialog.getByRole('button', { name: '导出已有版本', exact: true }).click();
  assert.deepEqual(await historicalRequest, { versionId: historical.id, resolution: 'landscape', fps: 60 }); releaseRender();
  await dialog.getByText('测试：导出暂不可用', { exact: false }).waitFor();
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  // Retrying an old failed export must not reuse the old mismatched FPS.
  project.renderJobs = [{ id: 'failed-old', versionId: historical.id, status: 'failed', quality: 'high', resolution: 'landscape', fps: 30, progress: 0, message: '', startedAt: Date.now(), updatedAt: Date.now() }];
  await page.reload(); await entry.click(); await dialog.locator('.export-settings > summary').click();
  await dialog.locator('.render-history > summary').click();
  const historyRetry = new Promise(resolve => { renderObserved = resolve; });
  await dialog.getByRole('button', { name: '重试', exact: true }).click();
  assert.deepEqual(await historyRetry, { versionId: historical.id, resolution: 'landscape', fps: 60 }); releaseRender();
  await dialog.getByText('测试：导出暂不可用', { exact: false }).waitFor();
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  await page.setViewportSize({ width: 320, height: 1000 });
  // Running conversations retain a one-row toolbar, including stop and send at 320px.
  project.activeTurnId = 'active-turn'; project.status = 'running'; project.statusLabel = '正在制作'; await page.reload(); await page.getByRole('button', { name: '对话', exact: true }).click();
  const row = await page.locator('.composer-toolbar').evaluate(el => [...el.querySelectorAll('.composer-more-trigger,.model-trigger,.stop-button,.send-button')].map(button => { const r = button.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, height: r.height }; }));
  assert.equal(row.length, 4); assert.ok(row.every((r, i) => Math.abs(r.y - row[0].y) < 1 && r.height >= 44 && r.right <= 320 && (!i || r.x >= row[i - 1].right)));
  await page.screenshot({ path: `${out}/${tag}-running-320.png` });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByText(/正在生成新版，当前预览为/).waitFor();
  assert.equal(await page.locator('.video-stage video').count(), 1, 'The saved video stays available during a revision');
  project.activeTurnId = null; project.status = 'draft'; project.manifest.dirty = false; project.manifest.phase = 'created'; project.manifest.versions = []; project.manifest.currentDraft = null; project.renderJobs = [];
  await page.reload(); await entry.click(); await dialog.getByText('视频生成后，可在这里分享或下载。', { exact: true }).waitFor();
  assert.equal(await dialog.getByRole('link', { name: '下载当前视频' }).count(), 0);
  assert.equal(await dialog.locator('.export-settings').count(), 0);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '预览', exact: true }).click();
  await page.getByText('视频将在这里显示', { exact: true }).waitFor();
  assert.equal(await page.locator('.playback-bar,.preview-mode,.live-composition').count(), 0, 'Empty projects do not show an empty player');
  assert.deepEqual(studioRequests, [], 'Workspace does not open preview sessions or heartbeats');
  assert.deepEqual(errors, []); assert.equal(await page.locator('vite-error-overlay').count(), 0);
  console.log('PASS ' + base + ': 320–1920px; unified video preview; scene seek; single delivery entry; download media; nested share focus/version; export choices/error survive closure; snapshot FPS 24/60 and historical retry; no export on missing config; prior video while revising; empty state without player; no Studio requests. Isolated API fixtures; no live sharing/rendering.');
} catch (error) { await page.screenshot({ path: `${out}/${tag}-failure.png` }); throw error; }
finally { await browser.close(); }
