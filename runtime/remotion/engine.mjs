import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, readFile, writeFile, readdir, realpath, lstat, mkdtemp, rm, rename} from 'node:fs/promises';
import {build as esbuild} from 'esbuild';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderMedia, makeCancelSignal} from '@remotion/renderer';
import {chromium} from 'playwright';
import {browserPath} from '../browser.mjs';
export {browserPath};

const runtime = path.dirname(fileURLToPath(import.meta.url));
const resources = path.resolve(runtime, '../..');
const modules = path.join(resources, 'node_modules');
const require = createRequire(import.meta.url);
export const VERSION = require('remotion/package.json').version;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value).replaceAll('<', '\\u003c');
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const exists = async file => lstat(file).then(() => true, e => {if (e.code === 'ENOENT') return false; throw e;});

export async function local(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || /[\x00-\x1f?#:]/.test(relative)
      || path.isAbsolute(relative) || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error(`Unsafe project path: ${relative}`);
  const resolved = await realpath(path.join(root, relative));
  if (!resolved.startsWith(root + path.sep)) throw Error(`Path escapes project: ${relative}`);
  // Snapshots cannot depend on symlinks, even ones currently pointing inside.
  let cursor = root;
  for (const part of relative.split('/')) {
    cursor = path.join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw Error(`Symlink is not a snapshot dependency: ${relative}`);
  }
  return resolved;
}

export async function readConfig(directory) {
  const root = await realpath(directory);
  const config = JSON.parse(await readFile(await local(root, 'remotion.json'), 'utf8'));
  const c = config.composition;
  if (config.schemaVersion !== 1 || config.engine !== 'remotion' || !c || c.id !== 'main'
      || !integer(c.width, 128, 4096) || !integer(c.height, 128, 4096) || c.width % 2 || c.height % 2
      || !integer(c.fps, 1, 120) || !integer(c.durationInFrames, 1, c.fps * 3600)
      || !config.props || typeof config.props !== 'object' || Array.isArray(config.props)
      || !Array.isArray(config.media) || config.media.length > 500) throw Error('Invalid Remotion v1 project configuration');
  await local(root, config.entry);
  const ids = new Set();
  for (const clip of config.media) {
    if (!/^[a-zA-Z0-9_-]+$/.test(clip.id) || ids.has(clip.id) || !['audio', 'video'].includes(clip.type)
        || !integer(clip.from, 0, c.durationInFrames - 1) || !integer(clip.durationInFrames, 1, c.durationInFrames - clip.from)
        || !integer(clip.trimBefore, 0, 120 * 3600) || !Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 1
        || (clip.muted !== undefined && typeof clip.muted !== 'boolean') || !clip.src?.startsWith('assets/')) throw Error(`Invalid media clip: ${clip.id}`);
    if (clip.type === 'audio' && !['narration', 'replacement', 'music', 'sfx', 'original'].includes(clip.role)) throw Error(`Invalid audio role: ${clip.id}`);
    if (clip.style !== undefined && (!clip.style || typeof clip.style !== 'object' || Array.isArray(clip.style))) throw Error(`Invalid media style: ${clip.id}`);
    await local(root, clip.src);
    ids.add(clip.id);
  }
  return {root, config};
}

export async function initProject(directory, {width = 1920, height = 1080, fps = 30, duration = 10} = {}) {
  await mkdir(directory, {recursive:true});
  const root = await realpath(directory);
  if (await exists(path.join(root, 'index.html')) || await exists(path.join(root, 'remotion.json')) || await exists(path.join(root, 'src'))) {
    throw Error('Project already has source; initialization never overwrites an existing engine');
  }
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'assets'), {recursive:true});
  const config = {schemaVersion:1, engine:'remotion', entry:'src/Video.tsx',
    composition:{id:'main', width, height, fps, durationInFrames:Math.round(duration * fps)},
    props:{title:'开始制作'}, media:[]};
  await writeFile(path.join(root, 'remotion.json'), JSON.stringify(config, null, 2) + '\n', {flag:'wx'});
  await writeFile(path.join(root, 'src/Video.tsx'), `import React from 'react';\nimport {AbsoluteFill, interpolate, useCurrentFrame} from 'remotion';\nexport default function Video({title}: {title: string}) {\n  const frame = useCurrentFrame();\n  return <AbsoluteFill style={{justifyContent:'center', alignItems:'center', color:'#202123', fontSize:72, opacity:interpolate(frame,[0,15],[0,1],{extrapolateRight:'clamp'})}}><h1>{title}</h1></AbsoluteFill>;\n}\n`, {flag:'wx'});
  return buildPreview(root);
}

