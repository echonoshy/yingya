#!/usr/bin/env node
// Project-local source imports and self-contained browser bundles. The host owns
// the CLI/build tools; a video project only installs its own locked dependencies.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listComponents as animeCatalog, installComponents as installAnime } from './animejs/cli.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const hostModules = process.env.YINGYA_NODE_MODULES || path.resolve(here, '../node_modules');
const hostRequire = createRequire(path.join(hostModules, '_yingya-components.cjs'));
const LIBRARY = 'component-library';
const MARKER = 'yingya-component-library:v1';
const registryUrl = 'https://reactbits.dev/r/{name}.json';
const providers = {
  '@react-bits': { url: registryUrl, license: 'components/react-bits-LICENSE.md', licenseSource: 'https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md' },
  '@magicui': { url: 'https://magicui.design/r/{name}.json', license: 'components/magic-beam/magic-ui-LICENSE.md', licenseSource: 'https://github.com/magicuidesign/magicui/blob/main/LICENSE.md' },
};
const shadcnDependency = { id: '@shadcn-dependency', url: 'https://ui.shadcn.com/r/styles/new-york-v4/{name}.json', license: 'components/shadcn-LICENSE.md', licenseSource: 'https://github.com/shadcn-ui/ui/blob/main/LICENSE.md' };
const shadcnDependencyPattern = /^https:\/\/ui\.shadcn\.com\/r\/styles\/new-york-v4\/([a-z][a-z0-9-]*)\.json$/;
// Default shadcn dependencies expect semantic colors from their scaffold.
// Use fallbacks instead of element resets or :root values so the video's own
// inherited --primary, --background, etc. retain control of the design.
const shadcnThemeDefaults = `@theme inline {
  --color-background: var(--background, #ffffff);
  --color-foreground: var(--foreground, #171717);
  --color-card: var(--card, #ffffff);
  --color-card-foreground: var(--card-foreground, #171717);
  --color-popover: var(--popover, #ffffff);
  --color-popover-foreground: var(--popover-foreground, #171717);
  --color-primary: var(--primary, #171717);
  --color-primary-foreground: var(--primary-foreground, #fafafa);
  --color-secondary: var(--secondary, #f5f5f5);
  --color-secondary-foreground: var(--secondary-foreground, #171717);
  --color-muted: var(--muted, #f5f5f5);
  --color-muted-foreground: var(--muted-foreground, #737373);
  --color-accent: var(--accent, #f5f5f5);
  --color-accent-foreground: var(--accent-foreground, #171717);
  --color-destructive: var(--destructive, #dc2626);
  --color-destructive-foreground: var(--destructive-foreground, #ffffff);
  --color-border: var(--border, #e5e5e5);
  --color-input: var(--input, #e5e5e5);
  --color-ring: var(--ring, #a3a3a3);
  --radius-sm: calc(var(--radius, 0.625rem) - 4px);
  --radius-md: calc(var(--radius, 0.625rem) - 2px);
  --radius-lg: var(--radius, 0.625rem);
  --radius-xl: calc(var(--radius, 0.625rem) + 4px);
}
`;
const assetLoaders = Object.fromEntries(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'woff', 'woff2', 'ttf', 'mp4', 'webm', 'mp3', 'wav', 'glb', 'gltf', 'hdr'].map(extension => [`.${extension}`, 'file']));
const assetPattern = /\.(?:png|jpe?g|webp|gif|svg|avif|woff2?|ttf|mp4|webm|mp3|wav|glb|gltf|hdr)$/i;
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const posix = value => value.split(path.sep).join('/');
function check(value, message) { if (!value) throw new Error(message); }
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
async function exists(file) { try { await fs.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }

export async function projectPath(root, relative, { mustExist = false } = {}) {
  check(typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative) && !relative.includes('\0') && !relative.includes('\\') && !relative.split('/').includes('..'), `Project path must be relative without traversal: ${relative}`);
  const target = path.resolve(root, relative);
  check(within(root, target), `Path leaves project: ${relative}`);
  let current = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      check(!stat.isSymbolicLink(), `Symlinks are not accepted for component inputs/outputs: ${relative}`);
    } catch (error) { if (error.code !== 'ENOENT' || mustExist) throw error; }
  }
  return target;
}

