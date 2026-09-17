#!/usr/bin/env node
// A scene edit is a recoverable multi-file transaction. Never call --replace.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { assembleEditorial, fileSha256, projectPath, validateScenes, normalizeRequirements } from './assemble.mjs';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const STATE = '.yingya/editorial-edit';
const MARKER = 'yingya-editorial:v1';
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

async function optionalHash(file) {
  try { return await fileSha256(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

function safeTarget(name) {
  return ['scenes.json', 'index.html', 'index.motion.json', 'source-bindings.json'].includes(name) || name.startsWith('assets/editorial/');
}

async function restoreTransaction(root, journal) {
  // Inspect all targets before recovery. Unexpected external edits must never be
  // overwritten by an old recovery record.
  for (const item of journal.operations) {
    if (!safeTarget(item.target)) fail('RECOVERY_REQUIRED', 'Unsafe recovery target');
    const target = await projectPath(root, item.target, { mustExist: false });
    const current = await optionalHash(target);
    if (current !== item.before && current !== item.after) fail('RECOVERY_REQUIRED', `A transaction file was independently edited: ${item.target}`);
  }
  const completed = (await Promise.all(journal.operations.map(async item => await optionalHash(await projectPath(root, item.target, { mustExist: false })) === item.after))).every(Boolean);
  if (completed && journal.phase !== 'rolling-back') return;
  for (const item of [...journal.operations].reverse()) {
    const target = await projectPath(root, item.target, { mustExist: false });
    if (await optionalHash(target) === item.before) continue;
    if (item.before === null) await fs.rm(target, { force: true });
    else {
      const backup = await projectPath(root, item.backup);
      if (await fileSha256(backup) !== item.before) fail('RECOVERY_REQUIRED', `Recovery backup changed: ${item.target}`);
      // Only changed source files are backed up; unchanged video bytes never
      // enter this operation list or an in-memory buffer.
      const temporary = `${target}.${crypto.randomUUID()}.tmp`;
      await fs.copyFile(backup, temporary);
      await fs.rename(temporary, target);
    }
  }
}

async function recover(root, state) {
  const journalFile = path.join(state, 'transaction.json');
  let journal;
  try { journal = JSON.parse(await fs.readFile(journalFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (journal.schemaVersion !== 1 || !Array.isArray(journal.operations)) fail('RECOVERY_REQUIRED', 'Invalid scene edit journal');
  await restoreTransaction(root, journal);
  const work = await projectPath(root, journal.work);
  if (!work.startsWith(`${state}${path.sep}work-`)) fail('RECOVERY_REQUIRED', 'Invalid scene edit work directory');
  await fs.rm(work, { recursive: true, force: true });
  await fs.rm(journalFile);
}

async function acquireLock(root) {
  const state = await projectPath(root, STATE, { mustExist: false });
  await fs.mkdir(state, { recursive: true });
  const lockFile = await projectPath(root, `${STATE}/lock.json`, { mustExist: false });
  try {
    const handle = await fs.open(lockFile, 'wx');
    await handle.writeFile(json({ pid: process.pid, token: crypto.randomUUID() }));
    await handle.close();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let lock;
    try { lock = JSON.parse(await fs.readFile(lockFile, 'utf8')); } catch { fail('EDIT_BUSY', 'Another scene edit is initializing; retry shortly'); }
    let alive = true;
    try { process.kill(lock.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    if (alive) fail('EDIT_BUSY', 'Another scene edit is running');
    // Backend serializes edits per project. The dead lock is only taken over
    // after checking its PID; recovery happens before reading the revision.
    await fs.rm(lockFile);
    return acquireLock(root);
  }
  return { state, release: () => fs.rm(lockFile, { force: true }) };
}

export function patchScene(scenes, sceneId, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) fail('INVALID_PATCH', 'Patch must be an object');
  const allowed = new Set(['title', 'onScreenText', 'recipe', 'focus']);
  if (!Object.keys(patch).length || Object.keys(patch).some(key => !allowed.has(key))) fail('INVALID_PATCH', 'Only title/onScreenText, recipe and focus can be edited');
  if ('title' in patch && 'onScreenText' in patch && patch.title !== patch.onScreenText) fail('INVALID_PATCH', 'title and onScreenText disagree');
  const index = scenes.findIndex(scene => scene.id === sceneId);
  if (index < 0) fail('SCENE_NOT_FOUND', 'The requested scene does not exist');
  const updated = structuredClone(scenes);
  if ('title' in patch || 'onScreenText' in patch) updated[index].onScreenText = patch.title ?? patch.onScreenText;
  if ('recipe' in patch) updated[index].recipe = patch.recipe;
  if ('focus' in patch) {
    if (patch.focus === null) delete updated[index].sourceClip.focus;
    else updated[index].sourceClip.focus = structuredClone(patch.focus);
  }
  try { validateScenes(updated); } catch (error) { fail('INVALID_PATCH', error.message); }
  return updated;
}

async function verifyOwned(root, revision) {
  let bindings;
  try { bindings = JSON.parse(await fs.readFile(await projectPath(root, 'source-bindings.json'), 'utf8')); }
  catch { fail('MANUAL_EDIT_CONFLICT', 'Only an existing editorial-owned root composition can be edited here'); }
  if (bindings.generator !== MARKER || bindings.scenesSha256 !== revision || !bindings.generatedFiles?.['index.html']) fail('MANUAL_EDIT_CONFLICT', 'The scene source and owned composition are out of sync; preserve or restore the current work before editing');
  for (const [name, expected] of Object.entries(bindings.generatedFiles)) {
    if (!safeTarget(name) || await optionalHash(await projectPath(root, name, { mustExist: false })) !== expected) fail('MANUAL_EDIT_CONFLICT', `Generated file was edited or removed: ${name}. Preserve the manual edit; automatic reassembly is unavailable`);
  }
  return bindings;
}

export async function editScene({ project, sceneId, expectedRevision, patch, _testAfterWrite }) {
  const root = await fs.realpath(project);
  if (!/^[a-f0-9]{64}$/.test(expectedRevision ?? '')) fail('INVALID_PATCH', 'expectedRevision must be the raw scenes.json SHA256');
  const lock = await acquireLock(root);
  let work, journal, journalFile;
  try {
    await recover(root, lock.state);
    const sceneFile = await projectPath(root, 'scenes.json');
    const before = await fs.readFile(sceneFile);
    if (hash(before) !== expectedRevision) fail('REVISION_CONFLICT', 'Scenes changed since they were read; refresh the scene list');
    const previous = await verifyOwned(root, expectedRevision);
    let scenes;
    try { scenes = JSON.parse(before); } catch { fail('INVALID_PATCH', 'scenes.json is not valid JSON'); }
    const nextScenes = patchScene(scenes, sceneId, patch);
    if (JSON.stringify(nextScenes) === JSON.stringify(scenes)) return { ok: true, changedSceneIds: [], summary: '镜头没有变化', scenesRevision: expectedRevision, entry: 'index.html', bindings: 'source-bindings.json' };
    const nextBytes = Buffer.from(json(nextScenes)), nextRevision = hash(nextBytes);
    work = await fs.mkdtemp(path.join(lock.state, 'work-'));
    const newDir = path.join(work, 'new');
    await assembleEditorial({ project: root, out: path.relative(root, newDir), inputBytes: nextBytes, width: previous.canvas.width, height: previous.canvas.height, fps: previous.canvas.fps });
    const nextBindings = JSON.parse(await fs.readFile(path.join(newDir, 'source-bindings.json'), 'utf8'));
    if (JSON.stringify(normalizeRequirements(previous.requirements ?? {})) !== JSON.stringify(nextBindings.requirements)) fail('MANUAL_EDIT_CONFLICT', 'Project requirements changed since assembly; a single-scene edit cannot alter the entire film');
    for (const oldScene of previous.scenes) {
      const next = nextBindings.scenes.find(item => item.id === oldScene.id);
      if (!next) fail('MANUAL_EDIT_CONFLICT', 'A bound scene is missing from the scene source');
      for (const field of ['sourceIn', 'sourceOut', 'startSeconds', 'durationSeconds', 'audioMode']) if (next[field] !== oldScene[field]) fail('MANUAL_EDIT_CONFLICT', `The source interval or audio changed for ${oldScene.id}; single-scene editing cannot publish it`);
      if (next.source.sha256 !== oldScene.source.sha256 || next.source.originalPath !== oldScene.source.originalPath) fail('MANUAL_EDIT_CONFLICT', `The source media changed for ${oldScene.id}; reanalyze it before editing`);
      if (oldScene.id !== sceneId && ['title', 'recipe', 'focus', 'overview'].some(field => JSON.stringify(next[field]) !== JSON.stringify(oldScene[field]))) fail('MANUAL_EDIT_CONFLICT', `Another scene changed: ${oldScene.id}`);
    }
    await fs.writeFile(path.join(newDir, 'scenes.json'), nextBytes);
    // Recheck both the optimistic scene revision and every owned output after
    // potentially expensive probing/copying. Nothing live has changed yet.
    if (await fileSha256(sceneFile) !== expectedRevision) fail('REVISION_CONFLICT', 'Scenes changed while preparing the edit; no edit was published');
    await verifyOwned(root, expectedRevision);
    const targets = [...Object.keys(nextBindings.generatedFiles).filter(name => !['index.html', 'source-bindings.json'].includes(name)), 'scenes.json', 'index.html', 'source-bindings.json'];
    const operations = [];
    for (const name of targets) {
      const target = await projectPath(root, name, { mustExist: false });
      const oldHash = await optionalHash(target), newHash = await fileSha256(path.join(newDir, name));
      if (oldHash === newHash) continue;
      if (oldHash && !previous.generatedFiles[name] && !['scenes.json', 'source-bindings.json'].includes(name)) fail('MANUAL_EDIT_CONFLICT', `An unrelated file would be overwritten: ${name}`);
      const backup = path.join(work, 'backup', name);
      if (oldHash) { await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.copyFile(target, backup); }
      operations.push({ target: name, before: oldHash, after: newHash, backup: oldHash ? path.relative(root, backup) : null, next: path.relative(root, path.join(newDir, name)) });
    }
    journalFile = path.join(lock.state, 'transaction.json');
    journal = { schemaVersion: 1, phase: 'committing', work: path.relative(root, work), beforeRevision: expectedRevision, afterRevision: nextRevision, operations };
    await atomicWrite(journalFile, json(journal));
    let writes = 0;
    for (const item of operations) {
      const target = await projectPath(root, item.target, { mustExist: false });
      if (await optionalHash(target) !== item.before) fail('REVISION_CONFLICT', `A file changed during edit publication: ${item.target}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(await projectPath(root, item.next), target);
      if (_testAfterWrite) await _testAfterWrite(++writes);
    }
    journal.phase = 'committed';
    await atomicWrite(journalFile, json(journal));
    await fs.rm(journalFile);
    journal = null;
    return { ok: true, changedSceneIds: [sceneId], summary: '已更新这个镜头，保留其他镜头和全部素材区间', scenesRevision: nextRevision, entry: 'index.html', bindings: 'source-bindings.json', warnings: nextBindings.warnings, requiredAudioWork: nextBindings.requiredAudioWork };
  } catch (error) {
    if (journal) {
      journal.phase = 'rolling-back';
      await atomicWrite(journalFile, json(journal));
      try { await restoreTransaction(root, journal); await fs.rm(journalFile); journal = null; }
      catch (recoveryError) { fail('RECOVERY_REQUIRED', `${error.message}; rollback requires recovery: ${recoveryError.message}`); }
    }
    if (!error.code || !['REVISION_CONFLICT', 'MANUAL_EDIT_CONFLICT', 'INVALID_PATCH', 'SCENE_NOT_FOUND', 'RECOVERY_REQUIRED', 'EDIT_BUSY'].includes(error.code)) error.code = 'ASSEMBLY_FAILED';
    throw error;
  } finally {
    if (work && !journal) await fs.rm(work, { recursive: true, force: true });
    await lock.release();
  }
}

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    const flag = process.argv[i];
    if (!['--project', '--scene-id', '--expected-revision', '--patch-json', '--patch-file'].includes(flag) || !process.argv[i + 1]) fail('INVALID_PATCH', `Unknown or incomplete flag: ${flag}`);
    args[flag.slice(2)] = process.argv[++i];
  }
  if (!args.project || !args['scene-id'] || Boolean(args['patch-json']) === Boolean(args['patch-file'])) fail('INVALID_PATCH', 'Provide project, scene-id, expected-revision and exactly one patch input');
  const root = await fs.realpath(args.project);
  const bytes = args['patch-json'] ?? await fs.readFile(await projectPath(root, args['patch-file']), 'utf8');
  if (Buffer.byteLength(bytes) > 16384) fail('INVALID_PATCH', 'Patch exceeds 16 KiB');
  let patch;
  try { patch = JSON.parse(bytes); } catch { fail('INVALID_PATCH', 'Patch is not valid JSON'); }
  console.log(json(await editScene({ project: root, sceneId: args['scene-id'], expectedRevision: args['expected-revision'], patch })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(json({ ok: false, code: error.code ?? 'ASSEMBLY_FAILED', error: error.message })); process.exitCode = 1; });
