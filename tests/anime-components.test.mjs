import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { installComponents, listComponents } from '../runtime/animejs/cli.mjs';

const pack = fileURLToPath(new URL('../runtime/animejs/', import.meta.url));
const context = vm.createContext({});
vm.runInContext(await fs.readFile(path.join(pack, 'scenes.js'), 'utf8'), context);
const { validateConfig } = context.YingyaAnime;
const title = { component: 'title-reveal', title: '让内容动起来', startSeconds: 3, durationSeconds: 5 };
const flow = { component: 'flow-path', title: '从素材到成片', startSeconds: 0, durationSeconds: 6, nodes: [{ label: '上传' }, { label: '生成' }] };
const compare = { component: 'number-compare', title: '真实对比', startSeconds: 9, durationSeconds: 5, metrics: [{ label: '之前', value: 24 }, { label: '之后', value: 3.5, decimals: 1 }] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function temporary(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yingya-anime-components-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('CLI help is available without a project and list JSON is parseable', () => {
  const cli = path.join(pack, 'cli.mjs');
  for (const flag of ['--help', '-h']) assert.match(execFileSync(process.execPath, [cli, flag], { encoding: 'utf8' }), /Usage:.*install --project/);
  const catalog = JSON.parse(execFileSync(process.execPath, [cli, 'list', '--json'], { encoding: 'utf8' }));
  assert.equal(catalog.components.length, 3);
});

test('pinned official bundle and MIT license match provenance exactly', async () => {
  const provenance = JSON.parse(await fs.readFile(path.join(pack, 'PROVENANCE.json'), 'utf8'));
  assert.equal(provenance.version, '4.5.0');
  assert.equal(provenance.license, 'MIT');
  for (const [name, source] of Object.entries(provenance.files)) {
    assert.match(source.url, /^https:\/\/cdn\.jsdelivr\.net\/npm\/animejs@4\.5\.0\//);
    assert.equal(hash(await fs.readFile(path.join(pack, name))), source.sha256);
  }
  assert.match(await fs.readFile(path.join(pack, 'LICENSE.animejs.md'), 'utf8'), /Permission is hereby granted/);
});

test('catalog examples use supported components and finite global start times', async () => {
  const catalog = await listComponents();
  assert.deepEqual(catalog.components.map(component => component.id), ['title-reveal', 'flow-path', 'number-compare']);
  for (const component of catalog.components) {
    const checked = validateConfig(component.example);
    assert.equal(checked.component, component.id);
    assert.ok(checked.durationSeconds >= 2);
    assert.equal(component.preview, `previews/${component.id}.png`);
  }
  assert.equal(validateConfig(title).startSeconds, 3);
  assert.equal(validateConfig(compare).metrics[0].from, 0);
  assert.equal(validateConfig(compare).metrics[1].decimals, 1);
});

test('scene contracts reject invalid times, unknown types, missing titles and excessive Chinese copy', () => {
  for (const value of [NaN, Infinity, -Infinity, -1, '3', undefined, null]) {
    assert.throws(() => validateConfig({ ...title, startSeconds: value }), /startSeconds/);
  }
  for (const value of [NaN, Infinity, 0, 1.99, 121, '5', undefined]) {
    assert.throws(() => validateConfig({ ...title, durationSeconds: value }), /durationSeconds/);
  }
  assert.throws(() => validateConfig({ ...title, component: 'scramble-everything' }), /component/);
  assert.throws(() => validateConfig({ ...title, title: ' ' }), /title/);
  assert.throws(() => validateConfig({ ...title, title: '中'.repeat(45) }), /44/);
  assert.equal(validateConfig({ ...title, title: '中'.repeat(44) }).title.length, 44);
  assert.throws(() => validateConfig({ ...title, subtitle: '中'.repeat(101) }), /100/);
  // Markup remains literal text; the DOM implementation must use textContent.
  assert.equal(validateConfig({ ...title, title: '<img src=x onerror=alert(1)>' }).title, '<img src=x onerror=alert(1)>');
});

test('flow and metric constraints catch malformed configs before changing DOM', () => {
  for (const nodes of [null, [], [{ label: 'only one' }], Array(6).fill({ label: 'many' }), ['label', 'label']]) {
    assert.throws(() => validateConfig({ ...flow, nodes }), /nodes/);
  }
  assert.throws(() => validateConfig({ ...flow, nodes: [{ label: '中'.repeat(13) }, { label: '生成' }] }), /label/);
  assert.equal(validateConfig({ ...flow, nodes: Array(5).fill({ label: '阶段', detail: '描述' }) }).nodes.length, 5);
  assert.throws(() => validateConfig({ ...compare, metrics: [compare.metrics[0]] }), /exactly two/);
  for (const value of [NaN, Infinity, '120', null, 1e15]) {
    assert.throws(() => validateConfig({ ...compare, metrics: [{ label: '之前', value }, compare.metrics[1]] }), /value/);
  }
  for (const decimals of [.5, 3, -1, null, Infinity]) {
    assert.throws(() => validateConfig({ ...compare, metrics: [{ ...compare.metrics[0], decimals }, compare.metrics[1]] }), /decimals/);
  }
  assert.throws(() => validateConfig({ ...compare, metrics: [{ ...compare.metrics[0], from: null }, compare.metrics[1]] }), /from/);
  assert.equal(validateConfig({ ...compare, metrics: [{ label: '降幅', value: -123.45, from: 0, decimals: 2 }, compare.metrics[1]] }).metrics[0].value, -123.45);
});

test('installer copies a portable self-contained pack, returns unchanged on repeat and preserves sibling assets', async t => {
  const root = await temporary(t);
  await fs.mkdir(path.join(root, 'assets'));
  await fs.writeFile(path.join(root, 'assets/owned-by-user.txt'), 'keep me');
  const first = await installComponents(root);
  assert.equal(first.status, 'installed');
  const manifest = JSON.parse(await fs.readFile(path.join(first.directory, 'install-manifest.json'), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.files)) assert.equal(hash(await fs.readFile(path.join(first.directory, name))), expected);
  const before = (await fs.stat(path.join(first.directory, 'scenes.js'))).mtimeMs;
  const second = await installComponents(root);
  assert.equal(second.status, 'unchanged');
  assert.equal((await fs.stat(path.join(first.directory, 'scenes.js'))).mtimeMs, before);
  assert.equal(await fs.readFile(path.join(root, 'assets/owned-by-user.txt'), 'utf8'), 'keep me');
  const copyTarget = path.join(root, 'independent-project');
  await fs.mkdir(copyTarget);
  // Run the installed copy, outside the repository cwd, without node_modules.
  const output = execFileSync(process.execPath, [path.join(first.directory, 'cli.mjs'), 'install', '--project', copyTarget], { cwd: root, encoding: 'utf8' });
  assert.equal(JSON.parse(output).status, 'installed');
  assert.deepEqual(await fs.readFile(path.join(copyTarget, 'assets/animejs/install-manifest.json')), await fs.readFile(path.join(first.directory, 'install-manifest.json')));
});

test('installer refuses edited and incomplete installs before writing anything', async t => {
  const root = await temporary(t);
  const installed = await installComponents(root);
  const script = path.join(installed.directory, 'scenes.js');
  await fs.appendFile(script, '\n// deliberate customer customization\n');
  const customized = await fs.readFile(script);
  const listing = (await fs.readdir(installed.directory)).sort();
  await assert.rejects(installComponents(root), /preserving it/);
  assert.deepEqual(await fs.readFile(script), customized);
  assert.deepEqual((await fs.readdir(installed.directory)).sort(), listing);
  const partial = path.join(root, 'partial');
  await fs.mkdir(path.join(partial, 'assets/animejs'), { recursive: true });
  await fs.writeFile(path.join(partial, 'assets/animejs/scenes.js'), 'customer file');
  await assert.rejects(installComponents(partial), /preserving it/);
  assert.deepEqual(await fs.readdir(path.join(partial, 'assets/animejs')), ['scenes.js']);
});

test('installer rejects symlinks in project, assets, pack and installed files without writing outside', async t => {
  const root = await temporary(t);
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'protected.txt'), 'original');
  const linkedRoot = path.join(root, 'linked-project');
  await fs.symlink(outside, linkedRoot);
  await assert.rejects(installComponents(linkedRoot), /Symlinks/);
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  await fs.symlink(outside, path.join(project, 'assets'));
  await assert.rejects(installComponents(project), /symlinks/);
  await fs.unlink(path.join(project, 'assets'));
  await fs.mkdir(path.join(project, 'assets'));
  await fs.symlink(outside, path.join(project, 'assets/animejs'));
  await assert.rejects(installComponents(project), /symlinks/);
  await fs.unlink(path.join(project, 'assets/animejs'));
  const installed = await installComponents(project);
  await fs.unlink(path.join(installed.directory, 'scenes.js'));
  await fs.symlink(path.join(outside, 'protected.txt'), path.join(installed.directory, 'scenes.js'));
  await assert.rejects(installComponents(project), /Symlinks/);
  assert.deepEqual(await fs.readdir(outside), ['protected.txt']);
  assert.equal(await fs.readFile(path.join(outside, 'protected.txt'), 'utf8'), 'original');
});
