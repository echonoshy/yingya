import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initProject, buildPreview, validateBuild, readConfig, renderProject} from '../runtime/remotion/engine.mjs';

test('Remotion snapshots detect source/asset/preview edits and work after relocation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yingya-remotion-unit-'));
  try {
    await initProject(root, {width:320,height:180,duration:1});
    await validateBuild(root);
    await assert.rejects(initProject(root), /never overwrites/);
    await writeFile(path.join(root,'assets/image.svg'), '<svg/>');
    await assert.rejects(validateBuild(root), /stale/);
    await buildPreview(root); await validateBuild(root);
    await writeFile(path.join(root,'assets/remotion-preview.js'), 'wrong bundle');
    await assert.rejects(validateBuild(root), /changed/);
    await buildPreview(root);
    await writeFile(path.join(root,'src/Video.tsx'), 'invalid typescript <<');
    await assert.rejects(buildPreview(root));
  } finally {await rm(root,{recursive:true,force:true});}
});

test('engine config fails closed on unknown marker, escape, symlink and FPS changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yingya-remotion-config-'));
  try {
    await initProject(root,{width:320,height:180,duration:1});
    await assert.rejects(renderProject(root,path.join(root,'output.mp4'),{fps:60}), /FPS/);
    const file = path.join(root,'remotion.json');
    const config = JSON.parse(await readFile(file));
    await writeFile(file,JSON.stringify({...config,engine:'unknown'}));
    await assert.rejects(readConfig(root), /configuration/);
    await writeFile(file,JSON.stringify({...config,entry:'../outside.tsx'}));
    await assert.rejects(readConfig(root), /Unsafe/);
    await symlink('/etc/hosts',path.join(root,'src/outside.tsx'));
    await writeFile(file,JSON.stringify({...config,entry:'src/outside.tsx'}));
    await assert.rejects(readConfig(root), /escapes/);
  } finally {await rm(root,{recursive:true,force:true});}
});
