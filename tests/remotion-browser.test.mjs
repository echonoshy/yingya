import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, writeFile, cp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {initProject, buildPreview, validateBuild, checkProject, browserPath, serveProject} from '../runtime/remotion/engine.mjs';
const exec = promisify(execFile);
const repo = path.resolve(import.meta.dirname,'..');

test('managed video/audio survive source snapshot, opaque preview seeking and durable native export', {timeout:180000}, async () => {
  const scratch = await mkdtemp(path.join(tmpdir(),'yingya-remotion-browser-'));
  const project = path.join(scratch,'project');
  let browser,server;
  try {
    await initProject(project,{width:320,height:180,fps:10,duration:2});
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=10:duration=3','-c:v','libx264','-threads','2','-pix_fmt','yuv420p',path.join(project,'assets/source.mp4')]);
    execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=2','-c:a','pcm_s16le',path.join(project,'assets/voice.wav')]);
    const config=JSON.parse(await readFile(path.join(project,'remotion.json')));
    config.props={title:'映芽迁移验证'};
    config.media=[{id:'footage',type:'video',src:'assets/source.mp4',from:0,durationInFrames:20,trimBefore:5,volume:0,muted:true},
      {id:'voice',type:'audio',src:'assets/voice.wav',from:0,durationInFrames:20,trimBefore:0,volume:1,role:'narration'}];
    await writeFile(path.join(project,'remotion.json'),JSON.stringify(config));
    await writeFile(path.join(project,'src/Video.tsx'),`import React from 'react';import {useCurrentFrame} from 'remotion';
export default function Scene({title}){const frame=useCurrentFrame();return <div id="frame" style={{position:'absolute',top:20,left:20,color:'white',background:'#111',fontSize:24,padding:8}}>{title} · {frame}</div>}`);
    await buildPreview(project);
    const snapshot=path.join(scratch,'snapshot'); await cp(project,snapshot,{recursive:true});
    await validateBuild(snapshot); // No absolute build paths bind the artifact to its original location.
    const check=await checkProject(snapshot); assert.equal(check.ok,true); assert.equal(check.media.length,2);
    server=await serveProject(snapshot);
    browser=await chromium.launch({executablePath:browserPath(),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage({viewport:{width:1280,height:800}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(server.url);
    // Match gateway: opaque iframe and ordinary script without cross-origin module loading.
    await page.setContent(`<title>映芽 Remotion 验证</title><iframe sandbox="allow-scripts" style="width:100%;height:70vh;border:0" src="${server.url}/index.html"></iframe>`);
    const frame=page.frames().find(f=>f!==page.mainFrame());
    await frame.waitForFunction(()=>!!window.__yingyaRemotionPlayer);
    async function seek(time) {
      await page.evaluate(time=>document.querySelector('iframe').contentWindow.postMessage({type:'yingya-preview-playback',playing:false,time},'*'),time);
      await frame.waitForFunction(frame=>window.__yingyaRemotionPlayer.getCurrentFrame()===frame,Math.round(time*10));
      await frame.waitForFunction(time=>{const v=document.querySelector('video');return v?.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-time-.5)<.12;},time);
      assert.equal(await frame.locator('#frame').innerText(),`映芽迁移验证 · ${Math.round(time*10)}`);
    }
    await seek(1.4); await seek(.2); await seek(1.4);
    await page.screenshot({path:path.join(scratch,'desktop.png')});
    await page.setViewportSize({width:390,height:844});await seek(.5);
    await page.screenshot({path:path.join(scratch,'mobile.png')});
    await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({type:'yingya-preview-playback',playing:true,time:0},'*'));
    await frame.waitForFunction(()=>window.__yingyaRemotionPlayer.getCurrentFrame()>=3);
    await seek(.2);assert.equal(errors.length,0,errors.join('\n'));
    const env={...process.env,YINGYA_NODE_MODULES:path.join(repo,'node_modules')};
    const args=[path.join(repo,'runtime/production-task.py'),'render','--project',snapshot,'--request-id','remotion-test','--output','renders/test.mp4','--fps','10','--quality','draft','--resolution','landscape'];
    const first=await exec('python3',args,{env,timeout:100000,maxBuffer:2000000});
    const job=JSON.parse(first.stdout.trim().split('\n').at(-1));
    assert.equal(job.status,'succeeded');
    const verification=JSON.parse(await readFile(path.join(snapshot,job.renderVerification)));
    assert.equal(verification.engine,'remotion');assert.equal(verification.ok,true);assert.equal(verification.frames.length,5);
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-of','json',path.join(snapshot,'renders/test.mp4')],{encoding:'utf8'}));
    assert.ok(probe.streams.some(s=>s.codec_type==='audio'));assert.equal(probe.streams.find(s=>s.codec_type==='video').width,1920);
    const second=await exec('python3',args,{env,timeout:15000});
    assert.ok(JSON.parse(second.stdout.trim().split('\n').at(-1)).reusedFrom);
    // A bad trim is a hard failure, not a silent shorter video.
    config.media[0].trimBefore=300;await writeFile(path.join(snapshot,'remotion.json'),JSON.stringify(config));await buildPreview(snapshot);
    await assert.rejects(checkProject(snapshot),/too short/);
    console.log('Preview screenshots and verified MP4:',scratch);
  } finally {await browser?.close();await server?.close(); /* retain evidence under /tmp */}
});
