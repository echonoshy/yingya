#!/usr/bin/env node
// Copy release-owned GSAP files into an independently renderable video project.
import { readFile, mkdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../assets/gsap/', import.meta.url));
const allowed = new Set(['SplitText', 'DrawSVGPlugin', 'MorphSVGPlugin', 'MotionPathPlugin']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const usage = 'Usage: install-gsap.mjs --project PATH [--plugins SplitText,DrawSVGPlugin,MorphSVGPlugin,MotionPathPlugin]';

export async function install(project, plugins = []) {
  if (!project) throw new Error('--project is required');
  for (const plugin of plugins) if (!allowed.has(plugin)) throw new Error(`Unsupported bundled plugin: ${plugin}`);
  const root = await realpath(project);
  const provenance = JSON.parse(await readFile(path.join(source, 'PROVENANCE.json'), 'utf8'));
  const names = ['gsap.min.js', ...new Set(plugins.map(name => `${name}.min.js`)), 'LICENSE'];
  const files = [];
  for (const name of names) {
    const record = provenance.files.find(file => file.localPath === name);
    const bytes = await readFile(path.join(source, name));
    if (!record || digest(bytes) !== record.sha256) throw new Error(`Bundled file failed integrity check: ${name}`);
    files.push({ name, bytes });
  }
  // Keep a stable full manifest so adding another selected plugin is idempotent.
  // Entries describe the upstream bundle; only requested script files are copied.
  files.push({ name: 'PROVENANCE.json', bytes: await readFile(path.join(source, 'PROVENANCE.json')) });
  const relative = `assets/gsap-${provenance.version}`;
  let destination = root;
  for (const part of relative.split('/')) {
    destination = path.join(destination, part);
    await mkdir(destination).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (!(await lstat(destination)).isDirectory()) throw new Error(`Destination must be a real directory: ${destination}`);
  }
  // Preflight all destinations before copying, protecting existing project edits.
  const pending = [];
  for (const file of files) {
    const target = path.join(destination, file.name);
    const stat = await lstat(target).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat) {
      if (!stat.isFile() || !file.bytes.equals(await readFile(target))) throw new Error(`Refusing to overwrite changed or non-regular file: ${target}`);
    } else pending.push({ ...file, target });
  }
  for (const file of pending) await writeFile(file.target, file.bytes, { flag: 'wx' });
  return { version: provenance.version, scripts: names.filter(name => name.endsWith('.js')).map(name => `${relative}/${name}`), license: `${relative}/LICENSE`, provenance: `${relative}/PROVENANCE.json` };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
      console.log(usage);
    } else {
      let project, plugins = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--project' && args[i + 1]) project = args[++i];
        else if (args[i] === '--plugins' && args[i + 1]) plugins = args[++i].split(',');
        else throw new Error(usage);
      }
      console.log(JSON.stringify(await install(project, plugins), null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