export function componentName(component) {
  check(typeof component === 'string' && /^@(react-bits|magicui)\/[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(component), 'Use an explicit @react-bits/Component-TS-CSS or @magicui/component registry item (URLs and filesystem paths are not accepted).');
  return component.split('/')[1];
}
const componentProvider = component => { componentName(component); return component.split('/')[0]; };
const importName = component => `${componentProvider(component) === '@magicui' ? 'magicui-' : ''}${componentName(component)}`;
export function registryDependency(value, provider) {
  // Bare names are shadcn's default registry dependencies, not components in
  // the requesting provider. Keep this trusted source dependency-only.
  if (provider === '@magicui' || provider === shadcnDependency.id) {
    if (/^[a-z][a-z0-9-]*$/.test(value)) return shadcnDependency.url.replace('{name}', value);
    if (shadcnDependencyPattern.test(value)) return value;
  }
  if (provider === '@magicui' && /^https:\/\/magicui\.design\/r\/[a-z][a-z0-9-]*\.json$/.test(value)) return `@magicui/${value.split('/').pop().slice(0, -5)}`;
  componentName(value);
  check(componentProvider(value) === provider, 'Registry dependencies must stay within their source provider.');
  return value;
}
function registrySource(component) {
  const dependency = shadcnDependencyPattern.exec(component);
  if (dependency) return { ...shadcnDependency, name: dependency[1], registry: component };
  const id = componentProvider(component);
  return { ...providers[id], id, name: componentName(component), registry: providers[id].url.replace('{name}', componentName(component)) };
}
function registryFile(component) {
  const source = registrySource(component);
  return `${source.id.slice(1)}-${source.name}.json`;
}

function config() {
  return { $schema: 'https://ui.shadcn.com/schema.json', style: 'new-york', rsc: false, tsx: true,
    tailwind: { config: '', css: 'src/styles.css', baseColor: 'neutral', cssVariables: true },
    aliases: { components: '@/components', utils: '@/lib/utils', ui: '@/components', lib: '@/lib', hooks: '@/hooks' },
    registries: Object.fromEntries(Object.entries(providers).map(([id, provider]) => [id, provider.url])) };
}

async function run(command, args, cwd, timeout = 180000) {
  try {
    return await exec(command, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CI: 'true', NO_COLOR: '1', npm_config_ignore_scripts: 'true', npm_config_save_exact: 'true', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_global: 'false' } });
  } catch (error) {
    const details = [error.stderr, error.stdout].filter(Boolean).join('\n') || error.message;
    throw new Error(`${path.basename(command)} ${args[0]} failed${error.killed ? ' (timeout)' : ''}:\n${String(details).slice(-10000)}`);
  }
}

function shadcnPath() {
  try { return hostRequire.resolve('shadcn/dist/index.js'); }
  catch {
    // shadcn's export map deliberately hides its CLI entry.
    return path.join(hostModules, 'shadcn/dist/index.js');
  }
}
async function cli(args, cwd) {
  check(await exists(shadcnPath()), 'The host shadcn CLI is missing. Ask the deployment administrator to restore pinned runtime dependencies; do not install a CLI inside a video project.');
  return run(process.execPath, [shadcnPath(), ...args, '--cwd', cwd], cwd);
}
function parseOutput(output, operation) {
  try { return JSON.parse(output); } catch { throw new Error(`shadcn ${operation} returned invalid JSON: ${output.slice(-2000)}`); }
}

async function rootPath(project) {
  check(typeof project === 'string' && project.length > 0, '--project PATH is required.');
  const root = await fs.realpath(path.resolve(project));
  check((await fs.stat(root)).isDirectory(), '--project must be an existing directory.');
  return root;
}

export async function initLibrary({ project }) {
  const root = await rootPath(project);
  const library = await projectPath(root, LIBRARY);
  if (await exists(library)) {
    const marker = await projectPath(root, `${LIBRARY}/library.json`, { mustExist: true });
    check(JSON.parse(await fs.readFile(marker, 'utf8')).generator === MARKER, 'Existing component-library directory is not managed by this tool; move it explicitly before initialization.');
    for (const name of ['components.json', 'package.json', 'tsconfig.json', 'src/styles.css']) await projectPath(library, name, { mustExist: true });
    const settings = JSON.parse(await fs.readFile(path.join(library, 'components.json'), 'utf8'));
    check(settings.registries?.['@react-bits'] === registryUrl, 'The managed @react-bits registry URL was changed; restore it before importing components.');
    if (settings.registries['@magicui']) check(settings.registries['@magicui'] === providers['@magicui'].url, 'The managed @magicui registry URL was changed; restore it before importing components.');
    else {
      // Adopt the additional official provider without replacing existing
      // aliases, custom configuration or component sources.
      settings.registries['@magicui'] = providers['@magicui'].url;
      await fs.writeFile(path.join(library, 'components.json'), json(settings));
    }
    return { project: root, library };
  }
  const reactVersion = JSON.parse(await fs.readFile(path.join(hostModules, 'react/package.json'), 'utf8')).version;
  const reactDomVersion = JSON.parse(await fs.readFile(path.join(hostModules, 'react-dom/package.json'), 'utf8')).version;
  await fs.mkdir(library);
  await fs.mkdir(path.join(library, 'src'));
  await fs.writeFile(path.join(library, 'library.json'), json({ generator: MARKER }), { flag: 'wx' });
  await fs.writeFile(path.join(library, 'package.json'), json({ name: 'yingya-video-components', version: '1.0.0', private: true, type: 'module', dependencies: { react: reactVersion, 'react-dom': reactDomVersion } }), { flag: 'wx' });
  await fs.writeFile(path.join(library, 'components.json'), json(config()), { flag: 'wx' });
  await fs.writeFile(path.join(library, 'tsconfig.json'), json({ compilerOptions: { target: 'ES2022', jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'Bundler', baseUrl: '.', paths: { '@/*': ['./src/*'] } } }), { flag: 'wx' });
  await fs.writeFile(path.join(library, 'src/styles.css'), '', { flag: 'wx' });
  return { project: root, library };
}