async function sources(root) {
  const files = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, {withFileTypes:true})) {
      if (['node_modules', '.git', '.yingya', '__pycache__', 'renders', 'snapshots'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name), relative = path.relative(root, file).split(path.sep).join('/');
      if (['index.html', 'remotion-build.json', 'assets/remotion-preview.js', 'assets/remotion-preview.css'].includes(relative)) continue;
      if (entry.isSymbolicLink()) throw Error(`Symlink is not a snapshot dependency: ${relative}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && (/^(src|assets|component-library)\//.test(relative) || ['remotion.json', 'package.json', 'package-lock.json'].includes(relative))) files[relative] = hash(await readFile(file));
    }
  }
  await walk(root);
  return Object.fromEntries(Object.entries(files).sort(([a],[b]) => a.localeCompare(b)));
}

function timelineSource(root, config) {
  return `import Video from ${json(path.join(root, config.entry))};\nimport {createTimeline} from ${json(path.join(runtime, 'timeline.tsx'))};\nconst Timeline=createTimeline(Video,${json(config.media)});\n`;
}

async function compilePreview(root, config) {
  const result = await esbuild({stdin:{contents:timelineSource(root, config) + `import {mountPreview} from ${json(path.join(runtime, 'preview.tsx'))};mountPreview(Timeline,${json(config)});`,
    resolveDir:root, loader:'tsx', sourcefile:'yingya-preview.tsx'}, bundle:true, write:false, metafile:true,
    nodePaths:[modules], alias:{react:path.join(modules,'react'), 'react-dom':path.join(modules,'react-dom'), remotion:path.join(modules,'remotion')},
    outfile:path.join(root, 'assets/remotion-preview.js'), platform:'browser', format:'iife', target:'chrome110',
    jsx:'automatic', minify:true, define:{'process.env.NODE_ENV':'"production"'}, logLevel:'silent',
    loader:{'.woff2':'dataurl', '.woff':'dataurl', '.png':'dataurl', '.jpg':'dataurl', '.svg':'dataurl'}});
  const inputs = {};
  for (const file of Object.keys(result.metafile.inputs)) {
    if (path.resolve(file) === path.join(root, 'yingya-preview.tsx')) continue;
    const absolute = path.resolve(file);
    if (absolute.startsWith(root + path.sep)) {
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      await local(root, relative);
      inputs[relative] = hash(await readFile(absolute));
      if (/\.[jt]sx?$/.test(file) && !relative.includes('/node_modules/')) {
        const source = await readFile(absolute, 'utf8');
        if (/<(?:audio|video|Audio|Video|Html5Audio|Html5Video|OffthreadVideo)\b/.test(source)) throw Error(`Declare audio/video in remotion.json media, not inside ${relative}`);
      }
    } else if (!absolute.startsWith(resources + path.sep)) throw Error(`Imported dependency outside project/runtime: ${file}`);
  }
  return {result, inputs};
}

export async function buildPreview(directory) {
  const {root, config} = await readConfig(directory);
  const {result, inputs} = await compilePreview(root, config);
  const files = {};
  for (const output of result.outputFiles) {
    const relative = path.relative(root, output.path);
    if (!['assets/remotion-preview.js', 'assets/remotion-preview.css'].includes(relative)) throw Error(`Unexpected build output: ${relative}`);
    await writeFile(output.path + '.tmp', output.contents);
    await rename(output.path + '.tmp', output.path);
    files[relative] = hash(output.contents);
  }
  const {width, height, durationInFrames, fps} = config.composition;
  const html = `<!doctype html><html lang="zh-CN" data-yingya-engine="remotion"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>映芽视频预览</title><link rel="icon" href="data:,">${files['assets/remotion-preview.css'] ? '<link rel="stylesheet" href="assets/remotion-preview.css">' : ''}<style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:white}</style></head><body><div id="root" data-composition-id="main" data-width="${width}" data-height="${height}" data-duration="${durationInFrames / fps}"></div><script src="assets/remotion-preview.js"></script></body></html>`;
  await writeFile(path.join(root, 'index.html.tmp'), html);
  await rename(path.join(root, 'index.html.tmp'), path.join(root, 'index.html'));
  files['index.html'] = hash(html);
  const receipt = {schemaVersion:1, engine:'remotion', version:VERSION, sources:await sources(root), inputs, files};
  await writeFile(path.join(root, 'remotion-build.json.tmp'), JSON.stringify(receipt, null, 2) + '\n');
  await rename(path.join(root, 'remotion-build.json.tmp'), path.join(root, 'remotion-build.json'));
  return {ok:true, engine:'remotion', version:VERSION, entry:'index.html'};
}

export async function validateBuild(directory) {
  const {root, config} = await readConfig(directory);
  const receipt = JSON.parse(await readFile(await local(root, 'remotion-build.json'), 'utf8'));
  if (receipt.schemaVersion !== 1 || receipt.version !== VERSION || receipt.engine !== 'remotion'
      || JSON.stringify(receipt.sources) !== JSON.stringify(await sources(root))) throw Error('Remotion preview is stale; run build before check/render');
  for (const [relative, expected] of Object.entries({...receipt.inputs, ...receipt.files})) {
    if (hash(await readFile(await local(root, relative))) !== expected) throw Error(`Build dependency changed: ${relative}; run build`);
  }
  // Compile from source independently, so an edited receipt cannot bless a broken
  // TSX entry. Runtime checks exercise this fresh bundle as well as the saved one.
  const {result} = await compilePreview(root, config);
  for (const output of result.outputFiles) {
    if (receipt.files[path.relative(root, output.path)] !== hash(output.contents)) throw Error('Preview does not match the current source/runtime; run build');
  }
  return {root, config, receipt};
}



export async function serveProject(root) {
  const server = createServer(async (req, res) => {
    try {
      const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html';
      const file = await local(root, relative);
      const mime = {'.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.woff2':'font/woff2', '.png':'image/png', '.svg':'image/svg+xml', '.mp4':'video/mp4', '.wav':'audio/wav', '.mp3':'audio/mpeg'}[path.extname(file)] || 'application/octet-stream';
      const size = (await lstat(file)).size;
      res.setHeader('Content-Type', mime); res.setHeader('Access-Control-Allow-Origin','*');
      res.setHeader('Accept-Ranges','bytes');
      let start = 0, end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) {res.writeHead(416);res.end();return;}
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
        if (start > end || start >= size) {res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      }
      res.setHeader('Content-Length', Math.max(0,end-start+1));
      if (req.method === 'HEAD' || size === 0) {res.end();return;}
      const stream = createReadStream(file,{start,end});
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {url:`http://127.0.0.1:${server.address().port}`, close:() => new Promise(resolve => server.close(resolve))};
}

async function mediaChecks(root, config) {
  const checks = [];
  for (const clip of config.media) {
    const file = await local(root, clip.src);
    const probe = JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file], {encoding:'utf8',timeout:30000}));
    const stream = probe.streams.find(s => s.codec_type === clip.type);
    const duration = Number(stream?.duration || probe.format?.duration);
    if (!stream || !Number.isFinite(duration) || (clip.trimBefore + clip.durationInFrames) / config.composition.fps > duration + 1 / config.composition.fps) throw Error(`Media missing/too short for clip ${clip.id}`);
    checks.push({id:clip.id, path:clip.src, sha256:hash(await readFile(file)), duration});
  }
  return checks;
}

