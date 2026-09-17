import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateScenes, assembleEditorial, projectPath, fileSha256, recipeCatalog } from '../runtime/editorial/assemble.mjs';
import { cameraAt, focusCamera } from '../runtime/editorial/camera.mjs';
import { editScene } from '../runtime/editorial/edit-scene.mjs';

function scene(id = 'search') {
  return { id, recipe: 'screen-focus', onScreenText: '搜索已有素材', sourceClip: { source: 'source.mp4', sourceIn: 0, sourceOut: 4, focus: { anchor: { x: .7, y: .1 }, zoom: 2 } } };
}

test('scene contract preserves source intervals and default audio, rejects silent retiming and discontinuity', () => {
  const clips = validateScenes([scene(), scene('select')]);
  assert.deepEqual(clips.map(s => [s.startSeconds, s.durationSeconds, s.audioMode]), [[0, 4, 'preserve'], [4, 4, 'preserve']]);
  assert.throws(() => validateScenes([{ ...scene(), durationSeconds: 8 }]), /only 1x/);
  assert.throws(() => validateScenes([scene(), { ...scene('select'), startSeconds: 5 }]), /gaps and overlaps/);
  assert.throws(() => validateScenes([scene(), scene()]), /unique stable/);
  assert.throws(() => validateScenes([{ ...scene(), sourceClip: { ...scene().sourceClip, sourceOut: -1 } }]), /sourceOut/);
  const brief = validateScenes([{ ...scene(), recipe: 'screen-overview', sourceClip: { ...scene().sourceClip, sourceOut: 0.1 } }])[0];
  assert.equal(brief.durationSeconds, .1);
  assert.deepEqual(cameraAt(brief, .05), { x: 0, y: 0, scale: 1 });
});

test('camera evaluation is independent of seek order with exact overview endpoints and bounded focus', () => {
  const clip = validateScenes([scene()])[0];
  const baseline = new Map([0, .1, 1, 2.3, 3.7, 4].map(t => [t, cameraAt(clip, t)]));
  for (const t of [4, 2.3, .1, 0, 3.7, 1, 0, 2.3]) assert.deepEqual(cameraAt(clip, t), baseline.get(t));
  assert.deepEqual(cameraAt(clip, 0), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(cameraAt(clip, 4), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(focusCamera({ anchor: { x: 1, y: 0 }, zoom: 3 }), { x: -100, y: 100, scale: 3 });
  assert.throws(() => validateScenes([{ ...scene(), sourceClip: { ...scene().sourceClip, focus: { rect: { x: .9, y: .2, width: .2, height: .2 } } } }]), /inside source/);
});

test('project paths reject traversal, absolute paths and symlink escapes', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yingya-editorial-paths-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.symlink(os.tmpdir(), path.join(root, 'escape'));
  await assert.rejects(projectPath(root, '../outside'), /without traversal/);
  await assert.rejects(projectPath(root, '/tmp/outside'), /relative/);
  await assert.rejects(projectPath(root, 'escape/file', { mustExist: false }), /Symlinks/);
});

test('catalog recipes have distinct camera or annotation behavior and enforce observed focus shapes', () => {
  assert.deepEqual(recipeCatalog.recipes.map(r => r.id), ['screen-overview', 'screen-focus', 'screen-highlight', 'screen-callout', 'screen-result']);
  const base = scene();
  base.sourceClip.sourceOut = 8;
  const focus = validateScenes([base])[0];
  const result = validateScenes([{ ...base, recipe: 'screen-result' }])[0];
  assert.ok(cameraAt(focus, 3).scale > 1);
  assert.equal(cameraAt(result, 3).scale, 1);
  assert.equal(cameraAt(focus, 8).scale, 1);
  assert.ok(cameraAt(result, 8).scale > 1);
  assert.throws(() => validateScenes([{ ...base, recipe: 'screen-highlight' }]), /focus rectangle/);
  const marked = validateScenes([{ ...base, recipe: 'screen-highlight', sourceClip: { ...base.sourceClip, focus: { rect: { x: .6, y: .02, width: .2, height: .1 } } } }])[0];
  assert.equal(cameraAt(marked, 3).scale, 1);
});

test('single-scene edits are revision checked, rollback on commit failure, and retain source/other scenes/evidence', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yingya-editorial-edit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', path.join(root, 'source.mp4')]);
  const scenes = [scene(), { ...scene('select'), evidence: { observedAction: '勾选素材', sourceTimestampSeconds: 2, confidence: 'observed' } }];
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify(scenes));
  await assembleEditorial({ project: root });
  const revision = await fileSha256(path.join(root, 'scenes.json'));
  const originalBindings = JSON.parse(await fs.readFile(path.join(root, 'source-bindings.json')));
  const original = await Promise.all(['scenes.json', 'index.html', 'source-bindings.json'].map(name => fs.readFile(path.join(root, name))));
  await assert.rejects(editScene({ project: root, sceneId: 'select', expectedRevision: '0'.repeat(64), patch: { title: '修改' } }), e => e.code === 'REVISION_CONFLICT');
  await assert.rejects(editScene({ project: root, sceneId: 'select', expectedRevision: revision, patch: { sourceIn: 1 } }), e => e.code === 'INVALID_PATCH');
  await assert.rejects(editScene({ project: root, sceneId: 'select', expectedRevision: revision, patch: { recipe: 'screen-highlight' } }), e => e.code === 'INVALID_PATCH');
  await assert.rejects(editScene({ project: root, sceneId: 'select', expectedRevision: revision, patch: { title: '新的文字' }, _testAfterWrite: count => { if (count === 2) throw new Error('simulated filesystem failure'); } }), /simulated filesystem/);
  for (const [index, name] of ['scenes.json', 'index.html', 'source-bindings.json'].entries()) assert.deepEqual(await fs.readFile(path.join(root, name)), original[index]);
  const edited = await editScene({ project: root, sceneId: 'select', expectedRevision: revision, patch: { title: '选定已有素材', recipe: 'screen-callout' } });
  assert.deepEqual(edited.changedSceneIds, ['select']);
  assert.notEqual(edited.scenesRevision, revision);
  const changed = JSON.parse(await fs.readFile(path.join(root, 'scenes.json')));
  assert.deepEqual(changed[0], scenes[0]);
  assert.deepEqual(changed[1].sourceClip, scenes[1].sourceClip);
  assert.deepEqual(changed[1].evidence, scenes[1].evidence);
  const nextBindings = JSON.parse(await fs.readFile(path.join(root, 'source-bindings.json')));
  assert.deepEqual(nextBindings.scenes[0], originalBindings.scenes[0]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, nextBindings.scenesFile)))[1].evidence, scenes[1].evidence);
  await fs.appendFile(path.join(root, 'index.html'), '<!-- Studio edit -->');
  const manual = await fs.readFile(path.join(root, 'index.html'));
  await assert.rejects(editScene({ project: root, sceneId: 'select', expectedRevision: edited.scenesRevision, patch: { title: '禁止覆盖' } }), e => e.code === 'MANUAL_EDIT_CONFLICT');
  assert.deepEqual(await fs.readFile(path.join(root, 'index.html')), manual);
});