export async function searchComponents({ project, query = '', limit = 20, offset = 0, registry = 'all' }) {
  check(Number.isInteger(Number(limit)) && Number(limit) > 0 && Number(limit) <= 1000, '--limit must be 1..1000.');
  check(Number.isInteger(Number(offset)) && Number(offset) >= 0, '--offset must be nonnegative.');
  const { library } = await initLibrary({ project });
  check(registry === 'all' || Object.hasOwn(providers, registry), '--registry must be all, @react-bits or @magicui');
  return parseOutput((await cli(['search', ...(registry === 'all' ? Object.keys(providers) : [registry]), '--query', query, '--limit', String(limit), '--offset', String(offset), '--json'], library)).stdout, 'search');
}

export async function viewComponent({ project, component }) {
  if (!component?.startsWith('@')) return viewPack(component);
  componentName(component);
  const { library } = await initLibrary({ project });
  return parseOutput((await cli(['view', component], library)).stdout, 'view');
}

async function filesIn(root, relative = '') {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = posix(path.join(relative, entry.name));
    check(!entry.isSymbolicLink(), `Symlinks are not accepted in imported/generated files: ${name}`);
    if (entry.isDirectory()) result.push(...await filesIn(root, name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`Unsupported special file: ${name}`);
  }
  return result.sort();
}

async function withLock(library, operation) {
  const lock = await projectPath(library, '.operation.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx'); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('A component operation is already active. If it was interrupted, inspect and remove component-library/.operation.lock before retrying.'); throw error; }
  await handle.writeFile(json({ pid: process.pid, startedAt: new Date().toISOString() }));
  try { return await operation(); }
  finally { await handle.close(); await fs.rm(lock, { force: true }); }
}

// Registry data is untrusted. Restrict destinations and dependency protocols
// before allowing the upstream CLI to write even into the staging directory.
function validateCssObject(value, label, depth = 0) {
  check(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, `${label} must be a CSS object.`);
  check(depth <= 12, `${label} is too deeply nested.`);
  for (const [key, child] of Object.entries(value)) {
    check(key.length > 0 && key.length < 1024 && !['__proto__', 'prototype', 'constructor'].includes(key), `${label} contains an invalid CSS key.`);
    if (child && typeof child === 'object') validateCssObject(child, `${label}.${key}`, depth + 1);
    else check(typeof child === 'string' && child.length < 128 * 1024, `${label}.${key} must be a CSS string or nested object.`);
  }
}
export function validateRegistry(item, provider = '@react-bits') {
  check(item && /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(item.name), 'Invalid registry item name.');
  check(Array.isArray(item.files) && item.files.length > 0, 'Registry item contains no source files.');
  for (const file of item.files) {
    check(typeof file.content === 'string' && file.content.length < 8 * 1024 * 1024, 'Registry source content is missing or too large.');
    for (const value of [file.path, file.target].filter(value => value !== undefined)) {
      check(typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && !/[\\\0]/.test(value) && !value.split('/').includes('..'), `Unsafe registry destination: ${value}`);
      check(!value.startsWith('~') && !value.includes('://'), `Unsafe registry destination: ${value}`);
    }
    check(['registry:component', 'registry:ui', 'registry:file', 'registry:lib', 'registry:hook'].includes(file.type), `Unsupported registry file type: ${file.type}`);
    if (file.type === 'registry:file') check(file.target, 'Registry file entries require an explicit target inside src.');
    if (file.target) check(/^@(components|ui|lib|hooks)\//.test(file.target) || file.target.startsWith('src/'), `Unsupported registry target outside src: ${file.target}`);
  }
  for (const dependency of [...(item.dependencies || []), ...(item.devDependencies || [])]) {
    check(typeof dependency === 'string' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[\d\w^~.*+<>=| -]+)?$/i.test(dependency), `Only npm registry dependencies are accepted: ${dependency}`);
  }
  for (const dependency of item.registryDependencies || []) registryDependency(dependency, provider);
  check(item.envVars === undefined, 'Registry environment changes are not allowed.');
  if (item.css !== undefined) validateCssObject(item.css, 'css');
  if (item.cssVars !== undefined) {
    validateCssObject(item.cssVars, 'cssVars');
    for (const [mode, variables] of Object.entries(item.cssVars)) {
      check(['theme', 'light', 'dark'].includes(mode), `Unsupported cssVars scope: ${mode}`);
      validateCssObject(variables, `cssVars.${mode}`);
      check(Object.values(variables).every(value => typeof value === 'string'), `cssVars.${mode} values must be CSS strings.`);
    }
  }
  check(JSON.stringify({ css: item.css, cssVars: item.cssVars }).length < 1024 * 1024, 'Registry CSS is too large.');
}

async function registryTree(component, library, seen = new Map()) {
  if (seen.has(component)) return seen;
  const items = parseOutput((await cli(['view', component], library)).stdout, 'view');
  check(Array.isArray(items) && items.length === 1, 'Expected exactly one registry item from shadcn view.');
  const item = items[0];
  const source = registrySource(component);
  validateRegistry(item, source.id);
  check(item.name === source.name, 'Registry returned a different component name.');
  seen.set(component, item);
  for (const dependency of item.registryDependencies || []) await registryTree(registryDependency(dependency, source.id), library, seen);
  return seen;
}

