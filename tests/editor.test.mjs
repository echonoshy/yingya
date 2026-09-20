import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { emptyDocument, newElement, validateDocument, applyCommand, initialState, transact } from '../runtime/editor/model.mjs';
import { compileHTML } from '../runtime/editor/compile.mjs';
import { editStore } from '../runtime/editor/store.mjs';
function fixture() {
 const doc=emptyDocument();const scene={id:'scene-1',name:'第一镜',duration:8,background:'#ffffff',elements:[]};doc.scenes.push(scene);
 scene.elements.push({...newElement('title','text',scene,doc),text:'原始标题',animation:'none'});
 return doc;
}
const request=(revision,command,requestId=`request-${revision}`)=>({expectedRevision:revision,requestId,command});
test('direct text edit preserves unrelated properties and rejects stale writes',()=>{
 const doc=fixture(),state=initialState(doc);const req=request(0,{type:'element.update',sceneId:'scene-1',elementId:'title',patch:{text:'新的标题'}});
 const next=transact(state,req);assert.equal(next.document.scenes[0].elements[0].text,'新的标题');assert.equal(next.document.scenes[0].duration,8);assert.equal(doc.scenes[0].elements[0].text,'原始标题');
 assert.equal(transact(next,req),next);assert.throws(()=>transact(next,{...req,command:{type:'undo'}}),/同一操作/);assert.throws(()=>transact(next,{...req,requestId:'another'}),/REVISION_CONFLICT/);
});
test('undo redo and edit after undo form a persistent branch',()=>{
 let state=initialState(fixture());state=transact(state,request(0,{type:'scene.update',sceneId:'scene-1',patch:{name:'改变'}}));
 state=transact(state,request(1,{type:'undo'}));assert.equal(state.document.scenes[0].name,'第一镜');
 state=transact(state,request(2,{type:'redo'}));assert.equal(state.document.scenes[0].name,'改变');
 state=transact(state,request(3,{type:'undo'}));state=transact(state,request(4,{type:'scene.update',sceneId:'scene-1',patch:{duration:5}}));assert.equal(state.future.length,0);assert.equal(state.document.scenes[0].elements[0].duration,5);
});
test('split preserves trimmed video source offsets and unique layer identities',()=>{
 let doc=fixture(),scene=doc.scenes[0];scene.elements.push({...newElement('clip','video',scene,doc),source:'assets/clip.mp4',sourceIn:10,sourceDuration:30,start:2,duration:6});
 doc=applyCommand(doc,{type:'scene.split',sceneId:scene.id,at:4,newSceneId:'scene-2'});assert.equal(doc.scenes[0].duration,4);assert.equal(doc.scenes[1].duration,4);
 const clip=doc.scenes[1].elements.find(e=>e.kind==='video');assert.equal(clip.sourceIn,12);assert.equal(clip.start,0);assert.equal(clip.duration,4);assert.equal(new Set(doc.scenes.flatMap(s=>s.elements.map(e=>e.id))).size,4);
});
test('rejects out of bounds clips, invalid styles, duplicate ids, and locked edits',()=>{
 const doc=fixture();doc.tracks[1].locked=true;assert.throws(()=>applyCommand(doc,{type:'element.update',sceneId:'scene-1',elementId:'title',patch:{text:'no'}}),/解锁/);
 const bad=fixture();bad.scenes[0].elements[0].color='red;display:none';assert.throws(()=>validateDocument(bad),/配色/);
 assert.throws(()=>applyCommand(fixture(),{type:'scene.add',index:1,scene:fixture().scenes[0]}),/唯一/);
 assert.throws(()=>applyCommand(fixture(),{type:'element.update',sceneId:'scene-1',elementId:'title',patch:{start:6,duration:8}}),/时间/);
});
test('batch is atomic and cannot bypass validation',()=>{
 const doc=fixture();assert.throws(()=>applyCommand(doc,{type:'batch',commands:[{type:'scene.update',sceneId:'scene-1',patch:{name:'should not persist'}},{type:'scene.update',sceneId:'missing',patch:{name:'bad'}}]}));assert.equal(doc.scenes[0].name,'第一镜');
});
test('compiler escapes untrusted copy and emits scene timing plus trimmed audio metadata',()=>{
 const doc=fixture(),scene=doc.scenes[0];scene.elements[0].text='</script><img src=x onerror=alert(1)>';
 scene.elements.push({...newElement('audio','audio',scene,doc),source:'assets/voice.wav',sourceIn:2,sourceDuration:20,volume:.4});
 const html=compileHTML(doc);assert.match(html,/&lt;\/script&gt;/);assert.doesNotMatch(html,/<img src=x/);assert.match(html,/data-media-start="2"/);assert.match(html,/data-volume="0.4"/);assert.match(html,/data-duration="8"/);
});
test('store persists edits, serializes writers and packages immutable dependencies',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'yingya-editor-'));
 try {await mkdir(path.join(root,'assets'));await writeFile(path.join(root,'assets/logo.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
 const doc=fixture();doc.scenes[0].elements.push({...newElement('logo','image',doc.scenes[0],doc),source:'assets/logo.svg'});
 await editStore(root,'init',{document:doc});const req=request(0,{type:'scene.update',sceneId:'scene-1',patch:{name:'已保存'}});
 const attempts=await Promise.allSettled([editStore(root,'command',req),editStore(root,'command',request(0,{type:'scene.remove',sceneId:'scene-1'},'competing'))]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 const state=await editStore(root,'read');assert.equal(state.revision,1);assert.equal(state.canUndo,true);
 if(!state.document.scenes.length)await editStore(root,'command',request(1,{type:'undo'}));
 const revision=(await editStore(root,'read')).revision;
 const snapshot=await editStore(root,'checkpoint',{expectedRevision:revision,requestId:'export-test'});const before=await readFile(path.join(root,snapshot.sourcePath,'assets/logo.svg'),'utf8');await writeFile(path.join(root,'assets/logo.svg'),'changed');assert.equal(await readFile(path.join(root,snapshot.sourcePath,'assets/logo.svg'),'utf8'),before);
 assert.deepEqual(await editStore(root,'checkpoint',{expectedRevision:revision,requestId:'export-test'}),snapshot);
 await editStore(root,'restore',{expectedRevision:revision,versionId:snapshot.versionId});assert.match((await editStore(root,'read')).document.scenes[0].elements[1].source,/\.yingya\/versions\/editor-export-test/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('store refuses symlink escapes and preserves custom HTML',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'yingya-editor-'));
 try{await writeFile(path.join(root,'index.html'),'custom scene');await mkdir(path.join(root,'assets'));await symlink('/etc/passwd',path.join(root,'assets/file'));
 const doc=fixture();doc.scenes[0].elements.push({...newElement('image','image',doc.scenes[0],doc),source:'assets/file'});await assert.rejects(editStore(root,'init',{document:doc}),/软链接/);assert.equal(await readFile(path.join(root,'index.html'),'utf8'),'custom scene');
 await editStore(root,'init',{document:fixture()});assert.equal(await readFile(path.join(root,'index.html'),'utf8'),'custom scene');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('brand revisions reject lost updates; saved templates survive source deletion and remap tracks',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'yingya-editor-library-')),project=path.join(root,'project'),other=path.join(root,'other'),library=path.join(root,'library');
 try{await mkdir(project);await mkdir(other);await mkdir(path.join(project,'assets'));await writeFile(path.join(project,'assets/logo.svg'),'<svg/>');const doc=fixture();doc.scenes[0].elements.push({...newElement('logo','image',doc.scenes[0],doc),source:'assets/logo.svg'});await editStore(project,'init',{document:doc});
 const brand={id:'brand-one',name:'映芽',font:'sans',foreground:'#24262b',background:'#ffffff',accent:'#006bd6'};
 await editStore(project,'brand-save',{brand,expectedRevision:0},library);await assert.rejects(editStore(project,'brand-save',{brand,expectedRevision:0},library),/REVISION_CONFLICT/);
 const {template}=await editStore(project,'template-save',{expectedRevision:0,sceneId:'scene-1',name:'可复用镜头'},library);await rm(project,{recursive:true,force:true});await editStore(other,'init',{document:emptyDocument()});const loaded=await editStore(other,'template-load',{id:template.id},library);await editStore(other,'command',request(0,loaded.command));const state=await editStore(other,'read');assert.equal(state.document.scenes.length,1);assert.notEqual(state.document.scenes[0].id,'scene-1');assert.equal(await readFile(path.join(other,state.document.scenes[0].elements[1].source),'utf8'),'<svg/>');assert.equal((await editStore(other,'library-list',{},library)).brands[0].revision,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('brand logo dependencies survive their original project and apply as editable elements',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'yingya-brand-')),project=path.join(root,'p'),other=path.join(root,'q'),library=path.join(root,'library');
 try { await mkdir(project);await mkdir(other);await mkdir(path.join(project,'assets'));await writeFile(path.join(project,'assets/logo.png'),Buffer.from('logo-bytes'));await editStore(project,'init',{document:fixture()});
 const brand={id:'brand-logo',name:'品牌',font:'sans',foreground:'#24262b',background:'#ffffff',accent:'#006bd6',logoSource:'assets/logo.png'};
 await editStore(project,'brand-save',{brand,expectedRevision:0},library);await rm(project,{recursive:true,force:true});await editStore(other,'init',{document:fixture()});
 const loaded=await editStore(other,'brand-load',{id:brand.id},library);assert.equal(await readFile(path.join(other,loaded.brand.logoSource),'utf8'),'logo-bytes');
 const state=await editStore(other,'command',request(0,{type:'brand.apply',brand:loaded.brand}));assert.equal(state.document.scenes[0].elements.at(-1).source,loaded.brand.logoSource);
 } finally {await rm(root,{recursive:true,force:true});}
});