test('requirements alter real output: mute, no added caption and exact/max guards; unmet audio work stays explicit', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yingya-editorial-req-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', path.join(root, 'source.mp4')]);
  await fs.mkdir(path.join(root, '.yingya'));
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify([scene()]));
  const requirements = { audioMode: 'mute', subtitles: 'none', durationMode: 'exact', targetDurationSeconds: 4 };
  await fs.writeFile(path.join(root, '.yingya/requirements.json'), JSON.stringify(requirements));
  const result = await assembleEditorial({ project: root });
  const html = await fs.readFile(result.entry, 'utf8');
  assert.equal(result.overlayCaptionHidden, true);
  assert.doesNotMatch(html, /<audio\b|class="editorial-caption"|id="search-title"/);
  assert.equal(JSON.parse(await fs.readFile(result.bindings)).scenes[0].audioMode, 'mute');
  await fs.writeFile(path.join(root, '.yingya/requirements.json'), JSON.stringify({ ...requirements, targetDurationSeconds: 3 }));
  await assert.rejects(assembleEditorial({ project: root, out: 'invalid' }), /exact requested duration/);
  await fs.writeFile(path.join(root, '.yingya/requirements.json'), JSON.stringify({ ...requirements, durationMode: 'max', targetDurationSeconds: 3 }));
  await assert.rejects(assembleEditorial({ project: root, out: 'invalid' }), /maximum requested duration/);
  await fs.writeFile(path.join(root, '.yingya/requirements.json'), JSON.stringify({ audioMode: 'replace', music: 'on' }));
  const pending = await assembleEditorial({ project: root, out: 'pending' });
  assert.deepEqual(pending.requiredAudioWork.map(item => item.role), ['replacement', 'music']);
  assert.doesNotMatch(await fs.readFile(pending.entry, 'utf8'), /<audio\b/);
  assert.equal(pending.warnings.length, 2);
});

