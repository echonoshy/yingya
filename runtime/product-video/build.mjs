#!/usr/bin/env node
// Screenshot-led product compositions. Opt-in; never replaces a custom composition.
import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const runtime=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(runtime,'../..');
const args=process.argv.slice(2);
const arg=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const project=path.resolve(arg('--project','.'));
const example=arg('--example');
const manifest=await readFile(path.join(project,'.yingya/manifest.json'),'utf8').then(JSON.parse).catch(()=>null);
const aspectRatio=arg('--aspect-ratio',manifest?.outputSpec?.aspectRatio??'16:9');
const dimensions={'16:9':[1280,720],'9:16':[720,1280],'1:1':[1080,1080]};
if(!dimensions[aspectRatio])throw Error('Expected aspect ratio 16:9, 9:16 or 1:1');
const [width,height]=dimensions[aspectRatio];
const hash=text=>createHash('sha256').update(text).digest('hex');
const html=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
if(args.includes('--help')){console.log('node "$YINGYA_PRODUCT_VIDEO" --project DIR [--example product-intro|feature-launch|walkthrough] [--aspect-ratio 16:9|9:16|1:1]\nWithout --example: rebuild an owned product composition from scenes.json and assets.json. Explicit examples seed Yingya sample material; replace all content for customer films.');process.exit(0);}
await mkdir(path.join(project,'.yingya'),{recursive:true});
const output=path.join(project,'index.html');
const previous=await readFile(output,'utf8').catch(()=>null);
const record=await readFile(path.join(project,'.yingya/product-video.json'),'utf8').then(JSON.parse).catch(()=>null);
if(previous && (!record || record.outputSha256!==hash(previous)))throw Error('Custom or manually edited composition: refusing to overwrite index.html. Preserve it and edit directly.');
if(example){
 if(!['product-intro','feature-launch','walkthrough'].includes(example))throw Error('Unknown example');
 if(previous)throw Error('Example seeding requires a new project; rebuild without --example.');
 await cp(path.join(runtime,'assets'),path.join(project,'assets/product'),{recursive:true});
 await copyFile(path.join(runtime,'examples',example+'.json'),path.join(project,'scenes.json'));
 const files=['intro','create','launch','plan','edit','choose'];
 await writeFile(path.join(project,'assets.json'),JSON.stringify(files.map(id=>({id,name:`映芽界面 · ${id}`,hyperframesPath:`assets/product/${id}.png`,kind:'image',source:'yingya-product-capture',mediaType:'image/png',createdAt:0})),null,2));
 await copyFile(path.join(runtime,'DESIGN.md'),path.join(project,'DESIGN.md'));
}
const scenes=JSON.parse(await readFile(path.join(project,'scenes.json'),'utf8'));
const assets=JSON.parse(await readFile(path.join(project,'assets.json'),'utf8'));
if(!Array.isArray(scenes)||!scenes.length||!Array.isArray(assets))throw Error('Expected scenes and assets arrays');
await readFile(path.join(project,'DESIGN.md'),'utf8');
const safePath=relative=>{if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..')||/^[a-z]+:/i.test(relative))throw Error('Asset must stay in project');return relative;};
for(const asset of assets){
 await readFile(path.join(project,safePath(asset.hyperframesPath)));
 if(asset.mediaType?.startsWith('audio/') && (!Number.isFinite(asset.durationSeconds)||asset.durationSeconds<=0))throw Error('Audio requires measured durationSeconds');
}
let end=0;const ids=new Set();
for(const scene of scenes){
 if(!/^[a-zA-Z0-9_-]+$/.test(scene.id)||ids.has(scene.id))throw Error('Scene IDs must be unique CSS-safe identifiers');ids.add(scene.id);
 if(!Number.isFinite(scene.startSeconds)||!Number.isFinite(scene.durationSeconds)||scene.durationSeconds<1||scene.startSeconds<end-0.001)throw Error('Invalid or overlapping scene schedule');
 end=scene.startSeconds+scene.durationSeconds;
 if(scene.assetIds.some(id=>!assets.find(a=>a.id===id)))throw Error('Missing registered asset');
}
await mkdir(path.join(project,'assets/product-runtime'),{recursive:true});
await copyFile(path.join(repo,'runtime/editorial/vendor/gsap-3.14.2.min.js'),path.join(project,'assets/product-runtime/gsap.js'));
await cp(path.join(repo,'node_modules/@fontsource-variable/noto-sans-sc'),path.join(project,'assets/product-runtime/font'),{recursive:true});
const fontCSS=(await readFile(path.join(repo,'node_modules/@fontsource-variable/noto-sans-sc/index.css'),'utf8')).replaceAll('url(./files/','url(assets/product-runtime/font/files/');
const sections=scenes.map((s,i)=>{
 const media=assets.find(a=>s.assetIds.includes(a.id)&&a.mediaType?.startsWith('image/'));
 const audio=assets.find(a=>s.assetIds.includes(a.id)&&a.mediaType?.startsWith('audio/'));
 const layout=['hero','split','focus','steps','closing'].includes(s.productLayout)?s.productLayout:'split';
 return `<section class="scene ${layout}" id="${s.id}" style="z-index:${i+1};opacity:${i?0:1};visibility:${i?'hidden':'visible'}"><div class="scene-content"><header><span>${html(s.brandName??'映芽')}</span><span>${String(i+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}</span></header><div class="scene-body"><div class="copy"><p class="chapter">${html(s.narrativeRole)}</p><h1 id="${s.id}-title">${html(s.onScreenText)}</h1><p class="support">${html(s.supportingText??s.narration)}</p></div>${media?`<div class="media-frame"><img id="${s.id}-image" src="${html(media.hyperframesPath)}" data-start="${s.startSeconds}" data-duration="${s.durationSeconds}" alt="${html(media.name)}"/></div>`:''}</div><footer><span>${html(s.footer??'yingya.art')}</span><div class="progress"><i id="${s.id}-progress"></i></div></footer></div></section>${audio?`<audio id="${s.id}-voice" src="${html(audio.hyperframesPath)}" data-start="${s.startSeconds}" data-duration="${audio.durationSeconds}" data-track-index="2" data-volume="1"></audio>`:''}`;
}).join('\n');
const motion=scenes.map((s,i)=>{
 const t=s.startSeconds;
 return `${i?`tl.to('#${scenes[i-1].id}',{autoAlpha:0,duration:.2,ease:'sine.in'},${t-.2});tl.to('#${s.id}',{autoAlpha:1,duration:.35,ease:'sine.out'},${t});`:''}
 tl.from('#${s.id} .chapter',{y:10,opacity:0,duration:.45,ease:'sine.out'},${t+.15});
 tl.from('#${s.id}-title',{y:28,opacity:0,duration:.7,ease:'power3.out'},${t+.25});
 tl.from('#${s.id} .support',{y:16,opacity:0,duration:.6,ease:'power2.out'},${t+.65});
 ${s.assetIds.some(id=>assets.find(a=>a.id===id&&a.mediaType?.startsWith('image/')))?`tl.from('#${s.id} .media-frame',{y:32,scale:.96,opacity:0,duration:.9,ease:'expo.out'},${t+.45});\ntl.to('#${s.id}-image',{scale:${s.productLayout==='focus'?1.12:1.025},duration:${Math.max(1,s.durationSeconds-1.5)},ease:'sine.inOut'},${t+1});`:''}
 tl.fromTo('#${s.id}-progress',{scaleX:0},{scaleX:1,duration:${s.durationSeconds},ease:'none'},${t});`;
}).join('\n');
const result=`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><script src="assets/product-runtime/gsap.js"></script><style>${fontCSS}
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#f3f4f6;color:#24262b;font-family:'Noto Sans SC Variable',sans-serif}#main{position:relative;width:${width}px;height:${height}px;overflow:hidden}.scene{position:absolute;inset:0;background:#f3f4f6}.scene-content{width:100%;height:100%;padding:40px 64px 32px;display:flex;flex-direction:column;gap:24px}.scene header,.scene footer{display:flex;align-items:center;justify-content:space-between;gap:24px;font-size:20px;color:#50545c}.scene header span:first-child{font-weight:700;color:#24262b}.scene-body{flex:1;min-height:0;display:grid;grid-template-columns:.85fr 1.3fr;align-items:center;gap:48px}.copy{min-width:0}.chapter{color:#005fc1;font-size:22px;margin:0 0 16px;font-weight:500}h1{font-size:60px;line-height:1.2;letter-spacing:-.025em;margin:0;font-weight:850;overflow-wrap:anywhere}.support{font-size:24px;line-height:1.7;margin:24px 0 0;color:#50545c;max-width:28em}.media-frame{min-width:0;overflow:hidden;background:#fff;border:1px solid #e0e3e8;border-radius:18px;padding:16px;box-shadow:0 20px 50px #24262b12}.media-frame img{display:block;width:100%;max-height:410px;object-fit:contain;transform-origin:center}.progress{height:3px;width:160px;background:#e0e3e8;overflow:hidden}.progress i{display:block;width:100%;height:100%;background:#006bd6;transform-origin:left}.hero .scene-body,.closing .scene-body{grid-template-columns:1fr}.hero .copy,.closing .copy{text-align:center}.hero h1,.closing h1{font-size:72px;max-width:14em;margin:auto}.hero .support,.closing .support{margin:20px auto 0}.hero .media-frame{max-width:760px;max-height:185px;margin:0 auto}.hero .media-frame img{max-height:150px}.closing .media-frame{display:none}.focus .scene-body,.steps .scene-body{grid-template-columns:1fr;gap:22px}.focus .copy,.steps .copy{display:grid;grid-template-columns:1fr 1fr;column-gap:28px;align-items:center}.focus .chapter,.steps .chapter{grid-column:1/-1;margin-bottom:8px}.focus h1,.steps h1{font-size:46px}.focus .support,.steps .support{margin:0;font-size:22px}.focus .media-frame,.steps .media-frame{height:340px}.focus .media-frame img,.steps .media-frame img{height:100%;max-height:none;object-fit:contain}
${aspectRatio==='9:16'?`.scene-content{padding:40px;gap:32px}.scene-body{grid-template-columns:1fr;align-content:center;gap:48px}h1{font-size:62px}.support{font-size:28px}.hero h1,.closing h1{font-size:72px}.hero .media-frame{max-height:250px}.hero .media-frame img{max-height:210px}.focus .copy,.steps .copy{grid-template-columns:1fr;gap:12px}.focus h1,.steps h1{font-size:56px}.focus .support,.steps .support{font-size:26px}.focus .media-frame,.steps .media-frame{height:460px}.scene header,.scene footer{font-size:22px}`:aspectRatio==='1:1'?`.scene-body{grid-template-columns:1fr;gap:32px;align-content:center}.media-frame img{max-height:460px}.focus .media-frame,.steps .media-frame{height:520px}.hero .media-frame{max-height:230px}.hero .media-frame img{max-height:190px}`:''}
</style></head><body><main id="main" data-composition-id="main" data-start="0" data-duration="${end}" data-width="${width}" data-height="${height}">${sections}</main><script>const tl=gsap.timeline({paused:true});${motion}\nwindow.__timelines={main:tl};</script></body></html>`;
await writeFile(output,result);
await writeFile(path.join(project,'index.motion.json'),JSON.stringify({duration:end,assertions:scenes.flatMap(s=>[{kind:'appearsBy',selector:`#${s.id}-title`,bySec:s.startSeconds+1.2}])},null,2));
await writeFile(path.join(project,'.yingya/product-video.json'),JSON.stringify({schemaVersion:1,outputSha256:hash(result),sceneIds:scenes.map(s=>s.id)},null,2));
console.log(JSON.stringify({ok:true,project,durationSeconds:end,scenes:scenes.length,output:'index.html'}));
