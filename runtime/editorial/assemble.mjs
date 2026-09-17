#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cameraSegments } from './camera.mjs';
import { readFileSync } from 'node:fs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const MARKER = 'yingya-editorial:v1';
export const recipeCatalog = JSON.parse(readFileSync(path.join(here, 'catalog.json'), 'utf8'));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const scriptJson = value => JSON.stringify(value).replace(/</g, '\\u003c');
const posix = value => value.split(path.sep).join('/');

export async function fileSha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function assert(condition, message) { if (!condition) throw new Error(message); }
function within(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// Resolve each existing ancestor, including symlinks, before any write.
export async function projectPath(root, relative, { mustExist = true } = {}) {
  assert(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative) && !relative.includes('\0') && !relative.includes('\\') && !relative.split('/').includes('..'), `Project path must be relative without traversal: ${relative}`);
  const target = path.resolve(root, relative);
  assert(within(root, target), `Path leaves project: ${relative}`);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      assert(!stat.isSymbolicLink(), `Symlinks are not accepted for editorial inputs/outputs: ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT' || mustExist) throw error;
    }
  }
  return target;
}

function finite(value, label, min, max) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${label} must be a number in [${min}, ${max}]`);
  return value;
}

function normalizeFocus(input, label) {
  assert(input && typeof input === 'object' && !Array.isArray(input), `${label} requires a normalized rect or anchor/zoom`);
  assert(Boolean(input.rect) !== Boolean(input.anchor), `${label} must contain exactly one of rect or anchor`);
  if (input.rect) {
    const r = input.rect;
    const rect = { x: finite(r.x, `${label}.rect.x`, 0, 1), y: finite(r.y, `${label}.rect.y`, 0, 1), width: finite(r.width, `${label}.rect.width`, 0.001, 1), height: finite(r.height, `${label}.rect.height`, 0.001, 1) };
    assert(rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001, `${label}.rect must stay inside source`);
    return { rect };
  }
  return { anchor: { x: finite(input.anchor.x, `${label}.anchor.x`, 0, 1), y: finite(input.anchor.y, `${label}.anchor.y`, 0, 1) }, zoom: finite(input.zoom, `${label}.zoom`, 1, 3) };
}

export function normalizeRequirements(input) {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'requirements must be an object');
  const result = { ...input, durationMode: input.durationMode ?? 'target', audioMode: input.audioMode ?? 'auto', subtitles: input.subtitles ?? 'auto', music: input.music ?? 'auto' };
  assert(['target', 'exact', 'max'].includes(result.durationMode), 'requirements.durationMode is invalid');
  assert(['auto', 'preserve', 'narration', 'replace', 'mute'].includes(result.audioMode), 'requirements.audioMode is invalid');
  assert(['auto', 'zh', 'zh-en', 'none'].includes(result.subtitles), 'requirements.subtitles is invalid');
  assert(['auto', 'on', 'off'].includes(result.music), 'requirements.music is invalid');
  if (input.targetDurationSeconds !== undefined) finite(input.targetDurationSeconds, 'requirements.targetDurationSeconds', 1, 3600);
  assert(result.durationMode === 'target' || input.targetDurationSeconds !== undefined, 'Exact/max duration requires targetDurationSeconds');
  assert(result.audioMode !== 'mute' || result.music !== 'on', 'Muted delivery conflicts with requested music; clarify the audio requirement first');
  return result;
}

