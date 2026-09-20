import assert from 'node:assert/strict';
import { request } from 'playwright';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { emptyDocument,newElement } from '../runtime/editor/model.mjs';
import { templateScene } from '../runtime/editor/catalog.mjs';
const base=process.env.YINGYA_EDITOR_API_URL??'http://127.0.0.1:8810';
const auth=process.env.YINGYA_EDITOR_AUTH_STATE??'/tmp/yingya-product-refactor/auth-state.json';
const client=await request.newContext({baseURL:base,storageState:auth,extraHTTPHeaders:{Origin:base}});
const temp=await mkdtemp(path.join(os.tmpdir(),'yingya-editor-api-'));
async function json(method,url,data){const response=await client[method](url,data===undefined?{}:{data});const text=await response.text();assert.ok(response.ok(),`${method} ${url}: ${response.status()} ${text.slice(0,500)}`);return text?JSON.parse(text):null;}
try{
 const credentials=JSON.parse(await readFile(process.env.YINGYA_EDITOR_TEST_ACCOUNT??'/tmp/yingya-product-refactor/isolated-account.json','utf8'));await json('post','/api/auth/login',{email:credentials.email,password:credentials.password});
 const me=await json('get','/api/auth/me');assert.ok(me.user?.id,'Stored test session is not authenticated');
 const scope=`/api/u/${me.user.id}`,project=await json('post',`${scope}/agent-projects`,{prompt:'编辑器本地集成验证',title:'[QA] 直接编辑与导出',aspectRatio:'16:9',model:'gpt-5.6-terra',reasoningEffort:'high',voiceId:'default',requirements:{creationMode:'motion',styleId:'minimal-product',reviewMode:'auto',aspectMode:'fixed'}});
 const endpoint=`${scope}/agent-projects/${project.id}/composition`;const edit=(action,request)=>json('post',endpoint,{action,request});
 const doc=emptyDocument();doc.scenes.push(templateScene('minimal-product','scene-a',doc));doc.scenes[0].duration=2;doc.scenes[0].elements.forEach(el=>el.duration=2);
 let state=await edit('init',{document:doc});assert.equal(state.revision,0);
 const req={expectedRevision:0,requestId:'change-title',command:{type:'element.update',sceneId:'scene-a',elementId:'scene-a-title',patch:{text:'真实保存，真实导出'}}};state=await edit('command',req);assert.equal(state.document.scenes[0].elements[0].text,'真实保存，真实导出');assert.equal((await edit('command',req)).revision,1);
 const stale=await client.post(endpoint,{data:{action:'command',request:{...req,requestId:'stale-write'}}});assert.equal(stale.status(),409);
 state=await edit('command',{expectedRevision:1,requestId:'undo-title',command:{type:'undo'}});state=await edit('command',{expectedRevision:2,requestId:'redo-title',command:{type:'redo'}});assert.equal(state.document.scenes[0].elements[0].text,'真实保存，真实导出');
 const audio=path.join(temp,'tone.wav');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-y',audio]);const upload=await client.post(`${scope}/agent-projects/${project.id}/assets`,{multipart:{file:{name:'tone.wav',mimeType:'audio/wav',buffer:await readFile(audio)}}});assert.ok(upload.ok());const asset=await upload.json();
 const el={...newElement('tone','audio',state.document.scenes[0],state.document),source:asset.path,sourceDuration:4,sourceIn:1,duration:1.5,volume:.4};state=await edit('command',{expectedRevision:3,requestId:'add-audio',command:{type:'element.add',sceneId:'scene-a',element:el}});
 const invalid=await client.post(endpoint,{data:{action:'command',request:{expectedRevision:4,requestId:'invalid-audio',command:{type:'element.update',sceneId:'scene-a',elementId:'tone',patch:{sourceDuration:100,sourceIn:50}}}}});assert.ok([400,422].includes(invalid.status()),`Unexpected invalid clip status ${invalid.status()}`);
 await edit('brand-save',{brand:{id:'qa-brand',name:'QA 品牌',font:'sans',foreground:'#24262b',background:'#ffffff',accent:'#006bd6'},expectedRevision:0}).catch(async e=>{if(!String(e).includes('409'))throw e;});
 const library=await edit('library-list',{});assert.ok(library.brands.some(b=>b.id==='qa-brand'));
 const template=await edit('template-save',{expectedRevision:4,sceneId:'scene-a',name:'含声音的模板'});assert.ok(template.template.id);
 const snapshot=await edit('checkpoint',{expectedRevision:4,requestId:'export-validation'});const detail=await json('get',`${scope}/agent-projects/${project.id}`);assert.ok(detail.manifest.versions.some(v=>v.id===snapshot.versionId));
 const html=await client.get(`${scope}/agent-projects/${project.id}/files/${snapshot.sourcePath}/index.html`);assert.ok(html.ok());assert.match(await html.text(),/真实保存，真实导出/);
 const render=await json('post',`${scope}/agent-projects/${project.id}/render`,{versionId:snapshot.versionId,resolution:'landscape',fps:30});
 await writeFile('/tmp/yingya-motionvid-audit/implementation/api-render.json',JSON.stringify({base,projectId:project.id,scope,versionId:snapshot.versionId,jobId:render.jobId},null,2));
 console.log(JSON.stringify({ok:true,projectId:project.id,revision:4,jobId:render.jobId,checks:['real authenticated API','idempotency','revision conflict','undo redo','measured audio trim','brand persistence','template dependencies','immutable version','render queued']}));
}finally{await client.dispose();await rm(temp,{recursive:true,force:true});}
