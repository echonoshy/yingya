import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { installApiMock, detail } from './ui-qa.mjs';
// Browser plugin not available. Real frontend + isolated HTTP fixtures; no user data is changed.
const base = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const out = `/tmp/yingya-creation-uploads/${base.startsWith('https') ? 'public' : 'local'}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(12000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const tick = () => new Promise(resolve => setTimeout(resolve, 30));
async function until(check) { for (let n=0;n<300;n++) { if (await check()) return; await tick(); } throw new Error('Condition timed out'); }
const files = count => Array.from({length:count}, (_,i) => ({ name:`素材-${i+1}.txt`, mimeType:'text/plain', buffer:Buffer.alloc(32*1024,65+i) }));
const fileName = request => /filename="([^"]+)"/.exec(request.postDataBuffer().toString())?.[1];
const asset = (name, folderId) => ({ id:name, category:'document', sourceName:name, mimeType:'text/plain', url:'/fixture.txt', projectPath:'assets/'+name, prompt:null, kind:'uploaded', folderId, createdAt:1781593567000 });
try {
 await installApiMock(page);
 await page.addInitScript(() => localStorage.setItem('yingya-user:qa-user:yingya-knowledge-settings',JSON.stringify({duration:'120',durationMode:'exact',audience:'旧受众',style:'旧风格',subtitles:'中文字幕',music:'添加适合主题的配乐',audioMode:'narration'})));
 await page.goto(base+'/app#/');
 assert.equal(await page.getByRole('button',{name:'创作设置',exact:true}).count(),0);
 const duration = () => page.getByRole('button',{name:/参考时长：约/});
 assert.equal(await duration().getAttribute('aria-label'),'参考时长：约 30 秒');
 await duration().click();await page.getByRole('spinbutton',{name:'参考时长（秒）'}).fill('0');await page.getByRole('button',{name:'确定',exact:true}).click();assert.ok(await page.getByRole('dialog',{name:'参考时长',exact:true}).isVisible());
 await page.getByRole('spinbutton',{name:'参考时长（秒）'}).fill('45');await page.keyboard.press('Enter');await page.getByRole('dialog',{name:'参考时长',exact:true}).waitFor({state:'hidden'});await page.reload();assert.equal(await duration().getAttribute('aria-label'),'参考时长：约 45 秒');
 await duration().click();await page.getByRole('button',{name:'30 秒',exact:true}).click();
 for (const width of [1920,1536,1440,1280,390,320]) {
  await page.setViewportSize({width,height:1000});await duration().click();
  await until(async()=>{const box=await page.getByRole('dialog',{name:'参考时长',exact:true}).boundingBox();return box&&box.x>=0&&box.x+box.width<=width&&box.y>=0;});
  await page.screenshot({path:`${out}/duration-${width}.png`});await page.keyboard.press('Escape');
  assert.ok(await duration().evaluate(el=>el===document.activeElement));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'添加素材',exact:true}).click();await page.getByRole('menuitem',{name:/旁白音色/}).click();await page.getByRole('dialog',{name:'旁白音色',exact:true}).waitFor();await page.keyboard.press('Escape');
 const stored=[],requests=[],releases=new Map();let fail=true;
 await page.route(/\/assets\/library$/,async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{assets:stored}});
  const name=fileName(route.request());requests.push(name);
  await new Promise(resolve=>releases.set(name,resolve));
  if(name==='素材-1.txt'&&fail)return route.fulfill({status:413,json:{message:'测试文件上传失败，请重试'}});
  const item=asset(name,route.request().postDataBuffer().toString().includes('folder-brand')?'folder-brand':null);stored.push(item);return route.fulfill({json:item});
 });
 await page.goto(base+'/app#/assets');await page.getByRole('button',{name:/^品牌素材/}).click();
 await page.locator('.asset-workspace-toolbar input[type="file"]').setInputFiles(files(5));
 await until(()=>requests.length===3);await page.getByRole('link',{name:/^任务记录/}).click(); await page.getByRole('region',{name:'素材任务记录'}).waitFor();
 assert.equal(await page.locator('.asset-task-list li[data-kind=upload]').count(),5);assert.equal(await page.getByText('等待上传',{exact:true}).count(),2);
 await page.screenshot({path:`${out}/upload-queued.png`});
 // Navigation keeps library transfers alive and visible in a compact progress panel.
 await page.getByRole('button',{name:'新建视频',exact:true}).click();await page.locator('.upload-dock').waitFor();
 releases.get('素材-1.txt')();releases.get('素材-2.txt')();releases.get('素材-3.txt')();await until(()=>requests.length===5);
 releases.get('素材-4.txt')();releases.get('素材-5.txt')();await page.getByText('已完成 4/5 · 1 项失败',{exact:true}).waitFor();
 await page.getByRole('button',{name:'素材工坊',exact:true}).click();
 await page.getByRole('button',{name:/^品牌素材/}).click();assert.equal(await page.locator('.asset-card-item').count(),4);
 await page.screenshot({path:`${out}/upload-partial.png`});
 await page.getByRole('link',{name:/^任务记录/}).click();
 fail=false;await page.getByRole('button',{name:'重试上传 素材-1.txt',exact:true}).click();await until(()=>requests.length===6);releases.get('素材-1.txt')();await until(async()=>await page.locator('.asset-task-list li[data-kind=upload][data-state=completed]').count()===5);
 assert.deepEqual(requests.filter(name=>name!=='素材-1.txt').sort(),['素材-2.txt','素材-3.txt','素材-4.txt','素材-5.txt']);
 await page.getByRole('link',{name:'素材库',exact:true}).click();
 assert.equal(await page.locator('.asset-card-item').count(),5);
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${out}/uploads-complete-${width}.png`});}
 // Removing an uploaded asset must remain authoritative when another upload completes.
 await page.setViewportSize({width:1440,height:1000});
 await page.route(/\/assets\/library\/[^/]+$/,route=>{if(route.request().method()!=='DELETE')return route.fallback();const name=decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1));const index=stored.findIndex(item=>item.id===name);if(index>=0)stored.splice(index,1);return route.fulfill({json:{ok:true}});});
 await page.locator('.asset-card-item').filter({hasText:'素材-2.txt'}).locator('.asset-card-open').click();await page.getByRole('button',{name:'删除素材',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await until(async()=>await page.locator('.asset-card-item').count()===4);
 await page.locator('.asset-workspace-toolbar input[type="file"]').setInputFiles([{name:'新增素材.txt',mimeType:'text/plain',buffer:Buffer.from('new asset')}]);await until(()=>requests.length===7);releases.get('新增素材.txt')();await until(async()=>await page.locator('.asset-task-list li[data-kind=upload][data-state=completed]').count()===6);assert.equal(await page.locator('.asset-card-item').count(),5);assert.equal(await page.locator('.asset-card-item').filter({hasText:'素材-2.txt'}).count(),0);
 await page.getByRole('link',{name:/^任务记录/}).click(); await page.getByRole('button',{name:'清理已完成',exact:true}).click();assert.equal(await page.locator('.asset-task-list li[data-kind=upload]').count(),0);await page.getByRole('link',{name:'素材库',exact:true}).click(); await page.reload();await page.locator('.asset-card-item').first().waitFor();assert.equal(await page.locator('.asset-card-item').count(),5);
 // Project attachments get the same per-file feedback; successful files are reused on retry.
 await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/app#/');
 let creation;const uploaded=[],projectRelease=new Map();let failProject=true,turns=0;
 await page.route(url=>/^\/api(?:\/u\/[^/]+)?\/agent-projects$/.test(url.pathname),route=>{if(route.request().method()!=='POST')return route.fallback();creation=route.request().postDataJSON();return route.fulfill({json:detail});});
 await page.route(/\/agent-projects\/[^/]+\/assets$/,async route=>{const name=fileName(route.request());uploaded.push(name);await new Promise(resolve=>projectRelease.set(name,resolve));if(name==='素材-2.txt'&&failProject)return route.fulfill({status:500,json:{message:'测试：第二个附件未上传'}});return route.fulfill({json:{path:'assets/'+name,name}});});
 await page.route(/\/agent-projects\/[^/]+\/turns$/,route=>{turns++;return route.fallback();});
 await page.locator('#creation-prompt').fill('请制作约 60 秒的动画，根据素材安排内容，不需要旁白或字幕');
 await page.locator('.home-creation-options input[type=file]:not([accept])').setInputFiles(files(2));
 await page.locator('.composer-attachments > li').nth(1).waitFor();await page.getByRole('button',{name:'开始创作',exact:true}).click();await until(()=>uploaded.length===2);
 assert.equal(creation.requirements.targetDurationSeconds,30);assert.equal(creation.requirements.durationMode,'target');assert.equal(creation.requirements.audioMode,'auto');assert.equal(creation.requirements.subtitles,'auto');assert.equal(creation.requirements.music,'auto');assert.equal(creation.requirements.audience,undefined);assert.match(creation.prompt,/60 秒/);
 await page.locator('.creation-pending .upload-progress-list').waitFor();await page.screenshot({path:`${out}/creation-uploading.png`});assert.equal(turns,0);
 projectRelease.get('素材-1.txt')();projectRelease.get('素材-2.txt')();await page.getByText('测试：第二个附件未上传',{exact:true}).first().waitFor();await page.getByRole('button',{name:'开始创作',exact:true}).waitFor();assert.equal(turns,0);
 failProject=false;await page.getByRole('button',{name:'开始创作',exact:true}).click();await until(()=>uploaded.length===3);assert.equal(uploaded[2],'素材-2.txt');projectRelease.get('素材-2.txt')();await until(()=>turns===1);await page.waitForURL(/#\/projects\//);
 assert.deepEqual(errors,[]);console.log('PASS: default 30s / custom duration / legacy settings ignored, voice in materials, six widths, bounded upload queue / per-file status / partial failures / retry / navigation / persistence, project upload progress and no duplicate successful attachments. Isolated API fixtures.');
} catch(error){await page.screenshot({path:`${out}/failure.png`});throw error;} finally{await browser.close();}
