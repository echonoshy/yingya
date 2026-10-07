import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {browserPath} from '../runtime/browser.mjs';
import {mkdir} from 'node:fs/promises';
// Browser plugin not available. Actual pointer, touch and keyboard events on the rendered UI.
const base=process.env.YINGYA_UI_QA_URL||'http://127.0.0.1:8798';
const output=process.env.YINGYA_QA_OUTPUT||'/tmp/yingya-typefx';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:browserPath()});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const trigger=page.getByRole('button',{name:'有画面 点字玩一下',exact:true});
const active=type=>page.waitForFunction(t=>document.querySelector('.home-selected-word').dataset.running===t,type);
const settled=()=>page.waitForFunction(()=>!document.querySelector('.home-selected-word').dataset.running);
const inkPixels=()=>document.querySelector('.hero-type-particles').getContext('2d').getImageData(0,0,document.querySelector('.hero-type-particles').width,document.querySelector('.hero-type-particles').height).data.filter((v,i)=>i%4===3&&v>0).length;
try{
 await page.goto(base);await trigger.waitFor();await page.evaluate(()=>document.fonts.ready);
 await page.locator('#home-idea').fill('已有的内容一直保留');
 const originalHeight=await page.locator('.home-input-row').evaluate(el=>el.getBoundingClientRect().y);
 await trigger.hover({position:{x:20,y:20}});
 assert.notEqual(await page.locator('.hero-type-face').evaluate(el=>el.style.transform),'');
 await page.mouse.move(0,0);await page.waitForFunction(()=>document.querySelector('.hero-type-face').style.transform==='');
 for(const mode of ['粒子','打字']){
  const control=page.getByRole('button',{name:mode,exact:true});await control.focus();await page.keyboard.press('Enter');
  await active(mode==='粒子'?'particles':'type');await page.waitForTimeout(250);
  assert.ok(await control.evaluate(el=>el===document.activeElement),'Effects preserve keyboard focus');
  assert.equal(await control.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#home-idea').inputValue(),'已有的内容一直保留');
  assert.equal(await page.locator('.home-input-row').evaluate(el=>el.getBoundingClientRect().y),originalHeight,'Glyph effects do not move the composer');
  if(mode==='粒子') assert.ok(await page.evaluate(inkPixels)>150,'Real particles paint the canvas');
  else assert.ok(await page.locator('.kinetic-letter').filter({visible:true}).count()>=3);
  await page.screenshot({path:output+'/'+(mode==='粒子'?'particle-burst':'typewriter')+'.png'});
  await settled();assert.equal(await page.locator('.hero-type-face').innerText(),'有画面');
  assert.equal(await page.locator('.hero-type-face').evaluate(el=>getComputedStyle(el).opacity),'1');
 }
 for(const label of ['粒子','打字','立体','粒子','打字','粒子']) await page.getByRole('button',{name:label,exact:true}).click();
 await active('particles');await page.locator('#home-idea').focus();await settled();
 assert.equal(await page.evaluate(inkPixels),0,'Editing clears particle work');
 await trigger.click();await active('particles');
 await page.emulateMedia({reducedMotion:'reduce'});await settled();assert.equal(await page.evaluate(inkPixels),0);
 for(const label of ['打字','粒子','立体']){await page.getByRole('button',{name:label,exact:true}).click();await trigger.click();assert.equal(await trigger.getAttribute('data-running'),null);assert.equal(await page.locator('.hero-type-face').innerText(),'有画面');}
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('button',{name:'粒子',exact:true}).click();await active('particles');
 await page.locator('.home-footer').scrollIntoViewIfNeeded();await settled();assert.equal(await page.evaluate(inkPixels),0,'Offscreen effects stop');
 await trigger.scrollIntoViewIfNeeded();await trigger.click();await active('particles');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await settled();
 await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
 await page.getByRole('button',{name:'打字',exact:true}).click();await active('type');
 await page.emulateMedia({reducedMotion:'reduce'});await settled();assert.equal(await page.locator('.hero-type-face').innerText(),'有画面');
 for(const width of [320,390,768,1280,1440,1536,1920]){
  await page.setViewportSize({width,height:width===320?568:900});await page.locator('.marketing-page').evaluate(el=>el.scrollTo({top:0,behavior:'instant'}));
  assert.ok(await page.locator('.marketing-page').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`No overflow ${width}`);
  assert.ok(await page.getByRole('button',{name:'准备创作',exact:true}).evaluate(el=>el.getBoundingClientRect().bottom<=innerHeight),`Composer fits ${width}`);
  for(const control of await page.locator('.hero-type-tools button').all()) assert.ok(await control.evaluate(el=>el.getBoundingClientRect().height>=40));
  await page.screenshot({path:output+'/hero-'+width+'.png'});
 }
 const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base);
 await mobile.getByRole('button',{name:'粒子',exact:true}).tap();await mobile.waitForFunction(()=>document.querySelector('.home-selected-word').dataset.running==='particles');
 await mobile.getByRole('button',{name:'打字',exact:true}).tap();await mobile.waitForFunction(()=>document.querySelector('.home-selected-word').dataset.running==='type');
 await mobile.waitForFunction(()=>!document.querySelector('.home-selected-word').dataset.running);await mobile.close();
 const fallback=await browser.newPage();fallback.on('pageerror',e=>errors.push(e.message));await fallback.addInitScript(()=>{HTMLCanvasElement.prototype.getContext=()=>null;});await fallback.goto(base);
 await fallback.getByRole('button',{name:'粒子',exact:true}).click();assert.equal(await fallback.locator('.hero-type-face').innerText(),'有画面');assert.equal(await fallback.locator('.hero-type-face').evaluate(el=>getComputedStyle(el).opacity),'1');await fallback.close();
 assert.deepEqual(errors,[]);console.log(`PASS ${base}: 3D pointer/reset; real particle pixels; GSAP typewriter; keyboard/touch; stable composer and draft; rapid replacement; input/offscreen/hidden/reduced-motion cancellation; canvas fallback; seven responsive widths.`);
}finally{await browser.close();}