export async function checkProject(directory) {
  const {root, config} = await validateBuild(directory);
  const media = await mediaChecks(root, config);
  const server = await serveProject(root);
  let browser;
  try {
    browser = await chromium.launch({executablePath:browserPath(), headless:true, args:['--no-sandbox','--disable-dev-shm-usage']});
    const page = await browser.newPage({viewport:{width:config.composition.width,height:config.composition.height}});
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {if(m.type() === 'error') errors.push(m.text());});
    page.on('response', r => {if(r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);});
    page.on('requestfailed', r => errors.push(r.failure()?.errorText || r.url()));
    await page.goto(server.url, {waitUntil:'networkidle'});
    await page.waitForFunction(() => !!window.__yingyaRemotionPlayer, null, {timeout:15000});
    const {durationInFrames, fps} = config.composition;
    const samples = [...new Set([0, Math.floor(durationInFrames / 2), durationInFrames - 1, ...config.media.flatMap(m => [m.from, m.from + m.durationInFrames - 1])])];
    const frames = [];
    for (const frame of samples) {
      await page.evaluate(frame => window.__yingyaRemotionPlayer.seekTo(frame), frame);
      await page.waitForFunction(frame => window.__yingyaRemotionPlayer.getCurrentFrame() === frame, frame);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const unexpected = await page.locator('video,audio').evaluateAll((nodes, sources) => nodes.map(n => n.getAttribute('src')).filter(src => src && src !== sources.silent && !sources.paths.some(s => decodeURI(new URL(src, location.href).pathname).endsWith('/' + s))), {paths:config.media.map(m => m.src), silent:(await readFile(path.join(modules,'remotion/dist/cjs/audio/shared-audio-tags.js'),'utf8')).match(/const EMPTY_AUDIO = ['"]([^'"]+)['"]/)?.[1]});
      if (unexpected.length) errors.push(`Undeclared media: ${unexpected.join(', ')}`);
      frames.push({frame, seconds:frame / fps, sha256:hash(await page.screenshot())});
    }
    const playbackError = await page.evaluate(() => window.__yingyaRemotionError);
    if (playbackError) errors.push(playbackError);
    if (errors.length) throw Error(errors.join('\n'));
    return {ok:true, engine:'remotion', version:VERSION, scope:'build-runtime-media', media, frames,
      requiresVisualReview:true, pendingChecks:['layout','contrast','authored-motion-assertions'],
      note:'Build/runtime/media check; layout, contrast and visual quality require separate review.'};
  } finally {await browser?.close(); await server.close();}
}

