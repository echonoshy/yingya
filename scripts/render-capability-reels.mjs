import {bundle} from '@remotion/bundler';
import {openBrowser,selectComposition,renderMedia,renderStill} from '@remotion/renderer';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {browserPath} from '../runtime/browser.mjs';

const root=resolve('design-assets/capability-reels');
const out=resolve('web/src/assets/capability-reels');
const proof='/tmp/yingya-texture-reels';
await mkdir(out,{recursive:true});await mkdir(proof,{recursive:true});
const serveUrl=await bundle({entryPoint:root+'/src/index.tsx',publicDir:root+'/public',outDir:root+'/build'});
const browser=await openBrowser('chrome',{browserExecutable:browserPath()});
const films=[['Effects',65],['Voice',112],['Charts',112],['Edit',122]];
const manifest=[];
try {
 for(const [id,poster] of films){
  if(process.env.YINGYA_EXAMPLE_ONLY && process.env.YINGYA_EXAMPLE_ONLY!==id)continue;
  const composition=await selectComposition({serveUrl,id,puppeteerInstance:browser});
  for(const frame of [15,45,75,poster,composition.durationInFrames-12]) {
   await renderStill({serveUrl,composition,frame,output:`${proof}/${id}-${frame}.png`,puppeteerInstance:browser,imageFormat:'png'});
  }
  await renderStill({serveUrl,composition,frame:poster,output:`${out}/${id.toLowerCase()}.jpg`,puppeteerInstance:browser,imageFormat:'jpeg',jpegQuality:90});
  console.log(id,'stills ready');
  if(process.argv.includes('--stills'))continue;
  const outputLocation=`${out}/${id.toLowerCase()}.mp4`;
  let previous=-1;
  await renderMedia({serveUrl,composition,codec:'h264',outputLocation,puppeteerInstance:browser,crf:19,pixelFormat:'yuv420p',imageFormat:'png',colorSpace:'bt709',concurrency:4,onProgress:({progress})=>{const step=Math.floor(progress*4);if(step!==previous){previous=step;console.log(id,`${step*25}%`)}}});
  manifest.push({id,duration:composition.durationInFrames/composition.fps,bytes:(await stat(outputLocation)).size});
 }
 if(manifest.length===films.length)await writeFile(root+'/renders.json',JSON.stringify(manifest,null,2)+'\n');
} finally {await browser.close({silent:true});}
