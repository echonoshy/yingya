// Opt-in network/render acceptance test. Uses current upstream React Bits source,
// so an upstream change that invalidates an adaptation fails explicitly.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
assert.ok(args.filter(arg => arg.startsWith('--')).every(arg => arg === '--verify-only'), 'Supported option: --verify-only');
const project = path.resolve(args.find(arg => !arg.startsWith('--')) || '.runtime/component-video-validation');
const helper = path.join(repo, 'runtime/component-library.mjs');
const stage = message => console.error(`[component-video ${new Date().toISOString()}] ${message}`);
const bounded = async (label, operation, timeout = 20000) => {
  stage(label);
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout} ms`)), timeout);
    })]);
  } finally { clearTimeout(timer); }
};
await mkdir(project, { recursive: true });
const run = (...args) => JSON.parse(execFileSync(process.execPath, [helper, ...args, '--project', project], {
  cwd: repo, encoding: 'utf8', timeout: 240000, maxBuffer: 8 * 1024 * 1024,
}));
const replace = (source, before, after) => {
  assert.ok(source.includes(before), `Upstream changed: missing ${before.slice(0,80)}`);
  return source.replace(before, after);
};
let results = {};
if (!verifyOnly) {
await access(path.join(project, 'index.html')).then(() => { throw new Error('Use a fresh validation directory, or --verify-only to repeat browser checks'); }, () => {});
stage('Importing upstream components');
await writeFile(path.join(project, 'DESIGN.md'), `# Component integration acceptance film
## Style Prompt
An energetic cinematic type specimen: a luminous teal, blue and violet aurora behind clear white typography.
## Colors
Canvas #050812; headline #ffffff; aurora #37f7ce, #437bff, #b983ff.
## Typography
Arial bold display, Arial regular supporting copy. Keep text readable above the shader.
## What NOT to Do
No pointer or scroll dependency. No live clocks. No imitation of the shader with static gradients.
`);
for (const component of ['Aurora-TS-CSS', 'SplitText-TS-CSS']) {
  stage(`Import ${component}`);
  results[component] = run('add', '--component', `@react-bits/${component}`);
}
const componentPath = (name, file) => path.join(project, 'component-library/imports', name, 'src/components', file);
let aurora = await readFile(componentPath('Aurora-TS-CSS','Aurora.tsx'), 'utf8');
aurora = replace(aurora, 'useEffect, useRef', 'useLayoutEffect, useRef');
aurora = replace(aurora, 'useEffect(() => {', 'useLayoutEffect(() => {');
aurora = replace(aurora, 'alpha: true,', 'alpha: true,\n      preserveDrawingBuffer: true,');
aurora = replace(aurora, '    let animateId = 0;', '');
aurora = replace(aurora, '      animateId = requestAnimationFrame(update);', '');
aurora = replace(aurora, 'time = t * 0.01', 'time = t * 10');
aurora = replace(aurora, '    animateId = requestAnimationFrame(update);', '    (window as any).__renderAuroraAt = update;');
aurora = replace(aurora, '    resize();', '    resize();\n    update(0);');
aurora = replace(aurora, '      cancelAnimationFrame(animateId);', '      delete (window as any).__renderAuroraAt;');
await writeFile(componentPath('Aurora-TS-CSS','Aurora.tsx'), aurora);

let split = await readFile(componentPath('SplitText-TS-CSS','SplitText.tsx'),'utf8');
split = replace(split, "import { ScrollTrigger } from 'gsap/ScrollTrigger';", '');
split = replace(split, 'gsap.registerPlugin(ScrollTrigger, GSAPSplitText, useGSAP);', 'gsap.registerPlugin(GSAPSplitText, useGSAP);');
split = replace(split, 'useState<boolean>(false)', "useState<boolean>(document.fonts.status === 'loaded')");
split = replace(split, '          return gsap.fromTo(', '          const animation = gsap.fromTo(');
split = replace(split, `              scrollTrigger: {
                trigger: el,
                start,
                once: true,
                fastScrollEnd: true,
                anticipatePin: 0.4
              },`, '              paused: true,');
split = replace(split, `          );
        }`, `          );
          (window as any).__splitAnimation = animation;
          return animation;
        }`);
split = replace(split, `        ScrollTrigger.getAll().forEach(st => {
          if (st.trigger === el) st.kill();
        });`, '');
await writeFile(componentPath('SplitText-TS-CSS','SplitText.tsx'), split);
await writeFile(path.join(project, 'component-library/entry.tsx'), `import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { gsap } from 'gsap';
import Aurora from './imports/Aurora-TS-CSS/src/components/Aurora';
import SplitText from './imports/SplitText-TS-CSS/src/components/SplitText';
import './film.css';
const w = window as any;
export async function mountVideoScene() {
  await document.fonts.ready;
  flushSync(() => createRoot(document.getElementById('react-stage')!).render(<>
    <div className="aurora-layer" data-layout-ignore><Aurora colorStops={['#37f7ce','#437bff','#b983ff']} amplitude={1.15} speed={1.4} /></div>
    <div className="content"><p id="eyebrow">YINGYA · COMPONENT STUDY</p>
      <div id="headline"><SplitText text="IDEAS IN MOTION" tag="h1" delay={75} duration={1.4} from={{opacity:0,y:70,rotateX:-45}} to={{opacity:1,y:0,rotateX:0}} /></div>
      <p id="subtitle">Original React Bits effects. One video timeline.</p>
    </div>
  </>));
  if (!w.__renderAuroraAt || !w.__splitAnimation) throw new Error('Components did not initialize synchronously after fonts');
  const characters = document.querySelectorAll('.split-char');
  if (characters.length < 2) throw new Error('SplitText did not split the headline');
  characters[0].id = 'headline-first';
  characters[characters.length - 1].id = 'headline-last';
  const clock = { time: 0 };
  const tl = gsap.timeline({paused:true});
  tl.to(clock,{time:6,duration:6,ease:'none',onUpdate:()=>w.__renderAuroraAt(clock.time)},0);
  tl.add(w.__splitAnimation.paused(false),0.35);
  tl.fromTo('#eyebrow',{opacity:0,y:12},{opacity:1,y:0,duration:0.6},0.1);
  tl.fromTo('#subtitle',{opacity:0,y:18},{opacity:1,y:0,duration:0.8},2);
  // Return a wrapper: GSAP's timeline is thenable and must not be assimilated
  // by the async function's promise before the renderer starts seeking it.
  return { timeline: tl };
}
`);
await writeFile(path.join(project, 'component-library/film.css'), `html,body{margin:0;background:#050812;color:#fff;font-family:Arial,sans-serif}*{box-sizing:border-box}#main,#react-stage{position:relative;width:1280px;height:720px;overflow:hidden}.aurora-layer{position:absolute;inset:0;opacity:.85}.content{position:relative;display:flex;width:100%;height:100%;padding:120px 80px;flex-direction:column;justify-content:center;gap:24px;background:linear-gradient(180deg,transparent,rgba(5,8,18,.82))}h1{font-size:76px;font-weight:700;letter-spacing:-3px;line-height:1.25;margin:0}#headline{width:100%;text-align:center}#eyebrow{font-size:16px;letter-spacing:4px;text-align:center;margin:0}#subtitle{font-size:22px;text-align:center;margin:0;color:#fff}`);
stage('Building adapted components');
results.build = run('build','--entry','component-library/entry.tsx','--out','assets/components');
await writeFile(path.join(project,'hyperframes.json'),JSON.stringify({paths:{blocks:'compositions',components:'compositions/components',assets:'assets'}}));
await writeFile(path.join(project,'index.html'), `<!doctype html><html lang="en"><head><meta charset="UTF-8"><link rel="stylesheet" href="${results.build.styles}"></head><body><div id="main" data-composition-id="main" data-start="0" data-duration="6" data-width="1280" data-height="720"><div id="react-stage"></div></div><script type="module">
import { mountVideoScene } from './${results.build.script}';
mountVideoScene().then(({ timeline }) => {
  window.__timelines = window.__timelines || {};
  window.__timelines['main'] = timeline;
  window.__hfForceTimelineRebind?.();
});
</script></body></html>`);
await writeFile(path.join(project,'index.motion.json'),JSON.stringify({duration:6,assertions:[{kind:'appearsBy',selector:'#headline-first',bySec:1},{kind:'appearsBy',selector:'#headline-last',bySec:3},{kind:'before',a:'#headline-first',b:'#headline-last'},{kind:'staysInFrame',selector:'#headline'},{kind:'staysInFrame',selector:'#subtitle'}]},null,2));
await writeFile(path.join(project,'component-library/ADAPTATION.md'),`Imported upstream source and shader are retained. Aurora's requestAnimationFrame loop is replaced with an absolute-time renderer, with a persistent drawing buffer for capture. SplitText retains its GSAP SplitText implementation and tween parameters; its scroll trigger is replaced with a paused tween attached to the main timeline. React initializes after local fonts are ready. See imports/* provenance for the originals and licenses.\n`);
await writeFile(path.join(project, 'acceptance-inputs.json'), JSON.stringify(results, null, 2));
} else {
  stage('Reusing existing source and bundle without installation');
  await access(path.join(project, 'index.html'));
  results = await readFile(path.join(project, 'acceptance-inputs.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  const manifest = JSON.parse(await readFile(path.join(project, 'assets/components/build.json'), 'utf8'));
  results.build ??= { script: 'assets/components/entry.js', styles: Object.hasOwn(manifest.generatedFiles, 'entry.css') ? 'assets/components/entry.css' : null, manifest: 'assets/components/build.json' };
}
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    const file=path.resolve(project,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(project+path.sep))throw new Error('outside project');
    const content=await readFile(file);
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
    res.end(content);
  }catch{res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
stage(`Fixture HTTP server listening on ${server.address().port}`);
let browser;
try{
  browser=await bounded('Launch browser', () => chromium.launch({headless:true,timeout:15000,...(process.env.HYPERFRAMES_BROWSER_PATH?{executablePath:process.env.HYPERFRAMES_BROWSER_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']}));
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console', message => { if (message.type() === 'error') stage(`Browser console: ${message.text()}`); });
  await bounded('Load fixture', () => page.goto(`http://127.0.0.1:${server.address().port}/`));
  await bounded('Wait for mounted components and timeline', () => page.waitForFunction(()=>Boolean(window.__timelines?.main),{},{timeout:15000}));
  const charactersAt=async(time)=>bounded(`Inspect characters at ${time}s`, () => page.evaluate(t=>{
    window.__timelines.main.totalTime(t,false);
    return Array.from(document.querySelectorAll('.split-char')).map(el=>Number(getComputedStyle(el).opacity));
  },time));
  const initial=await charactersAt(0.2);
  const entering=await charactersAt(1);
  const complete=await charactersAt(3);
  assert.ok(initial.length>8,'Actual SplitText characters must exist');
  assert.ok(initial.every(value=>value<0.01),'Text must start hidden');
  assert.ok(entering[0]>entering.at(-1),'Letters must reveal in sequence');
  assert.ok(complete.every(value=>value>0.99),'Every letter must become visible');
  const frame=async(time,file)=>{
    // GSAP timelines are thenables. Returning totalTime() makes Playwright wait
    // forever for a paused timeline to complete; return no timeline object.
    await bounded(`Seek to ${time}s`, () => page.evaluate(t=>{ window.__timelines.main.totalTime(t,false); },time));
    return bounded(`Capture ${file}`, () => page.screenshot({path:path.join(project,file),timeout:15000}));
  };
  const first=await frame(3,'seek-3.png');
  const later=await frame(5,'seek-5.png');
  const replay=await frame(3,'seek-3-replay.png');
  assert.deepEqual(errors,[]);
  assert.equal(first.equals(replay),true,'Out-of-order seeking must reproduce the same frame');
  assert.equal(first.equals(later),false,'Shader animation must change the pixels');
  results.browser={ok:true,outOfOrderSeek:true,animatedPixels:true,splitTextStagger:true,characters:{initial,entering,complete},errors};
}finally{
  try { if (browser) await bounded('Close browser', () => browser.close(), 10000); }
  finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}
await writeFile(path.join(project,'acceptance.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify({ok:true,project,browser:results.browser,build:results.build},null,2));
