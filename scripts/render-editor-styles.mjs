import { chromium } from 'playwright';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { emptyDocument } from '../runtime/editor/model.mjs';
import { compileHTML } from '../runtime/editor/compile.mjs';
import { styles, templateScene } from '../runtime/editor/catalog.mjs';
const root=await mkdtemp(path.join(os.tmpdir(),'yingya-style-previews-'));
const output=path.resolve('web/public/editor-styles');await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1});
 let css='';for(const [name,file] of [['@fontsource-variable/noto-sans-sc','index.css'],['@fontsource-variable/noto-serif-sc','index.css'],['@fontsource/fragment-mono','400.css']])css+=(await readFile(`node_modules/${name}/${file}`,'utf8')).replaceAll('url(./files/',`url(${pathToFileURL(path.resolve(`node_modules/${name}/files/`)).href}/`);
 for(const style of styles){const doc=emptyDocument();doc.scenes.push(templateScene(style.id,'preview',doc));const file=path.join(root,'index.html');await writeFile(file,compileHTML(doc,{gsapUrl:pathToFileURL(path.resolve('runtime/editorial/vendor/gsap-3.14.2.min.js')).href,fontCss:css}));await page.goto(pathToFileURL(file).href);await page.evaluate(async()=>{await document.fonts.ready;window.__timelines.main.seek(2);});await page.screenshot({path:path.join(output,style.id+'.png')});}
 console.log(`Rendered ${styles.length} previews from editable templates.`);
}finally{await browser.close();await rm(root,{recursive:true,force:true});}
