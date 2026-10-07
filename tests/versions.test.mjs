import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {recordVersion, validateVersions} from '../scripts/versions.mjs';

const initial = () => ({
  history: {schemaVersion: 1, releases: [{version: '0.1.0', date: '2026-09-29', title: '初始版本', summary: '首个中版本说明', changes: ['建立创作流程']}]},
  manifest: {name: 'yingya', version: '0.1.0'},
  lock: {version: '0.1.0', packages: {'': {name: 'yingya', version: '0.1.0'}, 'node_modules/react': {version: '19.1.1'}}},
});
const record = (state, bump, extra = {}) => recordVersion(state.history, state.manifest, state.lock, bump, {date: '2026-09-29', changes: ['修复预览'], ...extra});

test('patch preserves earlier development records and dependencies while synchronizing all versions', () => {
  const state = initial(), next = record(state, 'patch');
  assert.equal(validateVersions(next.history, next.manifest, next.lock), '0.1.1');
  assert.equal(next.history.releases[0].summary, undefined);
  assert.deepEqual(next.history.releases[1], state.history.releases[0]);
  assert.deepEqual(next.lock.packages['node_modules/react'], state.lock.packages['node_modules/react']);
  assert.equal(state.manifest.version, '0.1.0');
});

test('minor and major reset lower numbers without requiring public introductions', () => {
  const patched = record(initial(), 'patch');
  assert.equal(record(patched, 'minor').manifest.version, '0.2.0');
  assert.equal(record(patched, 'major').manifest.version, '1.0.0');
  assert.throws(() => record(patched, 'minor', {title: '不完整说明'}), /标题和摘要/);
  const minor = record(patched, 'minor', {title: '新的进展', summary: '新增作品能力'});
  assert.equal(minor.manifest.version, '0.2.0');
  assert.equal(record(minor, 'major', {title: '正式版本', summary: '新的阶段'}).manifest.version, '1.0.0');
  assert.throws(() => record(patched, 'patch', {title: '不展示', summary: '不展示'}), /修订版本/);
});

test('invalid history and manifest drift block a build', () => {
  for (const mutate of [
    state => {state.manifest.version = '0.2.0';},
    state => {state.lock.packages[''].version = '0.2.0';},
    state => {state.history.releases.push({...state.history.releases[0]});},
    state => {state.history.releases[0].date = '2026-02-30';},
    state => {state.history.releases[0].changes = [];},
    state => {state.history.releases[0].summary = ' ';},
    state => {state.history.releases[0].version = '0.01.0'; state.manifest.version = '0.01.0'; state.lock.version = '0.01.0'; state.lock.packages[''].version = '0.01.0';},
  ]) {
    const state = initial(); mutate(state);
    assert.throws(() => validateVersions(state.history, state.manifest, state.lock));
  }
  assert.throws(() => record(initial(), 'patch', {date: '2026-09-28'}), /从新到旧/);
  const orphan = record(initial(), 'patch'); orphan.history.releases.pop();
  assert.throws(() => validateVersions(orphan.history, orphan.manifest, orphan.lock), /起始版本/);
});

test('CLI rejects incomplete records without writing and records a valid patch in all files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'yingya-versions-'));
  try {
    await mkdir(path.join(directory, 'scripts'));
    await copyFile(new URL('../scripts/versions.mjs', import.meta.url), path.join(directory, 'scripts/versions.mjs'));
    const state = initial(), files = {'versions.json': state.history, 'package.json': state.manifest, 'package-lock.json': state.lock};
    for (const [name, value] of Object.entries(files)) await writeFile(path.join(directory, name), JSON.stringify(value));
    const cli = (...args) => execFileSync('node', [path.join(directory, 'scripts/versions.mjs'), ...args], {encoding: 'utf8', stdio: 'pipe'});
    assert.throws(() => cli('record', 'patch'));
    for (const [name, value] of Object.entries(files)) assert.deepEqual(JSON.parse(await readFile(path.join(directory, name))), value);
    cli('record', 'patch', '--date', '2026-09-29', '--change', '修复导出', '--change', '修复预览');
    assert.match(cli('check'), /0\.1\.1/);
    const history = JSON.parse(await readFile(path.join(directory, 'versions.json')));
    assert.deepEqual(history.releases[0].changes, ['修复导出', '修复预览']);
  } finally {await rm(directory, {recursive: true, force: true});}
});