async function ensureDependencies(library) {
  const lock = await projectPath(library, 'package-lock.json');
  const nodeModules = await projectPath(library, 'node_modules');
  if (!await exists(lock)) await run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], library);
  const lockData = await fs.readFile(lock);
  const packageData = JSON.parse(await fs.readFile(await projectPath(library, 'package.json', { mustExist: true }), 'utf8'));
  const lockedPackage = JSON.parse(lockData).packages?.[''];
  const sorted = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
  // npm may also list optional packages in the lock root's dependencies, with
  // a different spec. optionalDependencies takes precedence in both manifests.
  const required = value => Object.fromEntries(Object.entries(value.dependencies || {}).filter(([name]) => !Object.hasOwn(value.optionalDependencies || {}, name)));
  check(lockedPackage && sorted(required(packageData)) === sorted(required(lockedPackage))
    && ['devDependencies', 'optionalDependencies'].every(key => sorted(packageData[key]) === sorted(lockedPackage[key])), 'package.json and package-lock.json disagree. Run npm install --ignore-scripts inside component-library to update the project lock, then retry.');
  const stamp = await projectPath(library, 'node_modules/.yingya-lock-sha256');
  const current = await exists(stamp) ? await fs.readFile(stamp, 'utf8') : '';
  if (current !== hash(lockData)) {
    // npm ci reconstructs project-local packages from the saved lock after a
    // version restore; dependencies never fall back to an ancestor worktree.
    await run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], library);
    check(await exists(nodeModules), 'npm ci produced no project dependencies.');
    await fs.writeFile(stamp, hash(lockData));
  }
  return lockData;
}

// Resolve static imports without executing source or bundling dependency code.
// Registry metadata can omit packages/assets, even when shadcn add succeeds.
async function inspectSources(directory, sourceFiles) {
  const issues = [];
  const esbuild = hostRequire('esbuild');
  const record = (message, file, specifier) => issues.push({ message, ...(file ? { file: posix(path.relative(directory, path.resolve(directory, file))) } : {}), ...(specifier ? { specifier } : {}) });
  try {
    await esbuild.build({ absWorkingDir: directory,
      entryPoints: sourceFiles.filter(file => /\.[cm]?[jt]sx?$/.test(file)).map(file => `./src/${file}`),
      outdir: path.join(directory, '.diagnostics-unused'), write: false, bundle: true,
      platform: 'browser', format: 'esm', jsx: 'automatic', loader: assetLoaders, logLevel: 'silent',
      plugins: [{ name: 'inspect-static-imports', setup(build) {
        build.onResolve({ filter: /.*/ }, async args => {
          if (args.pluginData?.inspecting) return;
          if (/^(https?:|\/\/)/.test(args.path)) {
            record('Remote import must be copied into the project.', args.importer, args.path);
            return { path: args.path, external: true };
          }
          const resolved = await build.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: { inspecting: true } });
          if (resolved.errors.length) {
            for (const error of resolved.errors) record(error.text, args.importer, args.path);
            return { path: args.path, external: true };
          }
          // Dependencies have their own exports and platform constraints; only
          // inspect the imported component's source graph here.
          if (resolved.path.split(path.sep).includes('node_modules')) return { path: args.path, external: true };
          return resolved;
        });
        build.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'css' }));
      } }],
    });
  } catch (error) {
    if (!error.errors) throw error;
    for (const detail of error.errors) record(detail.text, detail.location?.file);
  }
  return { status: issues.length ? 'needs-repair' : 'imports-resolved', issues,
    scope: 'Static JavaScript/TypeScript imports only. CSS resources, runtime URLs, animation timing and rendered output still require verification.' };
}

export async function diagnoseComponent({ project, component }) {
  const { library } = await initLibrary({ project });
  return withLock(library, async () => {
    const directory = await projectPath(library, `imports/${importName(component)}`, { mustExist: true });
    const source = await projectPath(directory, 'src', { mustExist: true });
    await ensureDependencies(library);
    return { component, directory, diagnostics: await inspectSources(directory, await filesIn(source)) };
  });
}

