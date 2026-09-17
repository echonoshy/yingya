// Build a portable, silent acceptance sample from the same installed components
// that production agents use. Generated media stays outside the repository.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildShowcase(output, { portrait = false } = {}) {
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'DESIGN.md'), `# Anime.js component acceptance sample

## Style Prompt
An original Chinese motion study: a crisp white canvas, expressive large type,
clear connecting paths and a measured pair of numbers. The three scenes have
distinct compositions; motion explains reveal, connection and change.

## Colors
- Canvas: #ffffff
- Ink: #19232f
- Supporting text: #48576a
- Accent: #185bd8
- Supporting surface: #edf2fa

## Typography
Noto Sans SC Variable, 600 for titles and 400 for supporting text.

## Motion
Finite, seek-driven motion. Title reveal, line drawing, then numeric change.
Five seconds per scene with short crossfades and a readable final hold.

## What NOT to Do
No unseeded randomness, scrolling triggers, network assets, invented factual
claims, hidden narrow-screen text, glow or decorative continuous motion.
The comparison values are explicitly labelled as example data.
`);
  execFileSync(process.execPath, [path.join(repo, 'runtime/animejs/cli.mjs'), 'install', '--project', output]);
  await fs.copyFile(path.join(repo, 'runtime/editorial/vendor/gsap-3.14.2.min.js'), path.join(output, 'assets/gsap.min.js'));
  await fs.copyFile(path.join(repo, 'runtime/editorial/vendor/GSAP-LICENSE'), path.join(output, 'assets/GSAP-LICENSE'));
  const fonts = path.join(repo, 'node_modules/@fontsource-variable/noto-sans-sc');
  await fs.cp(path.join(fonts, 'files'), path.join(output, 'assets/fonts/files'), { recursive: true });
  await fs.copyFile(path.join(fonts, 'index.css'), path.join(output, 'assets/fonts/fonts.css'));
  await fs.copyFile(path.join(fonts, 'LICENSE'), path.join(output, 'assets/fonts/LICENSE'));
  const width = portrait ? 720 : 1280, height = portrait ? 1280 : 720;
  const configs = [
    { component: 'title-reveal', startSeconds: 0, durationSeconds: 5,
      title: '让想法，流动起来', eyebrow: '映芽 · 动画镜头', subtitle: '把内容变成看得见的故事' },
    { component: 'flow-path', startSeconds: 5, durationSeconds: 5,
      title: '每一步，都清晰可见', nodes: [
        { label: '内容', detail: '放入你的素材' },
        { label: '分析', detail: '找到表达重点' },
        { label: '成片', detail: '组合成一个故事' },
      ] },
    { component: 'number-compare', startSeconds: 10, durationSeconds: 5,
      title: '让变化，一眼可见', metrics: [
        { label: '起点', from: 0, value: 12, unit: '份' },
        { label: '结果', from: 0, value: 48, unit: '份' },
      ], footnote: '示例数据 · 用于展示数字动画' },
  ];
  await fs.writeFile(path.join(output, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>映芽 · Anime.js 可复用镜头</title>
<link rel="stylesheet" href="assets/fonts/fonts.css">
<link rel="stylesheet" href="assets/animejs/scenes.css">
<style>
html,body { margin:0; background:#fff; }
#composition { width:${width}px; height:${height}px; position:relative; overflow:hidden;
  --yga-font:'Noto Sans SC Variable',sans-serif;
  --yga-background:#ffffff; --yga-foreground:#19232f; --yga-muted:#48576a;
  --yga-accent:#185bd8; --yga-surface:#edf2fa; --yga-heading-weight:600; }
.sample-scene { position:absolute; inset:0; width:100%; height:100%; background:#fff; }
#title-scene,#flow-scene,#number-scene { opacity:0; }
</style>
<script src="assets/gsap.min.js"></script>
<script src="assets/animejs/anime.umd.min.js"></script>
<script src="assets/animejs/scenes.js"></script>
</head><body>
<main id="composition" data-composition-id="main" data-start="0" data-duration="15" data-width="${width}" data-height="${height}" data-fps="30">
<section id="title-scene" class="sample-scene"></section>
<section id="flow-scene" class="sample-scene"></section>
<section id="number-scene" class="sample-scene"></section>
</main>
<script>
const sceneIds = ['title-scene','flow-scene','number-scene'];
const configs = ${JSON.stringify(configs)};
configs.forEach((config,index) => YingyaAnime.createScene(document.getElementById(sceneIds[index]),config));
const tl = gsap.timeline({paused:true});
tl.to('#title-scene',{opacity:1,duration:.25},.1);
tl.to('#flow-scene',{opacity:1,duration:.4},5).to('#title-scene',{opacity:0,duration:.4},5);
tl.to('#number-scene',{opacity:1,duration:.4},10).to('#flow-scene',{opacity:0,duration:.4},10);
tl.to('#number-scene',{opacity:0,duration:.35},14.65);
window.__timelines = window.__timelines || {};
window.__timelines.main = tl;
</script>
</body></html>`);
  await fs.writeFile(path.join(output, 'index.motion.json'), JSON.stringify({ duration: 15, assertions: [
    { kind: 'appearsBy', selector: '#title-scene', bySec: 1 },
    { kind: 'appearsBy', selector: '#flow-scene', bySec: 5.7 },
    { kind: 'appearsBy', selector: '#number-scene', bySec: 10.7 },
    ...['title-scene', 'flow-scene', 'number-scene'].map(id => ({ kind: 'staysInFrame', selector: `#${id}` })),
  ] }, null, 2));
  await fs.writeFile(path.join(output, 'hyperframes.json'), JSON.stringify({ name: 'yingya-anime-showcase', fps: 30 }, null, 2));
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2];
  if (!output) throw new Error('Usage: node tests/anime-showcase.mjs OUTPUT [--portrait]');
  console.log(await buildShowcase(path.resolve(output), { portrait: process.argv.includes('--portrait') }));
}
