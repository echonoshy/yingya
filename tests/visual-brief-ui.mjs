import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { installApiMock } from './ui-qa.mjs';
const base=process.env.YINGYA_UI_QA_URL||'http://127.0.0.1:8798';
const tag=base.startsWith('https')?'live':'local';
const out='/tmp/yingya-visual-brief';await mkdir(out,{recursive:true});
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(['POST','PATCH'].includes(r.method()))requests.push({url:r.url(),body:r.postData()});});
try {
 await installApiMock(page);
 await page.route('**/brand/yingya-ghost.png',async route=>route.fulfill({contentType:'image/webp',body:await readFile('web/src/assets/showcase/demo-9.webp')}));
 await page.goto(base);await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('.reference-play-icon').count(),0);
 for(const label of ['参考视频','复刻网站','剧本','风格'])await page.locator('.home-sources').getByRole('button',{name:label,exact:true}).click();
 await page.locator('.home-sources').getByRole('button',{name:'复刻网站',exact:true}).click();
 await page.locator('#home-idea').fill('https://example.com 复刻首页配色，用自己的产品内容');
 await page.getByRole('button',{name:'准备创作',exact:true}).click();
 await page.locator('#creation-prompt').waitFor();
 assert.equal(await page.locator('.creation-preparation').getByRole('button',{name:'复刻网站',exact:true}).getAttribute('aria-pressed'),'true');
 const original=await page.locator('#creation-prompt').inputValue();
 assert.match(original,/example.com/);
 for(const [selector,name,mime,role] of [['上传背景音乐','music.mp3','audio/mpeg','required'],['上传参考图','style.png','image/png','reference'],['上传参考视频','style.mp4','video/mp4','reference']]){
  await page.getByRole('button',{name:'添加素材',exact:true}).click();
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('menu',{name:'添加素材'}).getByRole('menuitem',{name:selector.replace('上传',''),exact:true}).click();
  await (await chooser).setFiles({name,mimeType:mime,buffer:Buffer.from('isolated fixture')});
  await page.getByRole('button', { name: '预览附件 '+name, exact: true }).waitFor();
  assert.equal(await page.getByRole('combobox', { name: name+'的素材用途', exact: true }).count(), 0);
  assert.match(await page.evaluate(() => Object.entries(localStorage).find(([key]) => key.endsWith('yingya-home-asset-roles'))?.[1]), new RegExp(role));
  await page.getByRole('button',{name:'移除 '+name,exact:true}).click();
 }
 await page.getByRole('button',{name:'添加素材',exact:true}).click();
 await page.getByRole('menuitem',{name:'内置内容',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'选用内置内容',exact:true});
 assert.equal(await dialog.locator('.brief-style-list button').count(),9);
 await dialog.getByRole('button',{name:/故事短片/}).click();await dialog.waitFor({state:'detached'});
 assert.ok((await page.locator('#creation-prompt').inputValue()).startsWith(original));
 assert.match(await page.locator('#creation-prompt').inputValue(),/主角与场景/);
 const prepared=await page.locator('#creation-prompt').inputValue();
 assert.equal(await page.getByRole('button',{name:/生成参考图|生成图文方案/}).count(),0);
 assert.equal(await page.getByRole('button',{name:'开始创作',exact:true}).count(),1);
 // A reference selected before the unified entry was introduced must survive the upgrade.
 await page.evaluate(() => {
  localStorage.setItem('yingya-user:qa-user:yingya-home-library',JSON.stringify(['image-1']));
  localStorage.setItem('yingya-user:qa-user:yingya-home-reference-previews',JSON.stringify([{id:'image-1',url:'/brand/yingya-ghost.png'}]));
  localStorage.setItem('yingya-user:qa-user:yingya-home-asset-roles',JSON.stringify({'library:image-1':'reference'}));
 });
 await page.reload();await page.locator('#creation-prompt').waitFor();
 assert.equal(await page.locator('.creation-reference-strip img').count(),1,'Previous reference selection survives reload');
 assert.equal(await page.locator('#creation-prompt').inputValue(),prepared);
 for(const width of [1920,1536,1440,1280,1028,768,600,390,320]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Studio fits ${width}`);
  const controls=await page.locator('.composer-tools').evaluate(el=>Array.from(el.querySelectorAll('.composer-more-trigger,.duration-trigger,.aspect-trigger,.model-trigger,.send-button')).map(button=>{
   const r=button.getBoundingClientRect(),style=getComputedStyle(button);
   return {x:r.x,right:r.right,y:r.y,height:r.height,font:style.fontSize};
  }));
  assert.equal(controls.length,5);
  assert.ok(controls.every(control=>Math.abs(control.y-controls[0].y)<1),`All controls on one row at ${width}`);
  assert.ok(controls.every((control,index)=>control.x>=0&&control.right<=width&&(!index||control.x>=controls[index-1].right)),`Controls fit without overlapping at ${width}`);
  assert.ok(controls.slice(0,4).every(control=>control.font===(width<=600?'12px':'13px')),`Compact control text at ${width}`);
  if(width<=600)assert.ok(controls.every(control=>control.height>=44),'Mobile touch height preserved');
  await page.screenshot({path:`${out}/${tag}-create-${width}.png`});
 }
 await page.getByRole('button',{name:'添加素材',exact:true}).click();
 await page.getByRole('menu',{name:'添加素材'}).getByRole('menuitem',{name:/素材库.*已选 1 项/}).click();
 dialog=page.getByRole('dialog',{name:'从素材库选择',exact:true});
 await dialog.getByRole('combobox', { name: '深色背景中的发光新芽，电影级侧光的素材用途', exact: true }).waitFor();
 assert.equal(await dialog.getByRole('combobox',{name:'深色背景中的发光新芽，电影级侧光的素材用途',exact:true}).textContent(),'仅供参考');
 await dialog.getByRole('button',{name:'完成选择 · 1 项'}).click();
 // The existing project flow must import the selected generated image and preserve its role.
 await page.getByRole('button',{name:'开始创作',exact:true}).click();
 await page.waitForFunction(()=>location.hash.includes('/projects/'));
 assert.ok(requests.some(r=>/assets\/library\/image-1\/projects\//.test(r.url)),'Previously selected reference imported into project');
 assert.ok(requests.some(r=>r.body?.includes('reference')&&r.url.includes('/asset-roles')),'Reference role sent to project');
 assert.deepEqual(errors,[]);
 console.log('PASS '+base+': draft handoff, typed attachment roles, builtin content, single-row toolbar at 320–1920px, unified submission, previous reference selection persistence/import. Isolated API fixtures; no real generation run.');
} catch(error){await page.screenshot({path:out+'/'+tag+'-failure.png'});throw error;}finally{await browser.close();}
