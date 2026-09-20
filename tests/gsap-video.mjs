// Opt-in browser acceptance for the release-owned GSAP plugin bundle.
// Builds hand-authored fixtures; this is not evidence of model generation quality.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, cp, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { install } from '../skills/yingya-video-agent/scripts/install-gsap.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const out = path.resolve(process.argv[2] || '.runtime/gsap-video-validation');
await mkdir(out, { recursive: true });
const fonts = path.join(repo, 'node_modules/@fontsource-variable/noto-sans-sc');
const fontCSS = (await readFile(path.join(fonts, 'index.css'), 'utf8')).replaceAll('url(./files/', 'url(assets/fonts/files/');
const circle = 'M640 245 C706 245 760 299 760 365 C760 431 706 485 640 485 C574 485 520 431 520 365 C520 299 574 245 640 245 Z';
const diamond = 'M640 235 L775 365 L640 495 L505 365 Z';
const fixtures = [
  { id: 'text', title: '让想法动起来', note: '每一个字，都有自己的出场时刻。', plugins: ['SplitText'],
    content: '<div class="type-stage"><h1 id="headline">让想法动起来</h1><div id="underline"></div></div>',
    motion: `const split=SplitText.create('#headline',{type:'chars',charsClass:'letter'});
      split.chars[0].id='first';split.chars.at(-1).id='last';
      tl.fromTo(split.chars,{opacity:0,y:65,rotation:5},{opacity:1,y:0,rotation:0,duration:1.1,stagger:.19,ease:'power3.out'},.3);
      tl.fromTo('#underline',{scaleX:0},{scaleX:1,duration:1.2,ease:'expo.inOut'},1.8);`,
    assertions: [{kind:'appearsBy',selector:'#first',bySec:1.2},{kind:'appearsBy',selector:'#last',bySec:2.5},{kind:'before',a:'#first',b:'#last'}] },
  { id: 'path', title: '信息沿着关系流动', note: '从输入到输出，路径让过程清晰可见。', plugins: ['DrawSVGPlugin', 'MotionPathPlugin'],
    content: `<h1>信息沿着关系流动</h1><svg viewBox="0 0 1280 390" aria-label="输入经整理传递到输出">
      <path id="track" d="M200 230 C340 230 360 80 640 80 S920 230 1080 230" fill="none" stroke="#ddd5c9" stroke-width="5"/>
      <path id="route" d="M200 230 C340 230 360 80 640 80 S920 230 1080 230" fill="none" stroke="#b44933" stroke-width="7"/>
      <circle id="packet" transform="translate(200 230)" r="15" fill="#b44933" stroke="#f8f3e9" stroke-width="5"/>
      <g class="node" id="input-node"><circle cx="200" cy="230" r="7"/><text x="200" y="300">输入</text></g>
      <g class="node"><circle cx="640" cy="80" r="7"/><text x="640" y="155">整理</text></g>
      <g class="node"><circle cx="1080" cy="230" r="7"/><text x="1080" y="300">输出</text></g>
      </svg>`,
    motion: `tl.fromTo('h1',{opacity:0,y:16},{opacity:1,y:0,duration:.8,ease:'power2.out'},.15);
      tl.fromTo('.node',{opacity:0},{opacity:1,duration:.5,stagger:.4,ease:'sine.out'},.3);
      tl.fromTo('#route',{drawSVG:'0%'},{drawSVG:'100%',duration:3.8,ease:'none'},.5);
      tl.to('#packet',{motionPath:{path:'#track',align:'#track',alignOrigin:[.5,.5]},duration:3.8,ease:'none'},.5);`,
    assertions: [{kind:'appearsBy',selector:'#input-node',bySec:1.7},{kind:'staysInFrame',selector:'#packet'}] },
  { id: 'morph', title: '同一个想法，多一种表达', note: '形态在变化，表达保持连贯。', plugins: ['MorphSVGPlugin'],
    content: `<h1>同一个想法，多一种表达</h1><svg viewBox="0 0 1280 500" aria-label="圆形变为菱形再回到圆形"><path id="shape" d="${circle}" fill="#b44933"/></svg>`,
    motion: `tl.fromTo('h1',{opacity:0,y:18},{opacity:1,y:0,duration:.8,ease:'power2.out'},.15);
      tl.fromTo('#shape',{morphSVG:${JSON.stringify(circle)}},{morphSVG:${JSON.stringify(diamond)},duration:1.4,ease:'power3.inOut',repeat:1,repeatDelay:.7,yoyo:true},.6);`,
    assertions: [{kind:'staysInFrame',selector:'#shape'}] },
];
for (const f of fixtures) {
  const root = path.join(out, f.id);
  await mkdir(root, { recursive: true });
  const bundle = await install(root, f.plugins);
  await cp(path.join(fonts, 'files'), path.join(root, 'assets/fonts/files'), { recursive: true });
  await copyFile(path.join(fonts, 'LICENSE'), path.join(root, 'assets/fonts/LICENSE'));
  await writeFile(path.join(root, 'DESIGN.md'), `# ${f.title}\n\n## Style Prompt\nWarm paper, deep blue Chinese typography and vermilion motion accents. A spacious editorial animation study.\n\n## Colors\nPaper #f8f3e9, ink #172e45, accent #b44933.\n\n## Typography\nLocal Noto Sans SC Variable, strong display weight and regular explanatory text.\n\n## Motion\nFixed 1280×720, 6 seconds, finite paused GSAP timeline.\n\n## What NOT to Do\nNo remote scripts, pointer triggers or autoplay. No changing the semantic content.\n\n## Evidence\nHand-authored integration acceptance; not an AI-generated result.\n`);
  await writeFile(path.join(root, 'hyperframes.json'), JSON.stringify({name:`gsap-${f.id}`,fps:30}));
  await writeFile(path.join(root, 'index.motion.json'), JSON.stringify({duration:6,assertions:[...f.assertions,{kind:'staysInFrame',selector:'#note'}]},null,2));
  await writeFile(path.join(root, 'index.html'), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${fontCSS}
    *{box-sizing:border-box}html,body{margin:0;background:#f8f3e9;color:#172e45;font-family:'Noto Sans SC Variable',sans-serif}
    #main{position:relative;width:1280px;height:720px;overflow:hidden;background:#f8f3e9;padding:48px 0}
    header{padding:0 80px;display:flex;justify-content:space-between;font-size:20px;font-weight:600;color:#b44933}
    h1{font-size:54px;line-height:1.3;font-weight:800;margin:38px 80px 0;letter-spacing:-1px}
    .type-stage{height:480px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px}
    .type-stage h1{font-size:100px;margin:0;line-height:1.4}#underline{width:740px;height:6px;background:#b44933;transform-origin:left center}
    svg{display:block;width:1280px;height:${f.id==='morph'?365:390}px;overflow:visible}
    svg text{font-family:'Noto Sans SC Variable',sans-serif;font-size:34px;text-anchor:middle;fill:#172e45;font-weight:650}
    .node circle{fill:#172e45}footer{position:absolute;left:80px;bottom:54px;font-size:25px}
    </style>${bundle.scripts.map(src=>`<script src="${src}"></script>`).join('')}</head><body>
    <main id="main" data-composition-id="main" data-start="0" data-duration="6" data-width="1280" data-height="720"><header><span>映芽 / 动效研究</span><span>${String(fixtures.indexOf(f)+1).padStart(2,'0')} — 03</span></header>${f.content}<footer id="note">${f.note}</footer></main>
    <script>document.fonts.ready.then(()=>{gsap.registerPlugin(${f.plugins.join(',')});const tl=gsap.timeline({paused:true});${f.motion}
    tl.fromTo('#note',{opacity:0,y:12},{opacity:1,y:0,duration:.7,ease:'sine.out'},3.7);
    window.__timelines=window.__timelines||{};window.__timelines.main=tl;window.__hfForceTimelineRebind?.();});</script></body></html>`);
}

const server = createServer(async (req,res) => {
  try {
    const requested=path.resolve(out, `.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);
    assert.ok(requested.startsWith(out+path.sep));
    res.setHeader('Content-Type', requested.endsWith('.js')?'text/javascript':requested.endsWith('.html')?'text/html':requested.endsWith('.woff2')?'font/woff2':'application/octet-stream');
    res.end(await readFile(requested));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,...(process.env.HYPERFRAMES_BROWSER_PATH?{executablePath:process.env.HYPERFRAMES_BROWSER_PATH}:{}),args:['--no-sandbox']});
const report = {origin:'hand-authored runtime acceptance, not AI generation',fixtures:[]};
try {
  for(const f of fixtures) {
    const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const url=`http://127.0.0.1:${server.address().port}/${f.id}/index.html`;
    const ready=async()=>{await page.goto(url);await page.waitForFunction(()=>Boolean(window.__timelines?.main));};
    const frame=async(t,name)=>{await page.evaluate(time=>{window.__timelines.main.totalTime(time,false);},t);return page.screenshot({path:path.join(out,f.id,name)});};
    await ready();
    const early=await frame(.8,'early.png');
    const middle=await frame(2,'middle.png');
    if(f.id==='text'){
      const chars=await page.locator('#headline').innerText();assert.equal(chars,'让想法动起来');
      await page.evaluate(()=>{window.__timelines.main.totalTime(.8,false);});
      const opacity=await page.locator('.letter').evaluateAll(nodes=>nodes.map(el=>Number(getComputedStyle(el).opacity)));
      assert.equal(opacity.length,6);assert.ok(opacity[0]>opacity[5]);
    }
    if(f.id==='path'){
      const position=await page.locator('#packet').getAttribute('transform');
      await frame(4.5,'path-end.png');assert.notEqual(await page.locator('#packet').getAttribute('transform'),position);
      const style=await page.locator('#route').getAttribute('style');assert.ok(style.includes('stroke-dash'));
    }
    if(f.id==='morph'){
      const changed=await page.locator('#shape').getAttribute('d');
      await frame(4.5,'morph-return.png');assert.notEqual(await page.locator('#shape').getAttribute('d'),changed);
    }
    const late=await frame(5.5,'late.png');
    const backward=await frame(2,'backward.png');assert.ok(middle.equals(backward),`${f.id}: backward seek changes pixels`);
    const repeated=await frame(2,'repeated.png');assert.ok(middle.equals(repeated),`${f.id}: repeated seek changes pixels`);
    await ready();const direct=await frame(2,'fresh-direct.png');assert.ok(middle.equals(direct),`${f.id}: fresh seek changes pixels`);
    assert.ok(!early.equals(late),`${f.id}: no visible motion`);assert.deepEqual(errors,[]);
    report.fixtures.push({id:f.id,plugins:f.plugins,backwardSeek:true,repeatedSeek:true,freshDirectSeek:true,visibleMotion:true,errors});
    await page.close();
  }
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
await writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