export async function addComponent({ project, component }) {
  const name = componentName(component);
  const providerId = componentProvider(component);
  const provider = providers[providerId];
  const { library, project: root } = await initLibrary({ project });
  return withLock(library, async () => {
    const destination = await projectPath(library, `imports/${importName(component)}`);
    check(!await exists(destination), `Component ${name} is already present. Its source may contain manual edits; this tool never overwrites an existing import.`);
    const tree = await registryTree(component, library);
    const needsShadcn = [...tree.keys()].some(id => registrySource(id).id === shadcnDependency.id);
    const stage = await fs.mkdtemp(path.join(library, '.import-'));
    try {
      const packagePath = await projectPath(library, 'package.json', { mustExist: true });
      const originalPackage = await fs.readFile(packagePath);
      const stagedPackage = JSON.parse(originalPackage);
      if (providerId === '@magicui') {
        stagedPackage.dependencies = { clsx: '2.1.1', 'tailwind-merge': '3.7.0', tailwindcss: '4.3.3', ...stagedPackage.dependencies };
        // Default shadcn sources assume the manual-install scaffold includes
        // CVA (for example Button does not repeat it in registry dependencies).
        if (needsShadcn) {
          stagedPackage.dependencies = { 'class-variance-authority': '0.7.1', ...stagedPackage.dependencies };
        }
      }
      await fs.writeFile(path.join(stage, 'package.json'), json(stagedPackage));
      const lockPath = await projectPath(library, 'package-lock.json');
      const originalLock = await exists(lockPath) ? await fs.readFile(lockPath) : null;
      if (originalLock) await fs.writeFile(path.join(stage, 'package-lock.json'), originalLock);
      // Extend the existing dependency graph instead of resolving every earlier
      // import from scratch when the new provider needs CSS helpers.
      if (providerId === '@magicui') await run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
      await fs.writeFile(path.join(stage, 'components.json'), json(config()));
      await fs.writeFile(path.join(stage, 'tsconfig.json'), await fs.readFile(path.join(library, 'tsconfig.json')));
      await fs.mkdir(path.join(stage, 'src'));
      // Seed a real stylesheet before shadcn applies registry css/cssVars. Its
      // PostCSS updater needs an insertion anchor; an empty sheet fails for
      // components such as Marquee. Omit global preflight resets.
      await fs.writeFile(path.join(stage, 'src/styles.css'), providerId === '@magicui'
        ? '@import "tailwindcss/theme.css" layer(theme);\n@import "tailwindcss/utilities.css" layer(utilities);\n@source "../../../";\n' + (needsShadcn ? shadcnThemeDefaults : '')
        : '');
      if (providerId === '@magicui') {
        await fs.mkdir(path.join(stage, 'src/lib'));
        await fs.writeFile(path.join(stage, 'src/lib/utils.ts'), 'import { clsx, type ClassValue } from "clsx"; import { twMerge } from "tailwind-merge"; export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }\n');
      }
      await fs.mkdir(path.join(stage, 'registry'));
      for (const [id, item] of tree) {
        const source = registrySource(id);
        const installItem = { ...item, registryDependencies: (item.registryDependencies || []).map(value => path.join(stage, 'registry', registryFile(registryDependency(value, source.id)))) };
        await fs.writeFile(path.join(stage, 'registry', registryFile(id)), json(installItem));
      }
      await cli(['add', path.join(stage, 'registry', registryFile(component)), '--yes'], stage);
      // Components with no npm dependencies do not cause shadcn to install React.
      await ensureDependencies(stage);
      const sourceFiles = await filesIn(path.join(stage, 'src'));
      check(sourceFiles.some(file => /\.[cm]?[jt]sx?$/.test(file)), 'shadcn add produced no JavaScript/TypeScript source.');
      const diagnostics = await inspectSources(stage, sourceFiles);
      const importedFiles = {};
      for (const file of sourceFiles) importedFiles[`src/${file}`] = hash(await fs.readFile(path.join(stage, 'src', file)));
      const packageData = await fs.readFile(path.join(stage, 'package.json'));
      const lockData = await fs.readFile(path.join(stage, 'package-lock.json'));
      const license = await fs.readFile(path.join(here, provider.license));
      const imported = await fs.mkdtemp(path.join(library, '.ready-'));
      try {
        await fs.rename(path.join(stage, 'src'), path.join(imported, 'src'));
        // Some upstream components import siblings through @/ aliases. Keep a
        // config next to each source tree so those aliases resolve after import.
        await fs.copyFile(path.join(stage, 'tsconfig.json'), path.join(imported, 'tsconfig.json'));
        await fs.writeFile(path.join(imported, 'registry.json'), json([...tree.values()]));
        await fs.writeFile(path.join(imported, 'LICENSE.md'), license);
        const registrySources = [];
        for (const [id, item] of tree) {
          const source = registrySource(id);
          const sourceLicense = source.id === providerId ? license : await fs.readFile(path.join(here, source.license));
          const licensePath = source.id === providerId ? 'LICENSE.md' : `dependency-licenses/${source.id.slice(1)}-LICENSE.md`;
          if (source.id !== providerId) {
            await fs.mkdir(path.join(imported, 'dependency-licenses'), { recursive: true });
            await fs.writeFile(path.join(imported, licensePath), sourceLicense);
          }
          registrySources.push({ component: id, provider: source.id, registry: source.registry, registrySha256: hash(json(item)), dependencyOnly: source.id === shadcnDependency.id,
            license: { source: source.licenseSource, path: licensePath, sha256: hash(sourceLicense) } });
        }
        await fs.writeFile(path.join(imported, 'dependencies.lock.json'), lockData);
        const provenance = { generator: MARKER, component, registry: provider.url.replace('{name}', name), importedAt: new Date().toISOString(), shadcnVersion: JSON.parse(await fs.readFile(path.join(hostModules, 'shadcn/package.json'), 'utf8')).version,
          registrySha256: hash(json([...tree.values()])), registrySources, license: { source: provider.licenseSource, sha256: hash(license), capturedAt: '2026-09-16' }, packageLockSha256: hash(lockData), importedFiles,
          note: 'Original sources are editable. Adapt viewport/scroll/RAF triggers to the video timeline and verify repeatable seeking before export.' };
        await fs.writeFile(path.join(imported, 'provenance.json'), json(provenance));
        check((await fs.readFile(packagePath)).equals(originalPackage), 'package.json changed during import; retry without concurrent edits.');
        const currentLock = await exists(lockPath) ? await fs.readFile(lockPath) : null;
        check(originalLock ? currentLock?.equals(originalLock) : currentLock === null, 'package-lock.json changed during import; retry without concurrent edits.');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        check(!await exists(destination), 'Component destination appeared during import; refusing to overwrite.');
        await fs.rename(imported, destination);
        await fs.writeFile(packagePath, packageData);
        await fs.writeFile(lockPath, lockData);
        // Runtime dependencies are reconstructed lazily on build; sources, locks
        // and bundled outputs survive snapshots which omit node_modules.
        return { project: root, component, directory: destination, files: sourceFiles.map(file => posix(path.relative(root, path.join(destination, 'src', file)))), provenance: path.join(destination, 'provenance.json'), packageLock: lockPath,
          diagnostics,
          next: `${diagnostics.issues.length ? 'Source was imported but has unresolved static imports. Resolve the reported packages/assets from the official component instructions, then use diagnose to recheck. ' : ''}Create component-library/entry.tsx using React createRoot, import ./imports/${importName(component)}/src/styles.css, adapt animation time explicitly, then run build --project PATH.` };
      } finally { await fs.rm(imported, { recursive: true, force: true }); }
    } finally { await fs.rm(stage, { recursive: true, force: true }); }
  });
}

