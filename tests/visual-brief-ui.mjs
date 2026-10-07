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
 let failImage=true,imagePayload,releaseImage;const pendingImage=new Promise(resolve=>{releaseImage=resolve;});
 await page.route('**/codex/threads/image-thread-1/images',async route=>{imagePayload=route.request().postDataJSON();if(failImage)return route.fulfill({status:500,json:{message:'测试：暂时无法生成，请重试'}});await pendingImage;return route.fallback();});
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
  assert.equal(await page.getByRole('combobox',{name:name+'的素材用途',exact:true}).textContent(),role==='required'?'必须使用':'仅供参考');
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
 await page.getByRole('button',{name:'生成参考图',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'生成参考图',exact:true});
 await dialog.getByLabel('参考图描述',{exact:true}).fill('纸感云间列车，暖色夕阳，16:9 构图');
 await dialog.getByLabel('上传生成图片的参考图',{exact:true}).setInputFiles({name:'reference.png',mimeType:'image/png',buffer:await readFile('web/src/assets/showcase/demo-9.webp')});
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));await page.screenshot({path:`${out}/${tag}-image-dialog-${width}.png`});}
 await dialog.getByRole('button',{name:'生成参考图',exact:true}).click();
 await dialog.getByRole('alert').waitFor();assert.match(await dialog.getByLabel('参考图描述',{exact:true}).inputValue(),/云间列车/);
 assert.equal(await dialog.getByRole('button',{name:'移除参考图 reference.png'}).count(),1);
 failImage=false;await dialog.getByRole('button',{name:'生成参考图',exact:true}).click();
 await dialog.getByText('正在生成，完成后会保存到素材库。可以关闭面板，稍后回来查看。',{exact:true}).waitFor();
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 assert.ok(await page.getByRole('button',{name:'生成图文方案',exact:true}).isDisabled(),'Image preparation is not interrupted by creating a project');
 await page.getByRole('button',{name:'我的项目',exact:true}).click();
 await page.locator('.app-primary-navigation').getByRole('button',{name:'新建视频',exact:true}).click();
 await page.getByRole('button',{name:'参考图生成中',exact:true}).click();
 releaseImage();
 await dialog.getByRole('button',{name:'加入本次创作 · 1 张',exact:true}).waitFor();
 await dialog.locator('img').evaluate(img=>img.decode());
 assert.match(imagePayload.prompt,/云间列车/);assert.equal(imagePayload.referenceImages.length,1);
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:`${out}/${tag}-image-result.png`});
 await dialog.getByRole('button',{name:'加入本次创作 · 1 张',exact:true}).click();await dialog.waitFor({state:'detached'});
 assert.equal(await page.locator('.creation-reference-strip img').count(),1);
 assert.equal(await page.locator('#creation-prompt').inputValue(),prepared);
 assert.equal(requests.filter(r=>new URL(r.url).pathname.endsWith('/agent-projects')).length,0,'Image preparation never creates a video project');
 await page.reload();await page.locator('#creation-prompt').waitFor();
 assert.equal(await page.locator('.creation-reference-strip img').count(),1,'Selected generated image survives reload');
 assert.equal(await page.locator('#creation-prompt').inputValue(),prepared);
 for(const width of [1440,1280,768,390,320]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Studio fits ${width}`);
  await page.screenshot({path:`${out}/${tag}-create-${width}.png`});
 }
 await page.getByRole('button',{name:'添加素材',exact:true}).click();
 await page.getByRole('menu',{name:'添加素材'}).getByRole('menuitem',{name:/素材库.*已选 1 项/}).click();
 dialog=page.getByRole('dialog',{name:'从素材库选择',exact:true});
 await dialog.getByRole('combobox', { name: imagePayload.prompt+'的素材用途', exact: true }).waitFor();
 assert.equal(await dialog.getByRole('combobox',{name:imagePayload.prompt+'的素材用途',exact:true}).textContent(),'仅供参考');
 await dialog.getByRole('button',{name:'完成选择 · 1 项'}).click();
 // The existing project flow must import the selected generated image and preserve its role.
 await page.getByRole('button',{name:'生成图文方案',exact:true}).click();
 await page.waitForFunction(()=>location.hash.includes('/projects/'));
 assert.ok(requests.some(r=>/assets\/library\/image-2\/projects\//.test(r.url)),'Generated image imported into project');
 assert.ok(requests.some(r=>r.body?.includes('reference')&&r.url.includes('/asset-roles')),'Reference role sent to project');
 assert.deepEqual(errors,[]);
 console.log('PASS '+base+': homepage four concrete sources, draft handoff, three typed file roles, builtin outlines/styles, real image API contract with isolated fixtures, failure retry retains inputs, generated preview selection/import/reference role, reload persistence, no premature video creation, 320–1440px. Image generation responses mocked; no real generation run.');
} catch(error){await page.screenshot({path:out+'/'+tag+'-failure.png'});throw error;}finally{await browser.close();}