test('assembly binds real audio/video, survives title-only rebuild, protects edits and validates source bounds', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yingya-editorial-build-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-y', path.join(root, 'source.mp4')]);
  const scenes = [scene(), { ...scene('select'), onScreenText: '选择素材', sourceClip: { ...scene().sourceClip, sourceIn: 1, sourceOut: 5 } }];
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify(scenes));
  const first = await assembleEditorial({ project: root, out: 'film' });
  assert.equal(first.durationSeconds, 8);
  const bindings = JSON.parse(await fs.readFile(first.bindings));
  const html = await fs.readFile(first.entry, 'utf8');
  assert.match(html, /<audio id="search-audio"[^>]+data-media-start="0"/);
  assert.match(html, /<video id="select-video"[^>]+data-start="4"[^>]+data-media-start="1"/);
  assert.equal(bindings.scenes[0].source.hasAudio, true);
  assert.equal(bindings.scenes[0].audioMode, 'preserve');
  scenes[1].onScreenText = '选择 <素材> & 完成';
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify(scenes));
  await assembleEditorial({ project: root, out: 'film' });
  const revised = JSON.parse(await fs.readFile(first.bindings));
  assert.deepEqual(bindings.scenes[0], revised.scenes[0]);
  assert.deepEqual(bindings.scenes.map(s => [s.sourceIn, s.sourceOut]), revised.scenes.map(s => [s.sourceIn, s.sourceOut]));
  assert.match(await fs.readFile(first.entry, 'utf8'), /选择 &lt;素材&gt; &amp; 完成/);
  await fs.appendFile(first.entry, '\n<!-- user edit -->');
  await assert.rejects(assembleEditorial({ project: root, out: 'film' }), /edited or removed/);
  await assembleEditorial({ project: root, out: 'film', replace: true });
  await fs.writeFile(path.join(root, 'index.html'), '<html>existing user film</html>');
  await assert.rejects(assembleEditorial({ project: root }), /not a verified editorial output/);
  scenes[1].sourceClip.sourceOut = 6;
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify(scenes));
  await assert.rejects(assembleEditorial({ project: root, out: 'fresh' }), /exceeds media duration/);
  await assert.rejects(fs.stat(path.join(root, 'fresh')), /ENOENT/);
  // MKV does not expose stream.duration; its longer audio must not expand the
  // permitted video interval. Packet ends establish the video-only boundary.
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'pcm_s16le', '-y', path.join(root, 'short-video.mkv')]);
  const short = { ...scene(), sourceClip: { ...scene().sourceClip, source: 'short-video.mkv', sourceIn: 0, sourceOut: 4 } };
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify([short]));
  await assert.rejects(assembleEditorial({ project: root, out: 'mkv' }), /exceeds media duration/);
  short.recipe = 'screen-overview';
  short.sourceClip.sourceOut = 1.9;
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify([short]));
  const mkv = await assembleEditorial({ project: root, out: 'mkv' });
  const mkvBindings = JSON.parse(await fs.readFile(mkv.bindings));
  assert.match(mkvBindings.scenes[0].source.durationBasis, /video-packet/);
  assert.ok(mkvBindings.scenes[0].source.durationSeconds < 2.1);
  await fs.mkdir(path.join(root, '.yingya'));
  await fs.writeFile(path.join(root, '.yingya/manifest.json'), JSON.stringify({ outputSpec: { aspectRatio: '9:16' } }));
  const portrait = await assembleEditorial({ project: root, out: 'portrait' });
  assert.deepEqual(JSON.parse(await fs.readFile(portrait.bindings)).canvas, { width: 720, height: 1280, fps: 30 });
  execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'source.mp4'), '-c', 'copy', '-metadata:s:v:0', 'rotate=90', '-y', path.join(root, 'rotated.mp4')]);
  short.sourceClip.source = 'rotated.mp4';
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify([short]));
  await assert.rejects(assembleEditorial({ project: root, out: 'rotated' }), /display rotation/);
  execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'source.mp4'), '-vf', 'setsar=2/1', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', path.join(root, 'sar.mp4')]);
  short.sourceClip.source = 'sar.mp4';
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify([short]));
  await assert.rejects(assembleEditorial({ project: root, out: 'sar' }), /non-square pixels/);
  execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(root, 'source.mp4'), '-c', 'copy', '-output_ts_offset', '1', '-y', path.join(root, 'offset.mp4')]);
  short.sourceClip.source = 'offset.mp4';
  await fs.writeFile(path.join(root, 'scenes.json'), JSON.stringify([short]));
  await assert.rejects(assembleEditorial({ project: root, out: 'offset' }), /non-zero video start_time/);
});
