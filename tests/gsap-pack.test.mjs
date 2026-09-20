import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { install } from '../skills/yingya-video-agent/scripts/install-gsap.mjs';

const skill = fileURLToPath(new URL('../skills/yingya-video-agent/', import.meta.url));

test('CLI help succeeds without a project or filesystem writes', async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), 'yingya-gsap-help-'));
  try {
    execFileSync(process.execPath, [path.join(skill, 'scripts/install-gsap.mjs'), '--help'], { cwd: empty });
    assert.deepEqual(await readdir(empty), []);
  } finally { await rm(empty, { recursive: true, force: true }); }
});

test('official references and offline runtime match their complete pinned inventories', async () => {
  for (const directory of ['references/gsap', 'assets/gsap']) {
    const root = path.join(skill, directory);
    const manifest = JSON.parse(await readFile(path.join(root, 'PROVENANCE.json'), 'utf8'));
    if (manifest.commit) assert.match(manifest.commit, /^[a-f0-9]{40}$/);
    else { assert.equal(manifest.version, '3.14.2'); assert.match(manifest.integrity, /^sha512-/); }
    const expected = [];
    for (const file of manifest.files) {
      const data = await readFile(path.join(root, file.localPath));
      assert.equal(createHash('sha256').update(data).digest('hex'), file.sha256, file.localPath);
      expected.push(path.basename(file.localPath));
    }
    const actual = await readdir(path.join(root, manifest.commit ? 'upstream' : '.'));
    assert.deepEqual(actual.filter(name => name !== 'PROVENANCE.json').sort(), expected.sort());
  }
});

test('offline install selects plugins, extends idempotently, and preserves project edits', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'yingya-gsap-'));
  try {
    await writeFile(path.join(project, 'index.html'), 'existing project');
    const result = await install(project, ['SplitText']);
    assert.deepEqual(result.scripts.map(file => path.basename(file)), ['gsap.min.js', 'SplitText.min.js']);
    const target = path.join(project, path.dirname(result.scripts[0]));
    assert.equal((await readdir(target)).includes('MotionPathPlugin.min.js'), false);
    await install(project, ['SplitText', 'MotionPathPlugin']);
    await install(project, ['SplitText', 'MotionPathPlugin']);
    assert.equal(await readFile(path.join(project, 'index.html'), 'utf8'), 'existing project');
    await writeFile(path.join(target, 'SplitText.min.js'), 'user edit');
    await assert.rejects(install(project, ['DrawSVGPlugin', 'SplitText']), /Refusing to overwrite/);
    assert.equal(await readFile(path.join(target, 'SplitText.min.js'), 'utf8'), 'user edit');
    assert.equal((await readdir(target)).includes('DrawSVGPlugin.min.js'), false, 'conflicting install does not copy earlier files');
    await assert.rejects(install(project, ['ScrollTrigger']), /Unsupported bundled plugin/);
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('installer refuses linked destinations instead of writing outside a project', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'yingya-gsap-links-'));
  try {
    await mkdir(path.join(project, 'outside'));
    await symlink(path.join(project, 'outside'), path.join(project, 'assets'));
    await assert.rejects(install(project), /real directory/);
    assert.deepEqual(await readdir(path.join(project, 'outside')), []);
  } finally { await rm(project, { recursive: true, force: true }); }
});
