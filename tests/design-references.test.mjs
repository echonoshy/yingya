// Offline integrity checks for the release-owned, progressively loaded design pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skill = path.resolve(fileURLToPath(new URL('../skills/yingya-video-agent/', import.meta.url)));
const design = path.join(skill, 'references/design');
const provenance = JSON.parse(await readFile(path.join(design, 'PROVENANCE.json'), 'utf8'));

test('vendored design references retain pinned source bytes, attribution and complete inventory', async () => {
  const recorded = new Set();
  for (const source of provenance.sources) {
    assert.match(source.repository, /^https:\/\/github\.com\/[^/]+\/[^/]+$/);
    assert.match(source.commit, /^[a-f0-9]{40}$/);
    assert.ok(source.files.some(file => file.localPath === source.licensePath), 'license is part of the hashed inventory');
    for (const file of source.files) {
      assert.equal(recorded.has(file.localPath), false, 'source paths must be unambiguous');
      recorded.add(file.localPath);
      assert.ok(!file.upstreamPath.startsWith('/') && !file.upstreamPath.split('/').includes('..'));
      const resolved = path.resolve(design, file.localPath);
      assert.ok(resolved.startsWith(path.join(design, 'references') + path.sep));
      assert.equal((await lstat(resolved)).isSymbolicLink(), false);
      assert.ok((await realpath(resolved)).startsWith(await realpath(design) + path.sep));
      assert.equal(createHash('sha256').update(await readFile(resolved)).digest('hex'), file.sha256, file.localPath);
    }
    const license = await readFile(path.join(design, source.licensePath), 'utf8');
    assert.ok(license.includes('Copyright') && license.includes('Permission'), 'full upstream license is retained');
  }
  async function inventory(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await inventory(full);
      else {
        assert.ok(entry.isFile(), 'release reference bundles contain regular files only');
        assert.ok(recorded.delete(path.relative(design, full)), 'no unattributed reference assets');
      }
    }
  }
  await inventory(path.join(design, 'references'));
  assert.equal(recorded.size, 0, 'every provenance entry is packaged');
});

test('design routes have resolvable local links, including upstream reference dependencies', async () => {
  const queued = [path.join(skill, 'SKILL.md')];
  const visited = new Set();
  while (queued.length) {
    const file = queued.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    // Code examples contain project artifact links, not bundled skill resources.
    const body = (await readFile(file, 'utf8'))
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`\n]*`/g, '');
    for (const match of body.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1];
      if (/^(?:https?:|#)/.test(link)) continue;
      const destination = path.resolve(path.dirname(file), link.split('#')[0]);
      assert.ok(destination.startsWith(skill + path.sep), `reference escapes skill: ${link}`);
      assert.ok((await lstat(destination)).isFile(), `${file}: ${link}`);
      if (destination.endsWith('.md')) queued.push(destination);
    }
  }
  for (const source of provenance.sources) {
    for (const file of source.files.filter(file => file.localPath.endsWith('.md'))) {
      assert.ok(visited.has(path.join(design, file.localPath)), `reference is unreachable: ${file.localPath}`);
    }
  }
});
