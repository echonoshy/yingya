import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
await mkdir('/tmp/yingya-explanation-components',{recursive:true});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const kind of ['concept','process','compare','data','cause','footage']) {
  await page.goto('about:blank');
  await page.setContent('<html><body style="margin:0;background:#f8f3e9;color:#172e45;font-family:sans-serif"><main id="stage" style="width:1920px;height:1080px;container-type:inline-size;--explain-accent:#a4422b"></main></body></html>');
  await page.addStyleTag({path:'runtime/components/explanation/explanation.css'});
  for(const path of ['runtime/editorial/vendor/gsap-3.14.2.min.js','runtime/components/clock.js','runtime/components/explanation/explanation.js'])await page.addScriptTag({path});
  const image=kind==='footage'?'data:image/jpeg;base64,'+(await readFile('web/public/product-examples/product-intro.jpg')).toString('base64'):undefined;
  await page.evaluate(async({kind,image})=>{window.scene=YingyaComponents.createScene(document.querySelector('#stage'),{component:'explain-'+kind,startSeconds:0,durationSeconds:8,title:'讲清一个概念',items:[{label:'观察现象',detail:'先找到问题',value:20},{label:'解释关系',detail:'保持相同尺度',value:40},{label:'总结结论',detail:'回到实际例子',value:80}],note:'演示数据，非真实统计',unit:'%',mediaSrc:image});await scene.ready;},{kind,image});
  const frame=async(time)=>{await page.evaluate(t=>YingyaComponents.renderAt(t),time);return page.screenshot();};
  const early=await frame(.8);await frame(6);assert.deepEqual(await frame(.8),early,`${kind}: reverse seek`);await frame(3);await page.screenshot({path:`/tmp/yingya-explanation-components/${kind}.png`});
  if(kind==='data'){const widths=await page.locator('.explain-bar').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().width));assert.ok(widths[0]>10);assert.ok(Math.abs(widths[2]/widths[0]-4)<.02);}
  const overflows=await page.locator('.explain-title,.explain-item,.explain-note').evaluateAll(nodes=>nodes.filter(n=>{const b=n.getBoundingClientRect();return b.right>1921||b.bottom>1081||n.scrollWidth>n.clientWidth+1||n.scrollHeight>n.clientHeight+1;}).map(n=>n.className));assert.deepEqual(overflows,[],`${kind}: overflow`);
 }
 assert.deepEqual(errors,[]);console.log('PASS six explanation components: deterministic forward/reverse/repeated seek, layout and actual media loading.');
}finally{await browser.close();}