function effectOverlay(scene) {
  if (!['screen-highlight', 'screen-callout'].includes(scene.recipe)) return '';
  const common = `id="${scene.id}-overlay" data-editorial-overlay="${scene.recipe}" viewBox="0 0 1000 1000" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0" aria-hidden="true"`;
  if (scene.recipe === 'screen-highlight') {
    const r = scene.focus.rect, x = r.x * 1000, y = r.y * 1000, w = r.width * 1000, h = r.height * 1000;
    return `<svg ${common}><path fill="#121820" fill-opacity=".56" fill-rule="evenodd" d="M0 0H1000V1000H0Z M${x} ${y}V${y+h}H${x+w}V${y}Z"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#1472e6" stroke-width="3" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const rect = scene.focus.rect;
  const anchor = rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : scene.focus.anchor;
  const x = anchor.x * 1000, y = anchor.y * 1000;
  const fromX = x < 500 ? 970 : 30;
  const fromY = Math.min(960, Math.max(40, y + (y < 500 ? 190 : -190)));
  return `<svg ${common}><path d="M${fromX} ${fromY}H${(fromX+x)/2}L${x} ${y}" fill="none" stroke="white" stroke-width="6" vector-effect="non-scaling-stroke"/><path d="M${fromX} ${fromY}H${(fromX+x)/2}L${x} ${y}" fill="none" stroke="#1472e6" stroke-width="2.5" vector-effect="non-scaling-stroke"/><circle cx="${x}" cy="${y}" r="10" fill="none" stroke="white" stroke-width="6" vector-effect="non-scaling-stroke"/><circle cx="${x}" cy="${y}" r="10" fill="none" stroke="#1472e6" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
}

export function validateScenes(input, requirements = {}) {
  assert(Array.isArray(input) && input.length > 0 && input.length <= 100, 'scenes.json must be a non-empty root array (at most 100 scenes)');
  const ids = new Set();
  let start = 0;
  return input.map((scene, index) => {
    assert(scene && typeof scene === 'object', `Scene ${index} is invalid`);
    assert(typeof scene.id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(scene.id) && !ids.has(scene.id), `Scene ${index} needs a unique stable CSS-safe id`);
    ids.add(scene.id);
    if (scene.order !== undefined) {
      finite(scene.order, `${scene.id}.order`, 0, 10000);
      assert(index === 0 || scene.order > (input[index - 1].order ?? -1), 'scenes order must match the root array; do not silently reorder clips');
    }
    const clip = scene.sourceClip;
    assert(clip && typeof clip === 'object', `${scene.id}.sourceClip is required`);
    assert(typeof clip.source === 'string' && clip.source.length > 0, `${scene.id}.sourceClip.source is required`);
    const sourceIn = finite(clip.sourceIn, `${scene.id}.sourceIn`, 0, 86400);
    const sourceOut = finite(clip.sourceOut, `${scene.id}.sourceOut`, 0, 86400);
    assert(sourceOut > sourceIn, `${scene.id}: sourceOut must be greater than sourceIn`);
    const durationSeconds = sourceOut - sourceIn;
    assert(durationSeconds >= 0.1, `${scene.id}: source interval must be at least 0.1 second`);
    if (scene.durationSeconds !== undefined) assert(Math.abs(finite(scene.durationSeconds, `${scene.id}.durationSeconds`, 0.1, 86400) - durationSeconds) < 0.000001, `${scene.id}: durationSeconds must equal sourceOut-sourceIn; only 1x playback is supported`);
    if (scene.startSeconds !== undefined) assert(Math.abs(finite(scene.startSeconds, `${scene.id}.startSeconds`, 0, 86400) - start) < 0.000001, `${scene.id}: startSeconds must be ${start}; gaps and overlaps are not supported`);
    const recipe = scene.recipe ?? 'screen-focus';
    const treatment = recipeCatalog.recipes.find(item => item.id === recipe);
    assert(treatment, `${scene.id}: unknown recipe ${recipe}`);
    const audioMode = requirements.audioMode === 'replace' ? 'mute' : ['mute', 'preserve'].includes(requirements.audioMode) ? requirements.audioMode : clip.audioMode ?? 'preserve';
    assert(['preserve', 'mute'].includes(audioMode), `${scene.id}: audioMode must be preserve or mute`);
    const title = Array.isArray(scene.onScreenText) ? scene.onScreenText.join(' · ') : scene.onScreenText;
    assert(typeof title === 'string' && title.trim().length > 0 && title.length <= 100 && !/[\r\n]/.test(title), `${scene.id}: onScreenText must contain one title of at most 100 characters`);
    const focus = treatment.requiresFocus ? normalizeFocus(clip.focus, `${scene.id}.focus`) : null;
    if (focus) assert(treatment.focusShapes.includes(focus.rect ? 'rect' : 'anchor'), `${scene.id}: ${recipe} requires an explicitly identified focus rectangle`);
    const authored = clip.overview ?? {};
    const minimumOverviewHold = ['screen-focus', 'screen-result'].includes(recipe) ? 0.1 : 0;
    const overview = {
      introSeconds: finite(authored.introSeconds ?? Math.min(1, durationSeconds / 5), `${scene.id}.overview.introSeconds`, minimumOverviewHold, durationSeconds),
      outroSeconds: finite(authored.outroSeconds ?? Math.min(1.5, durationSeconds / 4), `${scene.id}.overview.outroSeconds`, minimumOverviewHold, durationSeconds),
      ...(authored.resultFocus ? { resultFocus: normalizeFocus(authored.resultFocus, `${scene.id}.overview.resultFocus`) } : {}),
    };
    if (['screen-focus', 'screen-result'].includes(recipe)) assert(overview.introSeconds + overview.outroSeconds + 0.2 < durationSeconds, `${scene.id}: leave time between intro and outro for camera movement`);
    const result = { id: scene.id, recipe, startSeconds: start, durationSeconds, title: title.trim(), originalPath: clip.source, sourceIn, sourceOut, audioMode, focus, overview, videoId: `${scene.id}-video` };
    start += durationSeconds;
    return result;
  });
}

async function probeMedia(file) {
  const format = { '.mp4': 'mov', '.mov': 'mov', '.m4v': 'mov', '.mkv': 'matroska', '.webm': 'matroska', '.avi': 'avi' }[path.extname(file).toLowerCase()];
  assert(format, `Unsupported source container; normalize to MP4, MOV, MKV, WebM or AVI before assembly: ${file}`);
  const inputOptions = ['-protocol_whitelist', 'file,pipe', '-f', format];
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'error', ...inputOptions, '-show_format', '-show_streams', '-of', 'json', file], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const value = JSON.parse(stdout);
  const video = value.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  assert(video && video.width > 0 && video.height > 0, `Source must contain real video: ${file}`);
  const sar = video.sample_aspect_ratio;
  assert(!sar || sar === '1:1' || sar === 'N/A', `Source has non-square pixels (${sar}); normalize display geometry before editorial assembly: ${file}`);
  const rotations = [video.tags?.rotate, ...(video.side_data_list ?? []).map(item => item.rotation)].filter(value => value !== undefined);
  assert(rotations.every(value => Number.isFinite(Number(value)) && Number(value) % 360 === 0), `Source has display rotation; normalize orientation before editorial assembly: ${file}`);
  const startTime = Number(video.start_time ?? 0);
  assert(Number.isFinite(startTime) && Math.abs(startTime) < 0.001, `Source has non-zero video start_time; normalize timestamps before editorial assembly: ${file}`);
  let durationSeconds = Number(video.duration);
  let durationBasis = 'video-stream';
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    // WebM/MKV commonly omit stream.duration. Never borrow container duration:
    // its audio may continue well after the final video frame.
    const { stdout: packetText } = await execFileAsync('ffprobe', ['-v', 'error', ...inputOptions, '-select_streams', String(video.index), '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', file], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    let end = -Infinity, first = Infinity, last = -Infinity, lastDuration = 0;
    for (const line of packetText.trim().split('\n')) {
      const [pts, length] = line.split(',').map(Number);
      if (!Number.isFinite(pts)) continue;
      first = Math.min(first, pts);
      if (pts >= last) { last = pts; lastDuration = length; }
      if (Number.isFinite(length) && length > 0) end = Math.max(end, pts + length);
    }
    assert(Number.isFinite(lastDuration) && lastDuration > 0, `Cannot determine final video packet duration safely: ${file}`);
    const start = Number(video.start_time);
    durationSeconds = end - (Number.isFinite(start) ? start : first);
    durationBasis = 'video-packet-end-minus-stream-start';
  }
  assert(Number.isFinite(durationSeconds) && durationSeconds > 0, `Cannot determine source video duration: ${file}`);
  return { durationSeconds, durationBasis, width: video.width, height: video.height, hasAudio: value.streams.some(stream => stream.codec_type === 'audio') };
}

