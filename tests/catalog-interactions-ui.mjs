import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock, detail } from './ui-qa.mjs';

// Browser plugin not available. Use isolated data through the real frontend.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = `/tmp/yingya-catalog-interactions/${base.startsWith('https') ? 'public' : 'local'}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1564, height: 1170 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = [], consoleErrors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
const now = Date.now();
const kinds = [['image', 'png', 'image/png'], ['audio', 'mp3', 'audio/mpeg'], ['image', 'jpg', 'image/jpeg'], ['document', 'pdf', 'application/pdf']];
const folders = [{ id: 'brand', name: '品牌素材', createdAt: now }, { id: 'scene', name: '场景参考', createdAt: now }];
const assets = Array.from({ length: 36 }, (_, i) => {
  const [category, extension, mimeType] = kinds[i % kinds.length];
  return { id: `asset-${String(i).padStart(2, '0')}`, category, mimeType, sourceName: `${String(i).padStart(2, '0')}-${i === 0 ? 'image_a0ef017d-351b-41dd-9f40-b83f66048e68' : '创作素材'}.${extension}`, kind: i % 3 ? 'uploaded' : 'generated', folderId: i % 3 === 0 ? null : i % 3 === 1 ? 'brand' : 'scene', prompt: null, url: `/qa-catalog/${i}.${extension}`, projectPath: `assets/${i}.${extension}`, createdAt: now - i * 60000 };
});
const seed = { ...structuredClone(detail), activeTurnId: null, queueDepth: 0, queue: [], updatedAt: now };
const projects = [
  { ...seed, title: '已导出的讲解视频', workflowStatus: 'completed', workflowLabel: '已导出 · 源文件有更新', status: 'completed' },
  { ...seed, id: '22222222-2222-4222-8222-222222222222', title: '等待导出的视频', workflowStatus: 'ready', workflowLabel: '已有视频 · 源文件有更新', status: 'draft_review' },
  { ...seed, id: '33333333-3333-4333-8333-333333333333', title: '制作中的视频', workflowStatus: 'active', workflowLabel: '正在制作', status: 'running' },
];
let failProject = false, slowProject = false, shortLibrary = false;
function pdf() {
  let body = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, object] of ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 160] /Resources << >> /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'].entries()) { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(body); body += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}