async function checkOutput(root, out) {
  const destination = await projectPath(root, out);
  check(!within(path.join(root, LIBRARY), destination) && destination !== root, '--out must be a separate project subdirectory, outside component-library.');
  if (await exists(destination)) {
    const manifestPath = await projectPath(destination, 'build.json', { mustExist: true });
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    check(manifest.generator === MARKER, 'Output is not a verified component bundle; refusing to overwrite.');
    const expected = [...Object.keys(manifest.generatedFiles), 'build.json'].sort();
    check(JSON.stringify(await filesIn(destination)) === JSON.stringify(expected), 'Bundle files were added or removed manually; choose a new --out directory.');
    for (const [file, expectedHash] of Object.entries(manifest.generatedFiles)) {
      check(hash(await fs.readFile(await projectPath(destination, file, { mustExist: true }))) === expectedHash, `Bundle file was edited manually: ${file}; choose a new --out directory.`);
    }
  }
  return destination;
}

export async function buildComponents({ project, entry = `${LIBRARY}/entry.tsx`, out = 'assets/components' }) {
  const { library, project: root } = await initLibrary({ project });
  return withLock(library, async () => {
    const input = await projectPath(root, entry, { mustExist: true });
    check(within(library, input), '--entry must be inside component-library so imports use its saved dependency lock.');
    const destination = await checkOutput(root, out);
    const lockData = await ensureDependencies(library);
    const esbuild = hostRequire('esbuild');
    const cssInputs = new Set();
    const result = await esbuild.build({ absWorkingDir: root, entryPoints: { entry: input }, outdir: destination, bundle: true, write: false, metafile: true, platform: 'browser', format: 'esm', target: ['chrome110'], jsx: 'automatic', minify: true, legalComments: 'eof', logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' }, assetNames: 'media/[name]-[hash]',
      loader: assetLoaders,
      plugins: [{ name: 'project-local-only', setup(build) {
        build.onResolve({ filter: /^(https?:|\/\/)/ }, args => ({ errors: [{ text: `Remote imports must be copied into the video project before bundling: ${args.path}` }] }));
        build.onResolve({ filter: /^yingya-asset-file:/ }, args => ({ path: args.path.slice('yingya-asset-file:'.length), namespace: 'file' }));
        build.onResolve({ filter: assetPattern }, async args => {
          // CSS URLs already resolve relative to entry.css. JavaScript asset
          // strings resolve relative to the HTML document, so wrap only those
          // imports with an ESM URL anchored to the emitted entry.js instead.
          if (args.kind === 'url-token' || args.kind === 'import-rule' || args.pluginData?.yingyaAssetFile) return undefined;
          const resolved = await build.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, namespace: args.namespace, pluginData: { yingyaAssetFile: true } });
          if (resolved.errors.length || resolved.external) return resolved;
          return { path: resolved.path, namespace: 'yingya-asset-url' };
        });
        build.onLoad({ filter: /.*/ }, async args => {
          const resolved = await fs.realpath(args.path);
          if (!within(root, resolved)) return { errors: [{ text: `Import escapes this project (including an ancestor node_modules or symlink): ${args.path}` }] };
          if (args.path.endsWith('.css')) {
            const contents = await fs.readFile(args.path, 'utf8');
            if (/@import\s+["']tailwindcss(?:\/[^"']*)?["']/.test(contents)) {
              const postcss = hostRequire('postcss');
              const tailwind = hostRequire('@tailwindcss/postcss');
              const compiled = await postcss([tailwind({ base: library, optimize: true })]).process(contents, { from: args.path });
              for (const message of compiled.messages) {
                if (message.type === 'dependency' && message.file) {
                  const file = await fs.realpath(message.file);
                  check(within(root, file), `Tailwind dependency escapes this project: ${file}`);
                  cssInputs.add(file);
                }
              }
              return { contents: compiled.css, loader: 'css', resolveDir: path.dirname(args.path) };
            }
          }
          return undefined;
        });
        build.onLoad({ filter: /.*/, namespace: 'yingya-asset-url' }, args => ({ loader: 'js', contents: `import asset from ${JSON.stringify(`yingya-asset-file:${args.path}`)}; export default new URL(asset, import.meta.url).href;` }));
      } }] });
    const generated = new Map();
    for (const file of result.outputFiles) generated.set(posix(path.relative(destination, file.path)), file.contents);
    const inputHashes = {};
    for (const file of Object.keys(result.metafile.inputs)) {
      // Virtual wrappers contain no independent source; the actual copied asset
      // is also an input and its bytes are recorded below.
      if (file.startsWith('yingya-asset-url:')) continue;
      inputHashes[posix(file)] = hash(await fs.readFile(path.resolve(root, file)));
    }
    for (const file of cssInputs) inputHashes[posix(path.relative(root, file))] = hash(await fs.readFile(file));
    for (const output of Object.values(result.metafile.outputs)) check(!output.imports.some(item => item.external && !item.path.startsWith('data:')), 'Bundle contains an external import. All imported assets and modules must be local.');
    const sources = [];
    const imports = await projectPath(library, 'imports');
    if (await exists(imports)) {
      for (const name of await fs.readdir(imports)) {
        const provenance = await projectPath(imports, `${name}/provenance.json`, { mustExist: true });
        sources.push(JSON.parse(await fs.readFile(provenance, 'utf8')));
        generated.set(`licenses/${name}.txt`, await fs.readFile(await projectPath(imports, `${name}/LICENSE.md`, { mustExist: true })));
        const dependencyLicenses = await projectPath(imports, `${name}/dependency-licenses`);
        if (await exists(dependencyLicenses)) for (const file of await filesIn(dependencyLicenses)) {
          generated.set(`licenses/${name}-${file}`, await fs.readFile(await projectPath(dependencyLicenses, file, { mustExist: true })));
        }
      }
    }
    // Include package notices for all locked production dependencies, not only
    // comments the minifier happens to retain in the compiled JavaScript.
    const lock = JSON.parse(lockData);
    for (const [packageDirectory, item] of Object.entries(lock.packages || {})) {
      if (!packageDirectory.startsWith('node_modules/') || item.dev) continue;
      // npm legitimately omits optional packages for other operating systems.
      // Still reject symlinks and missing required packages; used imports have
      // already been resolved by the browser bundler above.
      const optionalPath = await projectPath(library, packageDirectory);
      if (item.optional && !await exists(optionalPath)) continue;
      const directory = await projectPath(library, packageDirectory, { mustExist: true });
      const packageInfo = JSON.parse(await fs.readFile(await projectPath(directory, 'package.json', { mustExist: true }), 'utf8'));
      generated.set(`licenses/npm-${packageDirectory.replaceAll('/', '_')}-metadata.json`, Buffer.from(json({ name: packageInfo.name, version: packageInfo.version, license: packageInfo.license, author: packageInfo.author, repository: packageInfo.repository })));
      for (const name of await fs.readdir(directory)) {
        if (!/^(licen[sc]e|copying|notice)(\..*)?$/i.test(name)) continue;
        const file = await projectPath(directory, name, { mustExist: true });
        if ((await fs.stat(file)).isFile()) generated.set(`licenses/npm-${packageDirectory.replaceAll('/', '_')}-${name}.txt`, await fs.readFile(file));
      }
    }
    const generatedFiles = Object.fromEntries([...generated].map(([file, contents]) => [file, hash(contents)]));
    const manifest = { generator: MARKER, entry, output: out, esbuildVersion: esbuild.version, packageLockSha256: hash(lockData), dependencies: lock.packages, sources, inputs: inputHashes, generatedFiles };
    generated.set('build.json', Buffer.from(json(manifest)));
    // Validate before and after compiling: no hand-edited output is discarded.
    await checkOutput(root, out);
    const previous = await exists(destination) ? await filesIn(destination) : [];
    for (const [file, content] of generated) {
      const target = await projectPath(root, `${out}/${file}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content);
    }
    for (const file of previous) if (!generated.has(file)) await fs.rm(await projectPath(destination, file, { mustExist: true }));
    return { project: root, entry, script: posix(path.join(out, 'entry.js')), styles: generated.has('entry.css') ? posix(path.join(out, 'entry.css')) : null, manifest: posix(path.join(out, 'build.json')), files: [...generated.keys()],
      note: 'Load the script as type="module" and the stylesheet in index.html. This bundle contains runtime dependencies; node_modules is not required for playback. Timeline adaptation and seek/render checks are still required.' };
  });
}

export async function listPacks({ query = '' } = {}) {
  const catalog = JSON.parse(await fs.readFile(path.join(here, 'components/catalog.json'), 'utf8'));
  if (query) catalog.components = catalog.components.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  return catalog;
}

export async function viewPack(component) {
  const catalog = await listPacks();
  const item = catalog.components.find(item => item.id === component);
  check(item, `Unknown local component: ${component}. Use catalog to choose a supported id.`);
  if (item.pack === 'animejs') {
    const anime = await animeCatalog();
    return { ...item, commonSchema: anime.commonSchema, details: anime.components.find(entry => entry.id === component) };
  }
  return { ...item, documentation: await fs.readFile(path.join(here, 'components', item.guide), 'utf8') };
}

export async function installPack({ project, component }) {
  const item = (await listPacks()).components.find(item => item.id === component);
  check(item, `Unknown local component: ${component}. Use catalog first; use add for an upstream @provider/item.`);
  if (item.pack === 'animejs') return { component, ...await installAnime(project) };
  const root = await rootPath(project);
  const out = 'assets/yingya-components';
  const payload = new Map();
  for (const file of ['clock.js', 'catalog.json', 'README.md']) payload.set(file, await fs.readFile(path.join(here, 'components', file)));
  const packRoot = path.join(here, 'components', item.pack);
  for (const file of await filesIn(packRoot)) payload.set(`${item.pack}/${file}`, await fs.readFile(path.join(packRoot, file)));
  const manifest = { generator: MARKER, component, version: '1.0.0', files: Object.fromEntries([...payload].map(([file, bytes]) => [file, hash(bytes)])) };
  payload.set(`install-${item.pack}.json`, Buffer.from(json(manifest)));
  // Check the entire payload before writing anything. Subsequent installs share
  // the identical clock, and refuse to mix an edited or different pack version.
  const pending = [];
  for (const [file, bytes] of payload) {
    const target = await projectPath(root, `${out}/${file}`);
    if (await exists(target)) check((await fs.stat(target)).isFile() && hash(await fs.readFile(target)) === hash(bytes), `Installed component file differs: ${out}/${file}; preserving existing edits.`);
    else pending.push([target, bytes]);
  }
  for (const [target, bytes] of pending) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    try { await fs.writeFile(target, bytes, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST' || hash(await fs.readFile(target)) !== hash(bytes)) throw error; }
  }
  return { component, project: root, directory: out, clock: `${out}/clock.js`, script: `${out}/${item.script}`, module: item.module || false, styles: item.stylesheet ? `${out}/${item.stylesheet}` : null, guide: `${out}/${item.guide}`, manifest: `${out}/install-${item.pack}.json`, note: 'Read the installed guide. createScene registers the component with the shared video clock; raw source imports still need adaptation.' };
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...flags] = argv;
  if (!command || command === '--help' || command === 'help' || flags.includes('--help')) {
    console.log('Usage: node "$YINGYA_COMPONENT_LIBRARY" catalog|view|install|init|search|add|diagnose|build\ncatalog/list: [--query TEXT] [--json] (offline, no project needed)\nview: --component local-id (offline), or --component @provider/item --project PATH\ninstall: --component local-id --project PATH (offline, preserves edits)\nsearch: --project PATH --registry all|@react-bits|@magicui --query TEXT --limit 20 --offset 0\nadd: --project PATH --component @react-bits/Name-TS-CSS|@magicui/name (includes static import diagnostics)\ndiagnose: --project PATH --component @provider/item (recheck existing source; restores locked dependencies if needed)\nbuild: --project PATH --entry component-library/entry.tsx --out assets/components\nPublic source registries require timeline adaptation. Tailwind v4 imports are compiled at build time. Imported playback dependencies are bundled; runtime URLs and rendered output still require verification.');
    return;
  }
  const options = {};
  const allowed = { catalog: ['query'], list: ['query'], install: ['component'], init: [], search: ['query', 'limit', 'offset', 'registry'], view: ['component'], add: ['component'], diagnose: ['component'], build: ['entry', 'out'] };
  check(Object.hasOwn(allowed, command), `Unknown command: ${command}`);
  for (let i = 0; i < flags.length; i += 2) {
    if (flags[i] === '--json') { i -= 1; continue; }
    const key = flags[i].replace(/^--/, '');
    check(flags[i].startsWith('--') && ['project', ...allowed[command]].includes(key) && flags[i + 1] !== undefined && !Object.hasOwn(options, key), `Invalid or duplicate option: ${flags[i]}`);
    options[key] = flags[i + 1];
  }
  if (!['catalog', 'list'].includes(command) && !(command === 'view' && !options.component?.startsWith('@'))) check(options.project, '--project PATH is required.');
  const operation = { catalog: listPacks, list: listPacks, install: installPack, init: initLibrary, search: searchComponents, view: viewComponent, add: addComponent, diagnose: diagnoseComponent, build: buildComponents }[command];
  console.log(json(await operation(options)).trimEnd());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(json({ error: error.message }).trimEnd()); process.exitCode = 1; });
}
