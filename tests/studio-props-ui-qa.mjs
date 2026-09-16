import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
// Browser plugin unavailable; use Playwright against the specified frontend.
const url = process.env.YINGYA_UI_QA_URL ?? 'http://127.0.0.1:8798';
const output = process.env.YINGYA_STUDIO_QA_OUTPUT ?? '/tmp/yingya-props';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ args: ['--disable-webgl'] });
const errors = [];
async function pixelDifference(page, region) {
  return page.locator('.studio-scene').evaluate((root, [x,y,w,h]) => {
    const active = root.querySelector('canvas');
    const reference = document.createElement('canvas'); reference.width=active.width;reference.height=active.height;
    const ctx=reference.getContext('2d',{alpha:false});
    ctx.drawImage(root.querySelector('img'),0,0,reference.width,reference.height);
    const sx=active.width/1942,sy=active.height/809;
    const box=[Math.ceil(x*sx),Math.ceil(y*sy),Math.floor(w*sx),Math.floor(h*sy)];
    const a=active.getContext('2d').getImageData(...box).data,b=ctx.getImageData(...box).data;
    return a.reduce((sum,value,index)=>sum+(value!==b[index]?1:0),0);
  },region);
}
async function prepare(page) {
  page.on('pageerror', e=>errors.push(e.message));
  await page.goto(url); await page.locator('.studio-illustration').evaluate(i=>i.decode());
  assert.equal(await page.locator('.studio-scene button[title]').count(), 0, 'Illustration hotspots have no native tooltip');
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.title(),'映芽 | 对话式动画视频制作工作台');
  assert.equal(await page.locator('vite-error-overlay').count(),0);
}
async function playing(page) { await page.waitForFunction(()=>document.querySelector('.studio-scene').dataset.rendered==='true'); }
async function settled(page) { await page.waitForFunction(()=>!document.querySelector('.studio-scene').dataset.moving); }
try {
  const page=await browser.newPage({viewport:{width:1440,height:1050}});await prepare(page);
  const scene=page.locator('.studio-scene');const rest=await scene.screenshot();
  for(const [label,region] of [
    ['播放素材盒照片动作',[115,460,280,135]],
    ['播放海景照片动作',[300,630,270,110]],
    ['播放花朵照片动作',[470,650,235,90]],
    ['播放向日葵照片动作',[1555,635,270,125]],
    ['播放文具动作',[1775,400,103,93]],
  ]) {
    const button=page.getByRole('button',{name:label,exact:true});
    for(let pass=0;pass<2;pass++) {
      await button.click(); await playing(page); await page.waitForTimeout(180);
      assert.ok(await pixelDifference(page,region)>50,`${label}: rendered pixels move on every click`);
      assert.equal(await pixelDifference(page,[810,340,480,200]),0,'Monitor content stays fixed');
      assert.equal(await pixelDifference(page,[240,613,200,18]),0,'Box front stays fixed');
      assert.equal(await pixelDifference(page,[1760,510,85,100]),0,'Cup front and lettering stay fixed');
      if(!pass) await page.screenshot({path:`${output}/${label}.png`});
      await settled(page); await page.mouse.move(720,180); await settled(page);
      assert.deepEqual(await scene.screenshot(),rest,'Restores the original illustration exactly');
    }
    await button.focus(); await page.keyboard.press('Enter'); await playing(page); await settled(page);
  }
  for(const name of ['播放海景照片动作','播放花朵照片动作','播放向日葵照片动作']) {
    await page.getByRole('button',{name,exact:true}).hover();await page.waitForTimeout(250);
    assert.equal(await scene.getAttribute('data-rendered'),null,'Loose photos are click-only');
  }
  for(const name of ['播放素材盒照片动作','播放文具动作']) {
    await page.mouse.move(720,180);await page.waitForTimeout(1000);
    await page.getByRole('button',{name,exact:true}).hover();await playing(page);await settled(page);
    await page.waitForTimeout(600);assert.equal(await scene.getAttribute('data-moving'),null,'Hover is a single response');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.locator('.studio-arm-trigger:visible').count(),0);assert.equal(await scene.getAttribute('data-rendered'),null);
  for(const width of [390,320]) {
    const mobile=await browser.newPage({viewport:{width,height:900},isMobile:true,hasTouch:true});await prepare(mobile);
    assert.equal(await mobile.getByRole('button',{name:'播放海景照片动作',exact:true}).isVisible(),false);
    assert.equal(await mobile.getByRole('button',{name:'播放花朵照片动作',exact:true}).isVisible(),false);
    await mobile.getByRole('button',{name:'播放桌面照片动作',exact:true}).tap();await playing(mobile);await mobile.waitForTimeout(220);
    assert.ok(await pixelDifference(mobile,[300,630,265,110])>10,'Grouped touch moves ocean photo');
    assert.ok(await pixelDifference(mobile,[580,660,125,80])>10,'Grouped touch moves flower photo');
    await settled(mobile);
    for(const name of ['播放素材盒照片动作','播放向日葵照片动作','播放文具动作']) {
      const button=mobile.getByRole('button',{name,exact:true});const box=await button.boundingBox();assert.ok(box.width>=40&&box.height>=40);
      await button.tap();await playing(mobile);await settled(mobile);
    }
    assert.equal(await mobile.locator('.marketing-page').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
    await mobile.screenshot({path:`${output}/mobile-${width}.png`});await mobile.close();
  }
  assert.deepEqual(errors,[]);console.log(`Studio props QA passed at ${url}: all five regions visibly animate, repeated clicks, keyboard, click-only photos, hover-once box/tools, fixed monitor/front walls, exact return, 390/320 grouped touch, reduced motion and no page errors. Evidence: ${output}`);
} finally { await browser.close(); }
