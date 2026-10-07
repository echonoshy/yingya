import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, cp, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {nativeCatalog, installNative, viewNative} from '../runtime/component-library.mjs';
import {initProject, buildPreview, serveProject, browserPath} from '../runtime/remotion/engine.mjs';
const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname, '..');

test('native catalog installs editable source without network or overwriting project edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'yingya-native-install-'));
  const catalog = await nativeCatalog();
  assert.equal(catalog.length, 6);
  for (const item of catalog) {
    const detail = await viewNative(item.id);
    assert.equal(detail.export, item.export);
    const result = await installNative({project:root, component:item.id});
    assert.equal(result.source, 'src/yingya-explain.tsx');
  }
  await writeFile(path.join(root, 'src/yingya-explain.tsx'), '// project edit');
  await assert.rejects(installNative({project:root, component:'explain-process'}), /project edits/);
  assert.equal(await readFile(path.join(root, 'src/yingya-explain.tsx'), 'utf8'), '// project edit');
  await assert.rejects(installNative({project:root, component:'../../escape'}), /Unknown native/);
});

test('six native scenes and captions seek deterministically and render through the durable runner', {timeout:180000}, async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'yingya-native-scenes-'));
  const project = path.join(scratch, 'project');
  await initProject(project, {width:640,height:360,fps:10,duration:12});
  await installNative({project,component:'explain-process'});
  await writeFile(path.join(project,'src/Video.tsx'), `import React from 'react';
import {Sequence, useCurrentFrame} from 'remotion';
import {ExplainConcept,ExplainProcess,ExplainComparison,ExplainDataChange,ExplainCausality,ExplainFootage,SentenceCaptions} from './yingya-explain';
const theme={fontSize:18,fontFamily:'sans-serif'};
const items=[{id:'one',label:'观察',detail:'记录现象'},{id:'two',label:'解释',detail:'对照证据'}];
export default function Film(){const f=useCurrentFrame();return <>
<div style={{position:'absolute',inset:0,background:'#fff'}}/>
<Sequence from={0} durationInFrames={20}><ExplainConcept theme={theme} title="概念" subject="水循环" items={items}/></Sequence>
<Sequence from={20} durationInFrames={20}><ExplainProcess theme={theme} title="过程" items={items}/></Sequence>
<Sequence from={40} durationInFrames={20}><ExplainComparison theme={theme} title="对比" labels={['之前','之后']} rows={[{id:'water',label:'形态',left:'液态水',right:'水蒸气'}]}/></Sequence>
<Sequence from={60} durationInFrames={20}><ExplainDataChange theme={theme} title="数值测试" unit="℃" domain={[-10,20]} items={[{id:'cold',label:'低温',value:-5},{id:'warm',label:'升温',value:15}]}/></Sequence>
<Sequence from={80} durationInFrames={20}><ExplainCausality theme={theme} title="因果" cause="加热" mechanism="吸收热量" effect="蒸发加快"/></Sequence>
<Sequence from={100} durationInFrames={20}><div style={{position:'absolute',left:'20%',top:'20%',width:'30%',height:'30%',background:'#81c8d0'}}/><ExplainFootage theme={theme} label="聚焦区域测试" focus={{x:.2,y:.2,width:.3,height:.3}}/></Sequence>
<SentenceCaptions captions={[{text:'第一句字幕',startMs:500,endMs:1500},{text:'第二句字幕',startMs:2000,endMs:2800}]} style={{fontSize:16,color:'#111',textShadow:'none'}}/>
<span id="frame" style={{position:'absolute',right:5,top:5,fontSize:10}}>{f}</span></>}
`);
  await buildPreview(project);
  const snapshot = path.join(scratch, 'snapshot');
  await cp(project,snapshot,{recursive:true});
  const server = await serveProject(snapshot);
  const browser = await chromium.launch({executablePath:browserPath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const page = await browser.newPage({viewport:{width:960,height:540}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(()=>!!window.__yingyaRemotionPlayer);
    async function seek(frame) {
      await page.evaluate(f=>window.__yingyaRemotionPlayer.seekTo(f),frame);
      await page.waitForFunction(f=>document.querySelector('#frame')?.textContent===String(f),frame);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    }
    await seek(10);
    assert.equal(await page.locator('[data-yingya-caption]').innerText(),'第一句字幕');
    await seek(15);assert.equal(await page.locator('[data-yingya-caption]').count(),0);
    await seek(25);assert.equal(await page.locator('[data-yingya-caption]').innerText(),'第二句字幕');
    for (const frame of [15,35,55,75,95,115]) {
      await seek(frame);const direct=await page.screenshot({path:path.join(scratch,`frame-${frame}.png`)});
      await seek(119);await seek(frame);const backward=await page.screenshot();
      assert.deepEqual(backward,direct,`backward seek differs at ${frame}`);
      await seek(frame);assert.deepEqual(await page.screenshot(),direct,`repeated seek differs at ${frame}`);
    }
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await server.close();}
  const {stdout} = await exec('python3',[path.join(repo,'runtime/production-task.py'),'render','--project',snapshot,
    '--request-id','native-scenes-test','--output','renders/native.mp4','--fps','10','--quality','draft','--resolution','landscape'],
    {env:{...process.env,YINGYA_NODE_MODULES:path.join(repo,'node_modules')},timeout:120000,maxBuffer:2000000});
  const result=JSON.parse(stdout.trim().split('\n').at(-1));assert.equal(result.status,'succeeded');
  const report=JSON.parse(await readFile(path.join(snapshot,result.renderVerification)));
  assert.equal(report.ok,true);
  await mkdir(path.join(repo,'.runtime/skill-refresh-evidence'),{recursive:true});
  await writeFile(path.join(repo,'.runtime/skill-refresh-evidence/native-test.json'),JSON.stringify({scratch,...result},null,2));
  console.log('Native scene snapshots and verified MP4:',scratch);
});