async function readOptional(file) {
  try { return await fs.readFile(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function hashOptional(file) {
  try { assert((await fs.stat(file)).isFile(), `Expected a regular file: ${file}`); return await fileSha256(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function makeHtml(scenes, canvas, fontCss, requirements) {
  const { width, height, fps } = canvas;
  const duration = scenes.at(-1).startSeconds + scenes.at(-1).durationSeconds;
  const showCaptions = requirements.subtitles !== 'none';
  const captionHeight = showCaptions ? Math.round(height * 0.125) : 0;
  const stageHeight = height - captionHeight;
  const sections = scenes.map((scene, index) => {
    const ratio = Math.min(width / scene.source.width, stageHeight / scene.source.height);
    const w = scene.source.width * ratio, h = scene.source.height * ratio;
    const titleUnits = Array.from(scene.title).reduce((sum, char) => sum + (char.codePointAt(0) > 255 ? 1 : 0.7), 0);
    const titleSize = Math.min(Math.round(height * .041), Math.floor(width * .84 / Math.max(1, titleUnits)));
    if (showCaptions) assert(titleSize >= Math.max(14, Math.round(height * .018)), `${scene.id}: title is too long for the approved canvas; shorten onScreenText (it will not be truncated)`);
    const overlay = effectOverlay(scene);
    const caption = showCaptions ? `<div class="editorial-caption"><span class="editorial-number">${String(index + 1).padStart(2, '0')}</span><span id="${scene.id}-title" class="editorial-title" style="font-size:${titleSize}px">${escapeHtml(scene.title)}</span></div>` : '';
    return `<section id="${scene.id}" class="editorial-scene" data-editorial-scene="${scene.id}" data-recipe="${scene.recipe}" style="visibility:${index ? 'hidden' : 'visible'}"><div class="ufz-frame" style="left:${(width-w)/2}px;top:${(stageHeight-h)/2}px;width:${w}px;height:${h}px"><div id="${scene.id}-world" class="ufz-world" data-layout-allow-overflow><video id="${scene.videoId}" class="clip" src="${scene.mediaSrc}" data-start="${scene.startSeconds}" data-duration="${scene.durationSeconds}" data-media-start="${scene.sourceIn}" data-track-index="0" muted playsinline preload="auto"></video></div>${overlay}</div>${caption}</section>${scene.audioMode === 'preserve' && scene.source.hasAudio ? `<audio id="${scene.id}-audio" class="clip" src="${scene.mediaSrc}" data-start="${scene.startSeconds}" data-duration="${scene.durationSeconds}" data-media-start="${scene.sourceIn}" data-track-index="1" preload="auto"></audio>` : ''}`;
  }).join('\n');
  // Pure rendering at the timeline's absolute time avoids stateful GSAP object
  // callbacks and stale child transform caches. No wall clock or autoplay.
  const config = scenes.map(scene => ({ id: scene.id, start: scene.startSeconds, duration: scene.durationSeconds, intro: scene.overview.introSeconds, outro: scene.overview.outroSeconds, points: cameraSegments(scene) }));
  return `<!doctype html>\n<!-- ${MARKER}; camera adapted from HeyGen ui-focus-zoom; see assets/editorial/PROVENANCE.json -->
<html lang="zh-CN"><head><meta charset="utf-8"><script src="assets/editorial/gsap.min.js"></script><style>
${fontCss}
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#f1f3f5;color:#14171a;font-family:'Editorial Noto',sans-serif}#main{position:relative;width:${width}px;height:${height}px;overflow:hidden}.editorial-scene{position:absolute;inset:0}.ufz-frame{position:absolute;overflow:hidden;background:#fff}.ufz-world{position:absolute;inset:0;transform-origin:50% 50%;will-change:transform}.ufz-world video{display:block;width:100%;height:100%;object-fit:contain}.editorial-caption{position:absolute;left:0;bottom:0;width:100%;height:${captionHeight}px;padding:0 ${Math.round(width*.033)}px;display:flex;gap:${Math.round(width*.018)}px;align-items:center;background:#fff;border-top:1px solid #d9dde2}.editorial-number{font-size:${Math.round(height*.027)}px;color:#5f6874}.editorial-title{font-size:${Math.round(height*.041)}px;line-height:1.35;font-weight:550;white-space:nowrap}
</style></head><body><div id="main" data-composition-id="main" data-duration="${duration}" data-width="${width}" data-height="${height}" data-fps="${fps}">${sections}</div><script>
const editorialScenes=${scriptJson(config)};
function renderEditorialAt(time){
 for(const scene of editorialScenes){
  const local=Math.max(0,Math.min(scene.duration,time-scene.start));
  const active=time>=scene.start && time<scene.start+scene.duration;
  document.getElementById(scene.id).style.visibility=active?'visible':'hidden';
  let camera=scene.points[scene.points.length-1].camera;
  for(let i=1;i<scene.points.length;i++){
   const a=scene.points[i-1],b=scene.points[i];if(local>b.at)continue;
   const p=b.at===a.at?1:(local-a.at)/(b.at-a.at);
   const e=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
   camera={x:a.camera.x+(b.camera.x-a.camera.x)*e,y:a.camera.y+(b.camera.y-a.camera.y)*e,scale:a.camera.scale+(b.camera.scale-a.camera.scale)*e};break;
  }
  document.getElementById(scene.id+'-world').style.transform='translate('+camera.x.toFixed(7)+'%, '+camera.y.toFixed(7)+'%) scale('+camera.scale.toFixed(7)+')';
  const overlay=document.getElementById(scene.id+'-overlay');
  if(overlay){const fade=Math.min(.35,scene.duration/5);const enter=Math.min(1,Math.max(0,(local-scene.intro)/fade));const exit=Math.min(1,Math.max(0,(scene.duration-scene.outro+fade-local)/fade));overlay.style.opacity=(enter*exit).toFixed(7);}
 }
}
const clock={time:0};const tl=gsap.timeline({paused:true});
tl.to(clock,{time:${duration},duration:${duration},ease:'none',onUpdate:()=>renderEditorialAt(clock.time)},0);
renderEditorialAt(0);window.__timelines=window.__timelines||{};window.__timelines.main=tl;
</script></body></html>\n`;
}

async function fontsForTitles(text) {
  const fontRoot = path.resolve(here, '../../node_modules/@fontsource-variable/noto-sans-sc');
  const css = await fs.readFile(path.join(fontRoot, 'index.css'), 'utf8');
  const chars = [...new Set(Array.from(text + '0123456789 ·').map(char => char.codePointAt(0)))];
  const files = new Map();
  const rules = [];
  for (const match of css.matchAll(/@font-face\s*\{[^}]+\}/g)) {
    const rule = match[0], ranges = rule.match(/unicode-range:\s*([^;]+)/)?.[1];
    if (!ranges || !ranges.split(',').some(range => { const [lo, hi] = range.trim().replace(/^U\+/i, '').split('-').map(n => parseInt(n, 16)); return chars.some(c => c >= lo && c <= (hi ?? lo)); })) continue;
    const filename = rule.match(/url\(\.\/files\/([^)]*)\)/)?.[1];
    if (!filename) continue;
    files.set(`assets/editorial/fonts/${filename}`, await fs.readFile(path.join(fontRoot, 'files', filename)));
    rules.push(rule.replace("'Noto Sans SC Variable'", "'Editorial Noto'").replace(`./files/${filename}`, `assets/editorial/fonts/${filename}`).replace('font-display: swap', 'font-display: block'));
  }
  assert(rules.length > 0, 'Local Noto Sans SC font package is required');
  files.set('assets/editorial/fonts/LICENSE', await fs.readFile(path.join(fontRoot, 'LICENSE')));
  return { css: rules.join('\n'), files };
}

export async function assembleEditorial({ project, scenes: scenesName = 'scenes.json', out = '.', width, height, fps, replace = false, inputBytes }) {
  assert(project, '--project is required');
  const root = await fs.realpath(project);
  const scenesPath = await projectPath(root, scenesName);
  const outPath = await projectPath(root, out, { mustExist: false });
  const input = inputBytes ?? await fs.readFile(scenesPath);
  const manifestPath = await projectPath(root, '.yingya/manifest.json', { mustExist: false });
  const manifest = await readOptional(manifestPath);
  const spec = manifest ? JSON.parse(manifest).outputSpec ?? {} : {};
  const requirementsPath = await projectPath(root, '.yingya/requirements.json', { mustExist: false });
  const requirementsBytes = await readOptional(requirementsPath);
  const requirements = normalizeRequirements(requirementsBytes ? JSON.parse(requirementsBytes) : spec.requirements ?? {});
  const scenes = validateScenes(JSON.parse(input), requirements);
  assert((width === undefined) === (height === undefined), 'Provide both --width and --height, or neither');
  assert((spec.width === undefined) === (spec.height === undefined) || width !== undefined, 'outputSpec must provide both width and height, or use explicit CLI dimensions');
  const ratioSize = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [1080, 1080], '4:3': [960, 720], '3:4': [720, 960] }[spec.aspectRatio ?? '16:9'];
  assert(width !== undefined || spec.width !== undefined || ratioSize, 'Unknown outputSpec.aspectRatio; provide the approved --width and --height');
  const canvas = { width: Number(width ?? spec.width ?? ratioSize?.[0]), height: Number(height ?? spec.height ?? ratioSize?.[1]), fps: Number(fps ?? spec.fps ?? 30) };
  for (const key of ['width', 'height']) assert(Number.isInteger(canvas[key]) && canvas[key] >= 240 && canvas[key] <= 4096 && canvas[key] % 2 === 0, `${key} must be an even integer from 240 to 4096`);
  assert([24, 25, 30, 50, 60].includes(canvas.fps), 'fps must be 24, 25, 30, 50 or 60');
  const durationSeconds = scenes.at(-1).startSeconds + scenes.at(-1).durationSeconds;
  assert(durationSeconds <= 3600, 'Editorial composition must not exceed 3600 seconds');
  if (requirements.targetDurationSeconds && requirements.durationMode === 'exact') assert(Math.abs(durationSeconds - requirements.targetDurationSeconds) <= 1 / canvas.fps, 'Source intervals do not meet the exact requested duration; revise the plan without silently retiming media');
  if (requirements.targetDurationSeconds && requirements.durationMode === 'max') assert(durationSeconds <= requirements.targetDurationSeconds + 1 / canvas.fps, 'Source intervals exceed the maximum requested duration');
  const warnings = [], media = new Map(), copies = new Map();
  if (requirements.audioMode === 'narration' || requirements.audioMode === 'replace') warnings.push('Requested narration/replacement audio is not produced by screen assembly; complete the approved audio treatment before delivery');
  if (requirements.music === 'on') warnings.push('Requested music is not produced by screen assembly; add the approved music before delivery');
  for (const scene of scenes) {
    const sourcePath = await projectPath(root, scene.originalPath);
    assert((await fs.stat(sourcePath)).isFile(), `${scene.id}: source must be a regular file`);
    if (!media.has(sourcePath)) media.set(sourcePath, { ...await probeMedia(sourcePath), sha256: await fileSha256(sourcePath) });
    const source = media.get(sourcePath);
    assert(scene.sourceOut <= source.durationSeconds + 0.001, `${scene.id}: sourceOut ${scene.sourceOut} exceeds media duration ${source.durationSeconds}`);
    const extension = path.extname(sourcePath).toLowerCase();
    assert(/^\.[a-z0-9]{1,8}$/.test(extension), `${scene.id}: unsupported media filename extension`);
    const bundled = `assets/editorial/source-${source.sha256.slice(0, 20)}${extension}`;
    scene.mediaSrc = bundled;
    scene.source = { path: bundled, originalPath: scene.originalPath, ...source };
    if (scene.audioMode === 'preserve' && source.hasAudio) scene.audioId = `${scene.id}-audio`;
    delete scene.originalPath;
    copies.set(bundled, { file: sourcePath, sha256: source.sha256 });
    if (scene.audioMode === 'preserve' && !source.hasAudio) warnings.push(`${scene.id}: source has no audio stream; preserve produces no audio for this clip`);
  }
  const files = new Map();
  const fonts = await fontsForTitles(scenes.map(scene => scene.title).join(''));
  for (const [name, bytes] of fonts.files) files.set(name, bytes);
  for (const name of ['HYPERFRAMES-LICENSE', 'GSAP-LICENSE', 'PROVENANCE.json', 'ui-focus-zoom.original.html']) files.set(`assets/editorial/${name}`, await fs.readFile(path.join(here, 'vendor', name)));
  files.set('assets/editorial/gsap.min.js', await fs.readFile(path.join(here, 'vendor/gsap-3.14.2.min.js')));
  files.set('assets/editorial/scenes.snapshot.json', input);
  files.set('assets/editorial/requirements.snapshot.json', Buffer.from(json(requirements)));
  files.set('index.html', Buffer.from(makeHtml(scenes, canvas, fonts.css, requirements)));
  files.set('index.motion.json', Buffer.from(json({ duration: durationSeconds, assertions: scenes.flatMap(scene => [{ kind: 'appearsBy', selector: requirements.subtitles === 'none' ? `#${scene.id}` : `#${scene.id}-title`, bySec: scene.startSeconds + Math.min(0.5, scene.durationSeconds / 2) }, ...(requirements.subtitles === 'none' ? [] : [{ kind: 'staysInFrame', selector: `#${scene.id}-title` }])]) })));
  const generatedFiles = Object.fromEntries([...files].map(([name, bytes]) => [name, digest(bytes)]));
  for (const [name, value] of copies) generatedFiles[name] = value.sha256;
  const previousBytes = await readOptional(await projectPath(root, posix(path.relative(root, path.join(outPath, 'source-bindings.json'))), { mustExist: false }));
  let previous;
  try { previous = previousBytes && JSON.parse(previousBytes); } catch { /* requires --replace below */ }
  if (previousBytes && !replace) assert(previous?.generator === MARKER && previous?.generatedFiles?.['index.html'], 'Existing source-bindings.json is not a verified editorial output; use a different --out or explicit --replace');
  const oldEntry = await readOptional(await projectPath(root, posix(path.relative(root, path.join(outPath, 'index.html'))), { mustExist: false }));
  if (!replace && oldEntry) assert(oldEntry.includes(MARKER) && previous?.generator === MARKER && previous?.generatedFiles?.['index.html'], 'Existing entry is not a verified editorial output; use a different --out or explicit --replace');
  // Check every old generated file, even one no longer needed by new titles.
  if (!replace && previous?.generator === MARKER) {
    for (const [name, sha] of Object.entries(previous.generatedFiles ?? {})) {
      const target = await projectPath(root, posix(path.relative(root, path.join(outPath, name))), { mustExist: false });
      const actual = await hashOptional(target);
      assert(actual === sha, `Generated file has been edited or removed: ${name}; preserve it with a different --out or use explicit --replace`);
    }
  }
  // All checks happen before writes. Collisions outside a known output are
  // rejected, including assets; --replace only covers this tool's target files.
  for (const name of [...files.keys(), ...copies.keys(), 'source-bindings.json']) {
    const target = await projectPath(root, posix(path.relative(root, path.join(outPath, name))), { mustExist: false });
    const existing = await hashOptional(target);
    if (existing && !replace && !previous?.generatedFiles?.[name] && name !== 'source-bindings.json') assert(generatedFiles[name] === existing, `Unowned file collision: ${name}; use a different --out or explicit --replace`);
  }
  const requiredAudioWork = [...(['narration', 'replace'].includes(requirements.audioMode) ? [{ role: requirements.audioMode === 'replace' ? 'replacement' : 'narration', status: 'pending', evidence: 'Add a distinct audio node with data-editorial-audio-role matching this role; the adapter does not create speech' }] : []), ...(requirements.music === 'on' ? [{ role: 'music', status: 'pending', evidence: 'Add an audio node with data-editorial-audio-role="music"; the adapter does not create music' }] : [])];
  const bindings = { schemaVersion: 1, generator: MARKER, entry: 'index.html', entrySha256: generatedFiles['index.html'], scenesFile: 'assets/editorial/scenes.snapshot.json', scenesSha256: digest(input), originScenesFile: posix(path.relative(root, scenesPath)), requirementsFile: 'assets/editorial/requirements.snapshot.json', requirementsSha256: generatedFiles['assets/editorial/requirements.snapshot.json'], requirements, overlayCaptionHidden: requirements.subtitles === 'none', requiredAudioWork, canvas, durationSeconds, scenes, generatedFiles, warnings };
  files.set('source-bindings.json', Buffer.from(json(bindings)));
  await fs.mkdir(outPath, { recursive: true });
  const staging = await fs.mkdtemp(path.join(outPath, '.editorial-tmp-'));
  try {
    // Stage and verify media before publishing any generated document. Copying
    // large files uses streaming OS I/O; hashes also never read the whole file.
    for (const [name, source] of copies) {
      const staged = path.join(staging, name);
      await fs.mkdir(path.dirname(staged), { recursive: true });
      await fs.copyFile(source.file, staged);
      assert(await fileSha256(staged) === source.sha256, `Source changed during assembly: ${source.file}; rerun from a stable input`);
    }
    for (const [name, bytes] of files) {
      const staged = path.join(staging, name);
      await fs.mkdir(path.dirname(staged), { recursive: true });
      await fs.writeFile(staged, bytes);
    }
    // Each replacement is atomic. Entry and bindings are the final commits;
    // interruption before bindings leaves a detectable hash mismatch, never a
    // falsely valid completed binding. Unrelated/previous files are untouched.
    const order = [...copies.keys(), ...[...files.keys()].filter(name => !['index.html', 'source-bindings.json'].includes(name)), 'index.html', 'source-bindings.json'];
    for (const name of order) {
      const target = path.join(outPath, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(path.join(staging, name), target);
    }
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  return { ok: true, entry: path.join(outPath, 'index.html'), bindings: path.join(outPath, 'source-bindings.json'), durationSeconds, sceneIds: scenes.map(scene => scene.id), requiredAudioWork, overlayCaptionHidden: bindings.overlayCaptionHidden, warnings };
}

async function main() {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--replace') options.replace = true;
    else if (['--project', '--scenes', '--out', '--width', '--height', '--fps'].includes(arg)) { assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `Missing value for ${arg}`); options[arg.slice(2)] = process.argv[++i]; }
    else if (arg === '--help') { console.log('node assemble.mjs --project ROOT --scenes scenes.json [--out .] [--width 1280 --height 720 --fps 30] [--replace]'); return; }
    else throw new Error(`Unknown argument: ${arg}`);
  }
  console.log(json(await assembleEditorial(options)));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(json({ ok: false, error: error.message })); process.exitCode = 1; });
