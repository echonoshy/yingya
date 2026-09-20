// Rendered invariants for the optional product composition builder.
// This is a controlled source regression, separate from actual Agent acceptance.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root=await mkdtemp(path.join(tmpdir(),'yingya-product-visual-'));
const builder=path.resolve('runtime/product-video/build.mjs');
const build=(...args)=>{const r=spawnSync(process.execPath,[builder,'--project',root,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 build('--example','product-intro');
 const original=JSON.parse(await readFile(path.join(root,'scenes.json')));
 const ready=async()=>{await page.goto(`file://${root}/index.html`);await page.evaluate(()=>document.fonts.ready);};
 const frame=async t=>{await page.evaluate(time=>{window.__timelines.main.totalTime(time,false);},t);return page.screenshot();};
 await ready();
 const baseline=[2,9,16,24].map(time=>({time})); // Seek operations stay sequential.
 for(const entry of baseline)entry.pixels=await frame(entry.time);
 await frame(24);assert.ok((await frame(2)).equals(baseline[0].pixels),'Backward seek changed original scene');
 await ready();assert.ok((await frame(16)).equals(baseline[2].pixels),'Direct seek changed original scene');
 let revised=structuredClone(original);revised[1].onScreenText='只修改这一处文字';
 await writeFile(path.join(root,'scenes.json'),JSON.stringify(revised));build();await ready();
 assert.ok(!(await frame(9)).equals(baseline[1].pixels),'Text edit not visible');
 for(const index of [0,2,3])assert.ok((await frame(baseline[index].time)).equals(baseline[index].pixels),`Text edit changed unrelated scene ${index}`);
 revised=structuredClone(original);revised[1].durationSeconds+=2;for(const s of revised.slice(2))s.startSeconds+=2;
 await writeFile(path.join(root,'scenes.json'),JSON.stringify(revised));build();await ready();
 assert.ok((await frame(2)).equals(baseline[0].pixels),'Duration edit changed earlier scene');
 for(const index of [2,3])assert.ok((await frame(baseline[index].time+2)).equals(baseline[index].pixels),`Duration edit changed shifted scene ${index}`);
 revised=structuredClone(original);revised[1].assetIds=['choose'];
 await writeFile(path.join(root,'scenes.json'),JSON.stringify(revised));build();await ready();
 assert.ok(!(await frame(9)).equals(baseline[1].pixels),'Replacement image not visible');
 for(const index of [0,2,3])assert.ok((await frame(baseline[index].time)).equals(baseline[index].pixels),`Image edit changed unrelated scene ${index}`);
 assert.deepEqual(errors,[]);
 console.log('Product video visual regression passed: backward/direct seeking, visible text and image replacement, unchanged unrelated scenes, exact downstream timing shift.');
}finally{await browser.close();await rm(root,{recursive:true,force:true});}
