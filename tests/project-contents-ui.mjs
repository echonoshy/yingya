import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';
import { installApiMock, detail } from './ui-qa.mjs';
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = process.env.YINGYA_QA_OUTPUT ?? '/tmp/yingya-project-contents';
await mkdir(out, { recursive: true });
const seed = { ...structuredClone(detail), title: '单摆：摆长如何影响周期', status: 'running', statusLabel: '正在制作', activeTurnId: 'active', queue: [], queueDepth: 0, manifest: { ...detail.manifest, checkpoint: null, artifacts: [{ id: 'frame', path: 'frames/开场画面.png', label: '开场画面', kind: 'keyframe', metadata: {} }], versions: [], currentDraft: null } };
const files = ['frames/开场画面.png', 'video/单摆讲解.mp4', 'audio/讲解旁白.wav', 'docs/解说词.md', 'docs/数据.csv', 'docs/检查报告.json', 'docs/演示.html', 'archive/素材包.zip', 'frames/加载失败.png'].map((path, i) => ({ path, name: path.split('/').at(-1), size: 1024 * (i + 1), modifiedAt: Date.now() - i * 1000 }));
const browser = await chromium.launch({ headless: true });
const errors = [];
let listFailure = false, imageFailure = true, mediaFailure = true, currentFiles = files;
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
page.on('pageerror', error => errors.push(error.message));
try {
  await installApiMock(page, seed);
  await page.route(url => url.pathname.endsWith('/media'), route => route.fulfill({ json: { scenes: [], assets: mediaFailure ? [{ id: 'voice-1', type: 'audio', projectPath: 'audio/讲解旁白.wav' }] : [] } }));
  await page.route(url => url.pathname.endsWith('/contents'), route => route.fulfill({ status: listFailure ? 503 : 200, json: listFailure ? { message: 'fixture unavailable' } : { files: currentFiles, truncated: false } }));
  await page.route(url => url.pathname.includes('/files/'), async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.split('/files/')[1]);
    if (path.endsWith('加载失败.png') && imageFailure) return route.fulfill({ status: 404, body: '' });
    if (path.endsWith('.png')) return route.fulfill({ contentType: 'image/jpeg', body: await readFile('tests/fixtures/media/explainer.jpg') });
    if (path.endsWith('.mp4')) return route.fulfill({ contentType: 'video/mp4', body: await readFile('tests/fixtures/media/explainer.mp4') });
    if (path.endsWith('.wav')) { const b = Buffer.alloc(44 + 16000); b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(8000,24); b.writeUInt32LE(16000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(16000,40); return route.fulfill({ contentType: 'audio/wav', body: b }); }
    const body = path.endsWith('.md') ? '# 单摆解说词\n\n摆长变长，周期也会变长。' : path.endsWith('.csv') ? '摆长,周期\n1,2\n4,4' : path.endsWith('.json') ? '{"ok":true}' : path.endsWith('.html') ? '<h1>单摆演示</h1><script>parent.__unsafe=true</script>' : 'archive';
    return route.fulfill({ contentType: 'text/plain', body });
  });
  await page.goto(`${base}/app#/projects/${seed.id}`);
  await page.getByRole('tab', { name: '项目内容', exact: true }).click();
  await page.getByText('9 项内容', { exact: true }).waitFor();
  assert.equal(await page.locator('.canvas-tabs [role=tab]').count(), 2);
  assert.equal(await page.locator('#canvas-tab-plan, #canvas-tab-assets, #canvas-tab-artifacts').count(), 0);
  const production = page.getByRole('region', { name: '制作文件', exact: true });
  assert.equal(await production.getByRole('button').getAttribute('aria-expanded'), 'false', 'Technical files start collapsed');
  await page.getByLabel('搜索项目内容').fill('docs/检查报告.json');
  await page.getByRole('button', { name: '预览 检查报告.json', exact: true }).waitFor();
  assert.equal(await page.locator('.project-content-list > li').count(), 1, 'Search includes collapsed files and their paths');
  await page.getByLabel('清除搜索').click();
  assert.equal(await production.getByRole('button').getAttribute('aria-expanded'), 'false', 'Clearing search restores the folded groups');
  await production.getByRole('button').click();
  await page.getByRole('tab', { name: '预览', exact: true }).click();
  await page.getByRole('tab', { name: '项目内容', exact: true }).click();
  await production.waitFor();
  assert.equal(await production.getByRole('button').first().getAttribute('aria-expanded'), 'true', 'Group preference survives switching workbench tabs');
  await page.getByRole('button', { name: '文件列表', exact: true }).click();
  assert.equal(await page.locator('.project-content-list > li').count(), 9, 'Duplicate manifest + filesystem image appears once');
  await page.getByRole('combobox', { name: '内容排序', exact: true }).click();
  await page.getByRole('option', { name: '名称排序', exact: true }).click();
  const sortedNames = await page.locator('.project-content-name b').allTextContents();
  assert.deepEqual(sortedNames, [...sortedNames].sort((a, b) => a.localeCompare(b, 'zh-CN')), 'Name sorting follows Chinese collation');
  await page.getByRole('tab', { name: '预览', exact: true }).click();
  await page.getByRole('tab', { name: '项目内容', exact: true }).click();
  assert.match(await page.getByRole('combobox', { name: '内容排序', exact: true }).innerText(), /名称排序/, 'Sort preference survives tab switches');
  await page.getByRole('combobox', { name: '内容排序', exact: true }).click();
  await page.getByRole('option', { name: '最近更新', exact: true }).click();
  await page.getByText('部分素材信息暂时无法读取，项目文件仍可查看。', { exact: true }).waitFor();
  mediaFailure = false;
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.locator('.project-content-notice[role=alert]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.project-content-list > li').count(), 9, 'A malformed media index must not hide readable project files');
  const categories = page.getByRole('navigation', { name: '内容分类' });
  await categories.getByRole('button', { name: /^图片/ }).click();
  assert.equal(await page.locator('.project-content-list > li').count(), 2);
  await page.getByLabel('搜索项目内容').fill('开场');
  assert.equal(await page.locator('.project-content-list > li').count(), 1);
  const open = page.getByRole('button', { name: '预览 开场画面', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog', { name: '开场画面', exact: true });
  await dialog.locator('.project-file-body > img').evaluate(img => img.decode());
  const download = await dialog.getByRole('link', { name: '下载', exact: true }).getAttribute('href');
  assert.match(decodeURIComponent(download), /frames\/开场画面.png$/);
  await page.screenshot({ path: `${out}/image-preview.png` });
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  assert.ok(await open.evaluate(el => document.activeElement === el), 'Close returns focus');
  assert.equal(await page.getByLabel('搜索项目内容').inputValue(), '开场');
  await page.locator('.thread-footer textarea').fill('保留我的输入');
  await open.click(); await dialog.getByRole('button', { name: '加入对话', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.thread-footer textarea').inputValue(), '保留我的输入');
  assert.match(await page.locator('.context-chips').innerText(), /开场画面/);
  await page.waitForFunction(() => document.querySelector('.thread-footer textarea') === document.activeElement);
  await page.getByLabel('清除搜索').click();
  await categories.getByRole('button', { name: /^全部/ }).click();
  for (const [name, selector] of [['解说词.md', '.markdown-body h1'], ['数据.csv', 'table'], ['检查报告.json', 'pre'], ['演示.html', 'iframe'], ['单摆讲解.mp4', 'video[controls]'], ['讲解旁白.wav', 'audio[controls]'], ['素材包.zip', '.project-content-empty']]) {
    await page.getByRole('button', { name: `预览 ${name}`, exact: true }).click();
    const preview = page.getByRole('dialog', { name, exact: true });
    await preview.locator(selector).waitFor();
    if (name.endsWith('.html')) { assert.equal(await preview.locator('iframe').getAttribute('sandbox'), ''); assert.equal(await page.evaluate(() => window.__unsafe), undefined); }
    if (name.endsWith('.mp4') || name.endsWith('.wav')) { await preview.locator(selector).evaluate(media => new Promise((resolve, reject) => { if (media.readyState >= 1) return resolve(); media.addEventListener('loadedmetadata',resolve,{once:true}); media.addEventListener('error',()=>reject(new Error('media error')),{once:true}); })); }
    await page.keyboard.press('Escape'); await preview.waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: '预览 加载失败.png', exact: true }).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  imageFailure = false; await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await page.locator('.project-file-body > img').evaluate(img => img.decode());
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  listFailure = true; await page.getByRole('button', { name: '刷新项目内容', exact: true }).click();
  await page.locator('.project-content-notice[role=alert]').waitFor();
  assert.equal(await page.locator('.project-content-list > li').count(), 9, 'Failed refresh retains files');
  listFailure = false; await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.locator('.project-content-notice[role=alert]').waitFor({ state: 'hidden' });
  currentFiles = [...files, { path: 'frames/新增画面.png', name: '新增画面.png', size: 500, modifiedAt: Date.now() }];
  await page.getByRole('button', { name: '预览 新增画面.png', exact: true }).waitFor({ timeout: 10000 });
  await page.getByLabel('搜索项目内容').fill('不存在的文件'); await page.getByText('没有匹配的内容', { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看全部内容', exact: true }).click();
  // The desktop divider can now reach both ends without hiding working controls.
  await page.setViewportSize({ width: 1538, height: 1170 });
  const divider = page.getByRole('separator', { name: '调整创作对话宽度' });
  assert.equal(await page.locator('.thread-header').count(), 0);
  const headerBox = await page.locator('.project-header').boundingBox();
  const timelineBox = await page.locator('.timeline').boundingBox();
  assert.ok(Math.abs(timelineBox.y - headerBox.y - headerBox.height) < 2, 'Conversation uses the released header space');
  assert.ok(await page.locator('.project-content-list > li').first().evaluate(el => el.getBoundingClientRect().height <= 68), 'Compact rows');
  assert.equal(await page.locator('.project-content-preview').first().innerText(), '预览');
  for (const [key, expected] of [['Home', 280], ['End', 1138]]) {
    await divider.focus(); await page.keyboard.press(key);
    assert.equal(Number(await divider.getAttribute('aria-valuenow')), expected);
    for (const selector of ['.thread-footer .composer-toolbar', '.artifact-canvas > header', '.canvas-content']) {
      assert.ok(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${selector} overflow at ${expected}`);
    }
    await page.screenshot({ path: `${out}/split-${expected}.png` });
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForFunction(() => document.querySelector('.workspace-splitter--thread')?.getAttribute('aria-valuenow') === '624');
  assert.equal(Number(await divider.getAttribute('aria-valuenow')), 624);
  await page.setViewportSize({ width: 1538, height: 1170 });
  await page.waitForFunction(() => document.querySelector('.workspace-splitter--thread')?.getAttribute('aria-valuenow') === '1138');
  assert.equal(Number(await divider.getAttribute('aria-valuenow')), 1138, 'Window resizing retains the preferred width');
  await page.reload(); await divider.waitFor();
  assert.equal(Number(await divider.getAttribute('aria-valuenow')), 1138, 'Width survives reload');
  assert.equal(await page.locator('.thread-footer textarea').inputValue(), '保留我的输入');
  await page.getByRole('tab', { name: '项目内容', exact: true }).click();
  await page.getByRole('button', { name: '预览 开场画面', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  for (const [x, expected] of [[0, 280], [1537, 1138]]) {
    await divider.hover({ position: { x: 4, y: 80 } });
    const bounds = await divider.boundingBox();
    await page.mouse.down(); await page.mouse.move(x, bounds.y + 80, { steps: 6 }); await page.mouse.up();
    await page.waitForFunction(value => Number(document.querySelector('.workspace-splitter--thread')?.getAttribute('aria-valuenow')) === value, expected);
    assert.equal(Number(await divider.getAttribute('aria-valuenow')), expected, 'Pointer clamps at pane limits');
    assert.equal(await page.evaluate(() => { const key = Object.keys(localStorage).find(key => key.endsWith(':yingya-review-thread-width')); return key ? JSON.parse(localStorage.getItem(key)).value : null; }), expected, 'Pointer release saves the final width');
  }
  await divider.dblclick();
  assert.equal(Number(await divider.getAttribute('aria-valuenow')), 440, 'Double click restores default width');
  for (const [width, height] of [[1280,900],[1440,900],[1536,960],[1920,1080],[390,844],[320,568]]) {
    await page.setViewportSize({ width, height });
    if (width < 1024) { await page.getByRole('button', { name: '项目内容', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.workspace-tabs button:last-child')?.getAttribute('aria-pressed') === 'true'); }
    await page.waitForTimeout(100);
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Page overflow at ${width}`);
    assert.ok(await page.locator('.canvas-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Panel overflow at ${width}`);
    await page.screenshot({ path: `${out}/contents-${width}.png` });
    if (width < 1024) {
      await page.getByRole('button', { name: '预览 开场画面', exact: true }).click();
      const box = await page.getByRole('dialog').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= height);
      await page.screenshot({ path: `${out}/preview-${width}.png` });
      await page.getByRole('dialog').getByRole('button', { name: '加入对话', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const send = await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox(); assert.ok(send.y + send.height <= height);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('tab', { name: '项目内容', exact: true }).click();
  await page.locator('.project-contents-heading').getByRole('button', { name: '添加素材', exact: true }).click();
  await page.getByRole('region', { name: '选择创作素材', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', base, out, checks: 'Merged contents, deduplication, categories, search, image/video/audio/Markdown/CSV/JSON/HTML/download preview, sandbox, retry, polling, context draft preservation, focus, compact rows, divider extremes/keyboard/pointer/persistence, 6 widths, mobile composer, asset picker', data: 'isolated API fixtures; real image, video and audio bytes' }));
} catch (error) { await page.screenshot({ path: `${out}/failure.png` }); console.log((await page.locator('body').innerText()).slice(-2500)); throw error; }
finally { await browser.close(); }
