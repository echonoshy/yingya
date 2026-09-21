import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdir,readFile} from 'node:fs/promises';
import {installApiMock,detail} from './ui-qa.mjs';
const base=process.env.YINGYA_UI_QA_URL??'http://127.0.0.1:8798';
const out='/tmp/yingya-knowledge-ui';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const seed={...structuredClone(detail),title:'单摆：摆长如何影响周期',aspectRatio:'16:9',queue:[],queueDepth:0,queuePaused:false};
const plan={checkpointId:'checkpoint-1',revision:'plan-revision-1',ready:true,markdown:'',document:{title:'单摆：摆长如何影响周期',audience:'第一次接触单摆的同学',question:'为什么长摆摆得更慢？',takeaway:'小角度时，周期与摆长的平方根成正比。',durationSeconds:90,aspectRatio:'16:9',narration:'中文旁白',materials:['单摆示意图'],missingMaterials:[],sections:['从生活观察开始','解释摆长与周期','回到例子总结'].map((title,index)=>({id:`scene-${index}`,title,summary:'通过比较两种摆长，解释周期变化与公式的关系。',expression:'保持相同的时间尺度，并排展示运动和周期。',keyframe:{status:'ready',path:'plans/frame.jpg',sourcePath:'index.html',timeSeconds:index*30}}))}};
seed.messages.push({id:'confirmed-technical-message',status:'completed',role:'user',text:'当前制作方案已经确认。内部测试标记 HyperFrames check --snapshots --json',context:['checkpoint:plan-old','plan-revision:'+ 'f'.repeat(64)],attachments:[],feedback:[],createdAt:Date.now()});
let failPlan=false,confirmation,submitted;const errors=[],requests=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 await installApiMock(page,seed);
 await page.addInitScript(() => { for (const [key,value] of Object.entries({"yingya-home-presentation":{capabilityId:"model-stage",variant:"orbit"},"yingya-knowledge-workflow":"product-intro","yingya-product-example":"product-intro","yingya-creation-style":"kinetic-type"})) localStorage.setItem(`yingya-user:qa-user:${key}`,JSON.stringify({version:1,value})); });
 await page.route(url=>url.pathname.endsWith('/plan'),route=>route.fulfill({status:failPlan?503:200,json:failPlan?{message:'方案暂不可用'}:plan}));
 await page.route('**/files/plans/frame.jpg*',async route=>route.fulfill({contentType:'image/jpeg',body:await readFile('tests/fixtures/media/explainer.jpg')}));
 await page.route('**/checkpoint',route=>{confirmation=route.request().postDataJSON();return route.fulfill({json:{turnId:'confirmed',status:'queued',queueDepth:1}});});
 await page.route('**/turns',route=>{submitted=route.request().postDataJSON();return route.fulfill({json:{turnId:'feedback',status:'queued',queueDepth:1}});});
 await page.goto(base+'/app#/');await page.locator('.home-create textarea').waitFor();
 assert.equal(await page.locator('.home-projects, .knowledge-example-grid, .home-header').count(),0,'Home contains only the composer');
 for(const width of [390,320]) {
  await page.setViewportSize({width,height:844});
  await page.getByRole('button',{name:'我的作品',exact:true}).click();
  const heading=await page.getByRole('heading',{name:'我的作品',exact:true}).boundingBox();
  const navigation=await page.locator('.app-navigation').boundingBox();
  assert.ok(heading.y>=navigation.y+navigation.height,'Projects heading must clear sticky mobile navigation');
  await page.getByRole('button',{name:'新建视频',exact:true}).click();
  await page.waitForURL('**/app#/');
  // Navigation updates the URL before the scheduled animation-frame focus runs.
  await page.waitForFunction(()=>document.querySelector('.home-create textarea')===document.activeElement,{},{timeout:3000});
  assert.equal(await page.locator('.home-create textarea').evaluate(el=>el===document.activeElement),true);
 }
 await page.setViewportSize({width:1440,height:900});
 await page.locator('.home-create textarea').fill('面向初学者，用生活例子解释单摆的周期。');
 await page.getByRole('button',{name:'我的作品',exact:true}).click();
 assert.equal(await page.locator('.home-create').count(),0,'Library does not duplicate the creation composer');
 await page.getByRole('button',{name:'新建视频',exact:true}).click();
 assert.match(await page.locator('.home-create textarea').inputValue(),/初学者/,'Draft survives navigation');
 await page.screenshot({path:out+'/home.png'});

 const creationRequest=page.waitForRequest(request=>new URL(request.url()).pathname.endsWith('/agent-projects')&&request.method()==='POST');
 await page.getByRole('button',{name:'生成方案',exact:true}).click();
 const creation=(await creationRequest).postDataJSON();assert.equal(creation.requirements.workflow,'knowledge-explainer');for(const key of ['presentation','styleId','referenceExample'])assert.equal(key in creation.requirements,false,`retired setting ${key} must not affect creation`);
 await page.waitForURL('**/app#/projects/22222222-2222-4222-8222-222222222222');

 await page.goto(base+`/app#/projects/${seed.id}`);await page.getByRole('button',{name:'按这个方案制作',exact:true}).waitFor();assert.equal(await page.locator('.motion-editor').count(),0);await page.getByText('已确认方案，开始制作。',{exact:true}).waitFor();assert.equal(await page.getByText('内部测试标记',{exact:false}).count(),0);assert.equal(await page.getByText('plan-revision:',{exact:false}).count(),0);
 const keyframe=page.getByRole('button',{name:'放大查看：从生活观察开始',exact:true});
 await keyframe.focus();await page.keyboard.press('Enter');
 const frameDialog=page.getByRole('dialog',{name:'从生活观察开始',exact:true});
 await frameDialog.waitFor();await frameDialog.locator('img').evaluate(img=>img.decode());
 await frameDialog.getByRole('button',{name:'放大画面',exact:true}).click();
 await page.waitForFunction(()=>{const el=document.querySelector('.plan-frame-image');return el.scrollWidth>el.clientWidth},{},{timeout:3000});
 await frameDialog.getByRole('button',{name:'适应窗口',exact:true}).click();
 await page.waitForFunction(()=>{const el=document.querySelector('.plan-frame-image');return el.scrollWidth<=el.clientWidth+1},{},{timeout:3000});
 await page.keyboard.press('Escape');await frameDialog.waitFor({state:'hidden'});
 assert.equal(await keyframe.evaluate(el=>el===document.activeElement),true,'Keyframe preview restores focus');

 const separator=page.getByRole('separator',{name:'调整创作对话宽度'});await separator.focus();const before=Number(await separator.getAttribute('aria-valuenow'));await page.keyboard.press('ArrowLeft');assert.ok(Number(await separator.getAttribute('aria-valuenow'))<before);const saved=await separator.getAttribute('aria-valuenow');await page.reload();await separator.waitFor();assert.equal(await separator.getAttribute('aria-valuenow'),saved);await separator.dblclick();
 await page.getByRole('button',{name:'对此提意见',exact:true}).first().click();assert.match(await page.locator('.thread-footer textarea').inputValue(),/scene-0/);assert.equal(await page.locator('.thread-footer textarea').evaluate(el=>document.activeElement===el),true);
 await page.screenshot({path:out+'/plan-desktop.png'});
 for(const [width,height] of [[1024,768],[390,844],[320,568]]){
  await page.setViewportSize({width,height});
  if(width<1024){await page.getByRole('button',{name:'方案',exact:true}).click();assert.equal(await separator.isVisible(),false);}
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`horizontal overflow ${width}`);
  if(width<1024){const backIcon=await page.locator(".project-back svg").boundingBox();assert.ok(backIcon?.width>=16&&backIcon?.height>=16,"Back navigation icon must remain visible on mobile");}
  await page.screenshot({path:`${out}/plan-${width}.png`});
 }
 await page.getByRole('button',{name:'按这个方案制作',exact:true}).click();assert.equal(typeof confirmation.model,'string');assert.equal(confirmation.revision,plan.revision);assert.equal(confirmation.checkpointId,plan.checkpointId);assert.match(confirmation.clientRequestId,/^[\da-f-]{36}$/);
 failPlan=true;await page.reload();await page.getByRole('button',{name:'方案',exact:true}).click();await page.getByText('方案暂不可用',{exact:false}).first().waitFor();failPlan=false;await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByRole('button',{name:'按这个方案制作',exact:true}).waitFor();
 const videoSeed={...seed,manifest:{...seed.manifest,checkpoint:null,phase:'draft_review',currentDraft:'draft-1',versions:[{id:'draft-1',label:'初稿 1',sourcePath:'.yingya/versions/draft-1',videoPath:'video.mp4',createdAt:Date.now()}]}};
 await page.route(url=>url.pathname.endsWith(`/agent-projects/${seed.id}`),route=>route.fulfill({json:videoSeed}));
 await page.route('**/files/video.mp4',async route=>{const body=await readFile('tests/fixtures/media/explainer.mp4');const range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),body.length-1):body.length-1;return route.fulfill({status:range?206:200,contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-length':String(end-start+1),...(range?{'content-range':`bytes ${start}-${end}/${body.length}`}:{})},body:body.subarray(start,end+1)});});
 await page.setViewportSize({width:1440,height:900});await page.reload();await page.getByRole('tab',{name:'视频',exact:true}).click();const video=page.getByLabel('视频预览',{exact:true});await video.waitFor();await video.evaluate(v=>new Promise(resolve=>{if(v.readyState>=2)return resolve();v.addEventListener('loadeddata',resolve,{once:true});}));
 await page.locator('.thread-footer textarea').fill('12–18 秒缩短一些');await page.getByText('将针对 初稿 1 · 12–18 秒提交修改').waitFor();await page.locator('.thread-footer form').evaluate(form=>form.requestSubmit());await page.waitForFunction(()=>document.querySelector('.thread-footer textarea').value==='');assert.equal(submitted.feedback[0].kind,'video-range');assert.equal(submitted.feedback[0].endSeconds,18);
 await page.locator('.thread-footer textarea').fill('29–99 秒加一点说明');await page.locator('.thread-footer form').evaluate(form=>form.requestSubmit());await page.getByText('反馈时间超出所选视频时长，请调整范围后重试。文字已保留。').waitFor();assert.equal(await page.locator('.thread-footer textarea').inputValue(),'29–99 秒加一点说明');await page.locator('.thread-footer textarea').fill('');
 await page.screenshot({path:out+'/video-desktop.png'});
 // The feedback entry is one click; typing and screenshots survive reloads and version switches.
 await video.evaluate(v=>{v.pause();v.currentTime=4.2;});await page.waitForFunction(()=>Math.abs(document.querySelector('video[aria-label="视频预览"]').currentTime-4.2)<0.001 && !document.querySelector('video[aria-label="视频预览"]').seeking);
 await page.getByRole('button',{name:'对此处提修改',exact:true}).click();
 assert.match(await page.locator('.feedback-drafts').innerText(),/4\.20 秒/);const note=page.locator('.feedback-drafts textarea').last();await note.fill('保留原来段落，只把重点标清楚');
 await page.reload();await page.locator('.feedback-drafts textarea').last().waitFor();assert.equal(await page.locator('.feedback-drafts textarea').last().inputValue(),'保留原来段落，只把重点标清楚');
 await page.getByRole('tab',{name:'视频',exact:true}).click();await video.evaluate(v=>new Promise(resolve=>{if(v.readyState>=2)return resolve();v.addEventListener('loadeddata',resolve,{once:true});}));
 await page.getByRole('button',{name:'框选画面',exact:true}).click();await page.getByRole('dialog',{name:'框选画面'}).waitFor();
 const region=page.getByRole('group',{name:'画面选区'});await region.focus();await page.keyboard.press('ArrowRight');await page.getByLabel('修改要求',{exact:true}).fill('放大这里的文字');await page.getByText('标注草稿已保存，刷新后可恢复',{exact:true}).waitFor();await page.reload();await page.getByRole('dialog',{name:'框选画面'}).waitFor();assert.equal(await page.getByLabel('修改要求',{exact:true}).inputValue(),'放大这里的文字');assert.equal(await page.locator('.annotation-region').count(),1);await page.getByRole('button',{name:'加入修改要求',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.feedback-drafts textarea').length===2);await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.feedback-drafts textarea').length===2);assert.equal(await page.locator('.feedback-drafts img').count(),1);
 await page.getByRole('tab',{name:'视频',exact:true}).click();
 videoSeed.manifest.versions.push({id:'draft-2',label:'修改版 2',sourcePath:'.yingya/versions/draft-2',videoPath:'video.mp4',createdAt:Date.now()+1});videoSeed.manifest.currentDraft='draft-2';
 await page.reload();await page.getByRole('tab',{name:'视频',exact:true}).click();await page.getByLabel('视频版本',{exact:true}).selectOption('draft-2');
 assert.equal(await page.locator('.feedback-drafts textarea').count(),2);assert.match(await page.locator('.feedback-drafts').innerText(),/初稿 1/);
 assert.equal(requests.some(path=>path.includes('/rollback')),false);
 let createdShare;await page.route(url=>url.pathname==='/api/shares',route=>{if(route.request().method()==='GET')return route.fulfill({json:{shares:[]}});createdShare=route.request().postDataJSON();return route.fulfill({json:{id:'share-1',projectId:seed.id,ownerId:'qa-user',artifactId:'video',title:seed.title,version:'修改版 2',createdAt:1750000000,expiresAt:null,status:'active',bytes:1024,reservedBytesToday:0,url:'/s/'+ 'a'.repeat(64)}});});
 const share=page.getByRole('button',{name:'分享当前视频',exact:true});await share.click();await page.getByRole('dialog',{name:'分享当前视频'}).waitFor();await page.getByRole('button',{name:'创建分享链接',exact:true}).click();await page.getByRole('button',{name:'复制链接',exact:true}).waitFor();assert.equal(createdShare.versionId,'draft-2');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await share.evaluate(el=>document.activeElement===el),true);
 for(const [width,height] of [[390,844],[320,568]]){await page.setViewportSize({width,height});await page.getByRole('button',{name:'视频',exact:true}).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.getByRole('button',{name:'对此处提修改',exact:true}).click();await page.locator('.feedback-drafts textarea').last().waitFor({state:'visible'});await page.locator('.feedback-drafts textarea').last().fill('手机上的时间点意见');const sendBounds=await page.getByRole('button',{name:'发送消息',exact:true}).boundingBox();assert.ok(sendBounds.y+sendBounds.height<=height,`send must stay visible at ${width}`);await page.screenshot({path:`${out}/feedback-${width}.png`});}

 await page.setViewportSize({width:390,height:420});await page.locator('.thread-footer textarea[aria-label="修改描述"]').fill('模拟可视区域变短，发送仍应可见');const compactSend=await page.getByRole('button',{name:'发送消息',exact:true}).boundingBox();assert.ok(compactSend.y+compactSend.height<=420);
 videoSeed.status='failed';videoSeed.statusLabel="Codex 执行失败：Codex turn failed: You've hit your usage limit.";videoSeed.manifest.dirty=true;await page.reload();await page.getByText('制作服务额度已用完。服务恢复后可以继续，已有成果不会丢失。',{exact:false}).waitFor();
 assert.equal(requests.some(path=>path.includes('/video/capabilities')||path.includes('/composition')||path.includes('/footage')),false);
 assert.deepEqual(errors,[]);console.log('PASS knowledge UI: home prompts, no editor/provider, real-content plan view, focused feedback, resize persistence, 4 viewport sizes, bound confirmation, retry, video and range/bounds feedback, screenshot/text draft recovery, history binding across version switches, keyboard annotation, share version and modal focus. API mocked; real sample MP4.');
}catch(error){const page=browser.contexts()[0]?.pages()[0];if(page){await page.screenshot({path:out+'/failure.png'});console.log((await page.locator('body').innerText()).slice(-3500));}throw error;}finally{await browser.close();}
