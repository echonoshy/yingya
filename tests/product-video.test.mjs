import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
const builder=path.resolve('runtime/product-video/build.mjs');
const run=(project,...args)=>spawnSync(process.execPath,[builder,'--project',project,...args],{encoding:'utf8'});

test('product source respects project ratio, supports rebuilding a scoped change and protects custom edits',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'yingya-product-'));
 try {
  const seeded=run(root,'--example','product-intro','--aspect-ratio','9:16');
  assert.equal(seeded.status,0,seeded.stderr);
  let html=await readFile(path.join(root,'index.html'),'utf8');
  assert.match(html,/data-width="720" data-height="1280"/);
  const scenes=JSON.parse(await readFile(path.join(root,'scenes.json')));
  scenes[1].onScreenText='这次只修改第二镜';
  await writeFile(path.join(root,'scenes.json'),JSON.stringify(scenes));
  await writeFile(path.join(root,'.yingya/manifest.json'),JSON.stringify({outputSpec:{aspectRatio:'1:1'}}));
  const rebuilt=run(root);assert.equal(rebuilt.status,0,rebuilt.stderr);
  html=await readFile(path.join(root,'index.html'),'utf8');
  assert.match(html,/data-width="1080" data-height="1080"/);
  assert.match(html,/这次只修改第二镜/);
  assert.match(html,/把内容，做成视频/);
  const custom=html.replace('这次只修改第二镜','人工调整的布局');
  await writeFile(path.join(root,'index.html'),custom);
  assert.notEqual(run(root).status,0);
  assert.equal(await readFile(path.join(root,'index.html'),'utf8'),custom);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('product source refuses unmeasured audio and escaping asset paths',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'yingya-product-'));
 try{
  assert.equal(run(root,'--example','feature-launch').status,0);
  const assets=JSON.parse(await readFile(path.join(root,'assets.json')));
  assets[0].mediaType='audio/wav';
  await writeFile(path.join(root,'assets.json'),JSON.stringify(assets));
  const missingDuration=run(root);assert.notEqual(missingDuration.status,0);assert.match(missingDuration.stderr,/measured durationSeconds/);
  assets[0].hyperframesPath='../external.png';
  await writeFile(path.join(root,'assets.json'),JSON.stringify(assets));
  const escaped=run(root);assert.notEqual(escaped.status,0);assert.match(escaped.stderr,/stay in project/);
 }finally{await rm(root,{recursive:true,force:true});}
});