export async function renderProject(directory, output, {fps, width, height, quality = 'high'} = {}) {
  const {root, config} = await validateBuild(directory);
  const media = await mediaChecks(root, config);
  const c = config.composition;
  if (fps !== undefined && fps !== c.fps) throw Error('Export FPS must equal composition FPS; update the source and rebuild to change FPS');
  width ??= c.width; height ??= c.height;
  if (!integer(width,128,8192) || !integer(height,128,8192) || width * c.height !== height * c.width) throw Error('Export must preserve composition aspect ratio');
  const temporary = await mkdtemp(path.join(tmpdir(), 'yingya-remotion-'));
  const {cancel, cancelSignal} = makeCancelSignal();
  process.on('SIGTERM', cancel); process.on('SIGINT', cancel);
  try {
    const entry = path.join(temporary, 'entry.tsx');
    await writeFile(entry, `import React from 'react';import {registerRoot,Composition} from 'remotion';\n${timelineSource(root, config)}\nregisterRoot(()=> <Composition component={Timeline} {...${json(c)}} defaultProps={${json(config.props)}}/>);`);
    const serveUrl = await bundle({entryPoint:entry, outDir:path.join(temporary,'bundle'), publicDir:path.join(root,'assets'), enableCaching:false,
      webpackOverride: config => ({...config, resolve:{...config.resolve, modules:[modules,'node_modules'], alias:{...config.resolve?.alias, react:path.join(modules,'react'), 'react-dom':path.join(modules,'react-dom'), remotion:path.join(modules,'remotion')}}})});
    const native = path.join(runtime,'native/bin');
    const common = {serveUrl, browserExecutable:browserPath(), chromiumOptions:{gl:'swangle'}, logLevel:'error',
      binariesDirectory:await exists(path.join(native,'remotion')) ? native : undefined};
    const composition = await selectComposition({...common, id:c.id, inputProps:config.props});
    let renderedFrames = 0, lastProgress = -1;
    await renderMedia({...common, composition, inputProps:config.props, codec:'h264', outputLocation:output, overwrite:false,
      scale:width / c.width, crf:quality === 'draft' ? 28 : quality === 'standard' ? 23 : 18,
      concurrency:2, offthreadVideoThreads:2, cancelSignal, onProgress:p => {renderedFrames = p.renderedFrames; const percent = Math.floor(p.progress * 10) * 10; if (percent !== lastProgress) {lastProgress = percent; process.stderr.write(`Remotion ${percent}%\n`);}}});
    const receipt = {schemaVersion:1, engine:'remotion', version:VERSION, composition:c, renderedFrames,
      media, outputSha256:hash(await readFile(output)), inputsSha256:hash(JSON.stringify(await sources(root))),
      verification:'renderer-completion-and-media-probe', requiresVisualReview:true};
    if (renderedFrames !== c.durationInFrames) throw Error('Renderer did not complete every composition frame');
    return receipt;
  } finally {
    process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel);
    await rm(temporary, {recursive:true, force:true});
  }
}
