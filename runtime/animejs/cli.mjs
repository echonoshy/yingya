#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const requiredFiles = ['anime.umd.min.js', 'LICENSE.animejs.md', 'PROVENANCE.json', 'scenes.js', 'scenes.css', 'catalog.json', 'README.md', 'cli.mjs'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function statOrNull(file) {
  try { return await fs.lstat(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function plainDirectory(directory) {
  const absolute = path.resolve(directory);
  const parts = absolute.split(path.sep).filter(Boolean);
  let current = path.parse(absolute).root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not allowed in install paths: ${current}`);
    if (!stat.isDirectory()) throw new Error(`Expected directory: ${current}`);
  }
  return absolute;
}

async function payload() {
  const files = new Map();
  for (const name of requiredFiles) {
    const stat = await fs.lstat(path.join(sourceRoot, name));
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Pack source must be a regular file: ${name}`);
    files.set(name, await fs.readFile(path.join(sourceRoot, name)));
  }
  const previewDirectory = path.join(sourceRoot, 'previews');
  const previewStat = await statOrNull(previewDirectory);
  if (previewStat) {
    if (previewStat.isSymbolicLink() || !previewStat.isDirectory()) throw new Error('Pack previews must be a plain directory');
    for (const name of (await fs.readdir(previewDirectory)).sort()) {
      if (!/^[a-z0-9-]+\.png$/.test(name)) throw new Error(`Unexpected preview filename: ${name}`);
      const stat = await fs.lstat(path.join(previewDirectory, name));
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Pack preview must be a regular file: ${name}`);
      files.set(`previews/${name}`, await fs.readFile(path.join(previewDirectory, name)));
    }
  }
  const manifest = {
    packVersion: '1.0.0', animeVersion: '4.5.0',
    files: Object.fromEntries([...files].map(([name, bytes]) => [name, hash(bytes)])),
  };
  files.set('install-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  return files;
}

export async function listComponents() {
  return JSON.parse(await fs.readFile(path.join(sourceRoot, 'catalog.json'), 'utf8'));
}

export async function installComponents(project) {
  if (typeof project !== 'string' || !project.trim()) throw new Error('--project must name an existing project directory');
  const root = await plainDirectory(project);
  const files = await payload();
  const assets = path.join(root, 'assets');
  const assetsStat = await statOrNull(assets);
  if (assetsStat?.isSymbolicLink() || (assetsStat && !assetsStat.isDirectory())) throw new Error('assets must be a plain directory; symlinks are not allowed');
  const target = path.join(assets, 'animejs');
  const targetStat = await statOrNull(target);
  if (targetStat?.isSymbolicLink() || (targetStat && !targetStat.isDirectory())) throw new Error('assets/animejs must be a plain directory; symlinks are not allowed');
  if (targetStat) {
    // Preflight every installed path before any write. Never overwrite a manual
    // edit or silently mix files from two pack versions.
    for (const [name, bytes] of files) {
      if (name.includes('/')) await plainDirectory(path.dirname(path.join(target, name)));
      const destination = path.join(target, name);
      const stat = await statOrNull(destination);
      if (stat?.isSymbolicLink()) throw new Error(`Symlinks are not allowed: ${destination}`);
      if (!stat?.isFile() || hash(await fs.readFile(destination)) !== hash(bytes)) {
        throw new Error(`Existing Anime.js pack differs at ${name}; preserving it. Install into a fresh project or deliberately move the existing assets/animejs directory first.`);
      }
    }
    return { directory: target, status: 'unchanged', packVersion: '1.0.0', files: [...files.keys()] };
  }
  if (!assetsStat) await fs.mkdir(assets);
  await plainDirectory(assets);
  const staging = await fs.mkdtemp(path.join(assets, '.animejs-install-'));
  try {
    for (const [name, bytes] of files) {
      const destination = path.join(staging, name);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes, { flag: 'wx' });
    }
    if (await statOrNull(target)) throw new Error('assets/animejs appeared during installation; preserving it');
    await fs.rename(staging, target);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return { directory: target, status: 'installed', packVersion: '1.0.0', files: [...files.keys()] };
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node cli.mjs list [--json] | install --project <existing-project-directory>\nInstalls the pinned offline Anime.js scene pack into assets/animejs. Existing edits are preserved.\n');
    return;
  }
  if (args[0] === 'list' && (args.length === 1 || (args.length === 2 && args[1] === '--json'))) {
    const catalog = await listComponents();
    if (args[1] === '--json') process.stdout.write(JSON.stringify(catalog, null, 2) + '\n');
    else for (const component of catalog.components) process.stdout.write(`${component.id}\t${component.purpose}\n`);
    return;
  }
  if (args[0] === 'install' && args[1] === '--project' && args[2] && args.length === 3) {
    process.stdout.write(JSON.stringify(await installComponents(args[2]), null, 2) + '\n');
    return;
  }
  throw new Error('Usage: node cli.mjs list [--json] | install --project <existing-project-directory>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Anime.js components: ${error.message}\n`);
    process.exitCode = 1;
  });
}