async function select(label, option) { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); }
const cards = () => page.locator('.asset-card-item');
const chosen = () => page.locator('.asset-card-item.batch-selected').evaluateAll(nodes => nodes.map(node => node.dataset.assetId).sort());
async function drag(from, to, modifiers = [], screenshot) {
  for (const key of modifiers) await page.keyboard.down(key);
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.locator('.asset-selection-box').waitFor(); await page.waitForTimeout(80);
  assert.equal(await cards().first().getByRole('button').evaluate(button => getComputedStyle(button).cursor), 'crosshair');
  if (screenshot) await page.screenshot({ path: `${out}/${screenshot}.png` });
  await page.mouse.up();
  for (const key of modifiers) await page.keyboard.up(key);
  await page.locator('.asset-selection-box').waitFor({ state: 'hidden' });
}
async function capture(name, width, height = 1000) {
  await page.setViewportSize({ width, height }); await page.waitForTimeout(120);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].filter(i => { const r = i.getBoundingClientRect(); return r.width && r.top < innerHeight && r.bottom > 0; }).map(i => i.decode().catch(() => {}))); });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `page width ${width}`);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await page.screenshot({ path: `${out}/${name}-${width}.png` });
}
async function aligned(primary) {
  const a = await page.locator(primary).boundingBox(), b = await page.getByRole('button', { name: '任务中心', exact: true }).boundingBox();
  assert.equal(a.height, 44); assert.equal(b.height, 44);
  assert.ok(Math.abs(a.y - b.y) <= 1, `Header controls align: ${JSON.stringify({ a, b })}`);
}
try {
  await installApiMock(page, seed);
  await page.route(u => /\/api(?:\/u\/[^/]+)?\/assets\/library$/.test(u.pathname), route => route.fulfill({ json: { assets: shortLibrary ? assets.slice(0, 8) : assets } }));
  await page.route(u => /\/api(?:\/u\/[^/]+)?\/assets\/folders$/.test(u.pathname), route => route.fulfill({ json: folders }));
  await page.route('**/qa-catalog/**', async route => route.fulfill({ contentType: route.request().url().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg', body: route.request().url().endsWith('.pdf') ? pdf() : await readFile('tests/fixtures/media/explainer.jpg') }));
  await page.route(u => /\/api(?:\/u\/[^/]+)?\/agent-projects$/.test(u.pathname), route => route.fulfill({ json: projects }));
  await page.route(u => /\/agent-projects\/[a-f0-9-]+$/.test(u.pathname), async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    if (slowProject) await new Promise(resolve => setTimeout(resolve, 700));
    await route.fulfill({ status: failProject ? 503 : 200, json: failProject ? { error: '模拟项目读取失败' } : { ...seed, id: new URL(route.request().url()).pathname.split('/').at(-1) } });
  });
  await page.goto(`${base}/app#/assets`); await page.getByRole('heading', { name: '素材', exact: true }).waitFor();
  // Endpoint names are validated by the first data assertion below.
  await page.waitForFunction(() => document.querySelectorAll('.asset-card-item').length === 36);
  await select('素材显示方式', '小图'); await capture('assets-small', 1564, 1170); await aligned('.asset-upload-button');
  const typography = await cards().first().evaluate(card => { const name = card.querySelector('b'), source = card.querySelector('small'), folder = card.querySelector('em'); return { font: getComputedStyle(name).fontSize, sourceX: source.getBoundingClientRect().x, folderX: folder.getBoundingClientRect().x }; });
  assert.equal(typography.font, '13px'); assert.equal(typography.sourceX, typography.folderX);
  for (const width of [390, 320]) await capture('assets-small', width);
  await page.setViewportSize({ width: 1564, height: 1170 }); await page.waitForTimeout(120);
  await select('素材显示方式', '列表'); await capture('assets-list', 1564, 1170);
  assert.ok((await cards().first().boundingBox()).height <= 54);
  assert.equal(await page.locator('.asset-list-type').allTextContents().then(types => types.every(type => /^(PNG|MP3|JPG|PDF)$/.test(type))), true);
  const columns = page.getByRole('group', { name: '素材列表排序' });
  for (const [label, key, compare] of [
    ['类型', 'type', (a, b) => a.sourceName.split('.').at(-1).toUpperCase().localeCompare(b.sourceName.split('.').at(-1).toUpperCase())],
    ['来源', 'source', (a, b) => a.kind.localeCompare(b.kind)],
    ['文件夹', 'folder', (a, b) => (folders.find(f => f.id === a.folderId)?.name ?? '未整理').localeCompare(folders.find(f => f.id === b.folderId)?.name ?? '未整理', 'zh-CN')],
    ['素材名称', 'name', (a, b) => a.sourceName.localeCompare(b.sourceName, 'zh-CN')],
  ]) {
    const button = columns.getByRole('button', { name: new RegExp(`^按${label}排序`) });
    for (const direction of [1, -1]) {
      await button.click(); assert.match(await button.getAttribute('aria-label'), direction === 1 ? /升序/ : /降序/);
      const expected = [...assets].sort((a, b) => compare(a, b) * direction || a.sourceName.localeCompare(b.sourceName, 'zh-CN') || a.id.localeCompare(b.id)).map(a => a.id);
      assert.deepEqual(await cards().evaluateAll(nodes => nodes.map(n => n.dataset.assetId)), expected, `${key} direction ${direction}`);
    }
  }
  const time = columns.getByRole('button', { name: /^按添加时间排序/ }); await time.click(); assert.match(await time.getAttribute('aria-label'), /降序/); await time.click(); assert.match(await time.getAttribute('aria-label'), /升序/);
  await select('素材排序', '最近添加');
  // Grid selection, additive selection, Escape cancellation and native card clicks.
  await select('素材显示方式', '中图'); await page.getByRole('button', { name: '批量整理', exact: true }).click();
  const one = await cards().nth(0).boundingBox(), two = await cards().nth(1).boundingBox();
  await drag({ x: one.x - 6, y: one.y + 4 }, { x: two.x + two.width - 2, y: two.y + two.height - 4 });
  assert.deepEqual(await chosen(), ['asset-00', 'asset-01']);
  const three = await cards().nth(2).boundingBox();
  await drag({ x: three.x - 5, y: three.y + 4 }, { x: three.x + three.width - 2, y: three.y + three.height - 4 }, ['Shift']);
  assert.deepEqual(await chosen(), ['asset-00', 'asset-01', 'asset-02']);
  await page.mouse.move(one.x - 6, one.y + 4); await page.mouse.down(); await page.mouse.move(one.x + one.width - 2, one.y + one.height - 4, { steps: 8 }); await page.locator('.asset-selection-box').waitFor(); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual(await chosen(), ['asset-00', 'asset-01', 'asset-02']);
  await cards().nth(2).getByRole('button').click(); assert.deepEqual(await chosen(), ['asset-00', 'asset-01']);
  await page.screenshot({ path: `${out}/marquee-grid.png` });
  // A long drag scrolls the library and extends selection beyond the first viewport.
  await page.mouse.move(one.x - 6, one.y + 4); await page.mouse.down(); await page.mouse.move(two.x + two.width - 2, 1150, { steps: 12 });
  await page.waitForFunction(() => document.querySelector('.asset-main').scrollTop > 180); await page.mouse.up();
  assert.ok((await chosen()).length > 6); await page.locator('.asset-main').evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('toolbar', { name: '批量整理素材' }).getByRole('button', { name: '取消', exact: true }).click();
  await select('素材显示方式', '列表'); await page.getByRole('button', { name: '批量整理', exact: true }).click();
  const firstRow = await cards().nth(0).boundingBox(), thirdRow = await cards().nth(2).boundingBox();
  await drag({ x: firstRow.x - 6, y: firstRow.y + 4 }, { x: firstRow.x + 100, y: thirdRow.y + thirdRow.height - 4 });
  assert.deepEqual(await chosen(), ['asset-00', 'asset-01', 'asset-02']); await page.screenshot({ path: `${out}/marquee-list.png` });
  await page.getByRole('toolbar', { name: '批量整理素材' }).getByRole('button', { name: '取消', exact: true }).click();
  for (const width of [1280, 1440, 1536, 1920, 390, 320]) { await capture('assets-list', width); if (width > 760) await aligned('.asset-upload-button'); }
  await page.setViewportSize({ width: 1564, height: 1170 });
  // A short library leaves blank space outside the list, including below its last row.
  shortLibrary = true; await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.asset-card-item').length === 8);
  await page.getByRole('button', { name: '批量整理', exact: true }).click();
  const pane = await page.locator('.asset-main').boundingBox(), shortGrid = await page.locator('.asset-mixed-grid').boundingBox();
  const row0 = await cards().nth(0).boundingBox(), row2 = await cards().nth(2).boundingBox(), row6 = await cards().nth(6).boundingBox(), row7 = await cards().nth(7).boundingBox();
  const outside = { x: pane.x + 8, y: row0.y + 4 };
  assert.ok(outside.x < shortGrid.x);
  await drag(outside, { x: row0.x + 100, y: row2.y + row2.height - 4 });
  assert.deepEqual(await chosen(), ['asset-00', 'asset-01', 'asset-02'], 'Left outer gutter starts selection');
  const blank = { x: shortGrid.x + 4, y: row0.y + 4 };
  await page.mouse.click(blank.x, blank.y); assert.equal((await chosen()).length, 3, 'Blank click retains selection');
  await page.mouse.dblclick(blank.x, blank.y); assert.equal((await chosen()).length, 3, 'Blank double click retains selection');
  await cards().first().getByRole('button').dblclick(); assert.equal((await chosen()).length, 3, 'Double click on selected file retains selection');
  const below = { x: row7.x + 100, y: shortGrid.y + shortGrid.height + 80 };
  assert.ok(below.y < pane.y + pane.height - 40);
  await page.mouse.move(below.x, below.y);
  assert.equal(await page.evaluate(({ x, y }) => getComputedStyle(document.elementFromPoint(x, y)).cursor, below), 'crosshair');
  await drag(below, { x: row6.x + 10, y: row6.y + 4 }, [], 'marquee-below-list');
  assert.deepEqual(await chosen(), ['asset-06', 'asset-07'], 'Lower blank area starts selection upwards');
  await page.mouse.dblclick(below.x, below.y); assert.deepEqual(await chosen(), ['asset-06', 'asset-07']);
  await drag({ x: pane.x + pane.width - 8, y: row0.y + 4 }, { x: row0.x + row0.width - 20, y: row2.y + row2.height - 4 });
  assert.deepEqual(await chosen(), ['asset-00', 'asset-01', 'asset-02'], 'Right outer gutter starts selection');
  assert.ok(await page.evaluate(() => document.querySelector('.asset-main').scrollWidth <= document.querySelector('.asset-main').clientWidth));
  await page.screenshot({ path: `${out}/marquee-outer-space.png` });
  await page.goto(`${base}/app#/projects`); await page.getByRole('heading', { name: '项目', exact: true }).waitFor(); await page.locator('.home-project-list > article').first().waitFor();
  await aligned('.catalog-primary-action'); assert.equal(await page.locator('.home-project-list').innerText().then(text => text.includes('源文件有更新')), false);
  const filters = page.getByRole('tablist', { name: '筛选项目' });
  for (const status of ['可导出', '已导出']) { await filters.getByRole('tab', { name: new RegExp(status) }).click(); assert.equal(await page.locator('.home-project-list > article').count(), 1); assert.equal((await page.locator('.home-status').innerText()).trim(), status); }
  await filters.getByRole('tab', { name: /^全部/ }).click();
  for (const width of [1280, 1440, 1536, 1920, 390, 320]) { await capture('projects', width); if (width > 760) await aligned('.catalog-primary-action'); }
  await page.setViewportSize({ width: 1564, height: 1170 });
  await page.evaluate(() => { window.__creationFlashes = 0; window.__catalogObserver = new MutationObserver(() => { if (document.querySelector('.home-create')) window.__creationFlashes++; }); window.__catalogObserver.observe(document.body, { childList: true, subtree: true }); });
  failProject = true; slowProject = true; await page.locator('.home-project-open').first().click();
  await page.getByText('正在打开项目…', { exact: true }).waitFor(); assert.equal(await page.locator('.home-create').count(), 0); await page.screenshot({ path: `${out}/project-loading.png` });
  await page.getByText('项目暂时无法打开', { exact: true }).waitFor(); assert.equal(await page.locator('.home-create').count(), 0);
  assert.deepEqual(await page.locator('.project-open-actions > button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height)), [44, 44]);
  await page.screenshot({ path: `${out}/project-open-error.png` });
  failProject = false; await page.getByRole('button', { name: '重新加载', exact: true }).click(); await page.locator('.knowledge-workspace').waitFor(); assert.equal(await page.evaluate(() => window.__creationFlashes), 0);
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await page.locator('.home-project-open').nth(1).click(); await page.getByText('正在打开项目…', { exact: true }).waitFor(); await page.getByRole('button', { name: '返回项目', exact: true }).click(); await page.waitForTimeout(850);
  await page.getByRole('heading', { name: '项目', exact: true }).waitFor(); assert.equal(await page.locator('.knowledge-workspace').count(), 0, 'Late project response cannot replace the directory');
  assert.equal(await page.evaluate(() => window.__creationFlashes), 0); assert.deepEqual(errors, []);
  // The intentional 503 is the only allowed resource failure in this flow.
  assert.ok(consoleErrors.every(message => message.includes('503')), JSON.stringify(consoleErrors));
  console.log(JSON.stringify({ result: 'PASS', base, out, checks: 'Compact cards/list, metadata left alignment, 44px header alignment, five sortable columns and both directions, format-only types, grid/list marquee including outer gutters and lower blank space, blank clicks/double-clicks retain selection, crosshair during selection, additive/cancel/click/autoscroll, separate export filters, direct project loading/error/retry/cancellation without creation flashes, six widths', data: 'isolated API fixtures' }));
} catch (error) { await page.screenshot({ path: `${out}/failure.png` }); console.log((await page.locator('body').innerText()).slice(-1600)); throw error; }
finally { await browser.close(); }
