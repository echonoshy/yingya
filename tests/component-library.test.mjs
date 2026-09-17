import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { addComponent, buildComponents, componentName, diagnoseComponent, initLibrary, main, projectPath, registryDependency, searchComponents, validateRegistry } from '../runtime/component-library.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
async function tempProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yingya-component-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function buildFixture(t) {
  const root = await tempProject(t);
  const { library } = await initLibrary({ project: root });
  const packageJson = JSON.parse(await fs.readFile(path.join(library, 'package.json'), 'utf8'));
  const lock = { name: packageJson.name, version: '1.0.0', lockfileVersion: 3, packages: { '': packageJson } };
  // Copy only these real browser packages. Tests stay offline while exercising
  // React, CSS, assets and the actual installed esbuild (not a mocked bundler).
  for (const name of ['react', 'react-dom', 'scheduler']) {
    await fs.cp(path.join(repository, 'node_modules', name), path.join(library, 'node_modules', name), { recursive: true });
    const manifest = JSON.parse(await fs.readFile(path.join(library, 'node_modules', name, 'package.json'), 'utf8'));
    lock.packages[`node_modules/${name}`] = { version: manifest.version, license: manifest.license };
  }
  const lockData = JSON.stringify(lock);
  await fs.writeFile(path.join(library, 'package-lock.json'), lockData);
  await fs.writeFile(path.join(library, 'node_modules/.yingya-lock-sha256'), digest(lockData));
  await fs.writeFile(path.join(library, 'entry.tsx'), 'import {createRoot} from "react-dom/client"; import logo from "./logo.svg"; import "./style.css"; createRoot(document.getElementById("root")!).render(<img className="fixture" alt="component fixture" src={logo}/>);');
  await fs.writeFile(path.join(library, 'style.css'), '.fixture { background-image:url("./logo.svg"); color:rebeccapurple; }');
  await fs.writeFile(path.join(library, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>');
  return { root, library };
}

test('explicit project paths reject traversal, absolute paths and symlink escapes', async t => {
  const root = await tempProject(t);
  await fs.symlink(os.tmpdir(), path.join(root, 'escape'));
  await assert.rejects(projectPath(root, '../outside'), /relative without traversal/);
  await assert.rejects(projectPath(root, '/tmp/outside'), /relative without traversal/);
  await assert.rejects(projectPath(root, 'escape/output'), /Symlinks/);
  await assert.rejects(main(['build']), /--project PATH is required/);
  await assert.rejects(main(['init', '--project', root, '--global', 'true']), /Invalid or duplicate/);
  await fs.symlink(os.tmpdir(), path.join(root, 'component-library'));
  await assert.rejects(initLibrary({ project: root }), /Symlinks/);
});

test('initialization preserves project files and refuses to adopt unrelated directories', async t => {
  const root = await tempProject(t);
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"existing-video"}');
  await fs.writeFile(path.join(root, 'components.json'), '{"existing":true}');
  await fs.writeFile(path.join(root, 'index.html'), '<p>Existing video</p>');
  const first = await initLibrary({ project: root });
  await initLibrary({ project: root });
  assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), '{"name":"existing-video"}');
  assert.equal(await fs.readFile(path.join(root, 'components.json'), 'utf8'), '{"existing":true}');
  assert.equal(await fs.readFile(path.join(root, 'index.html'), 'utf8'), '<p>Existing video</p>');
  const registry = JSON.parse(await fs.readFile(path.join(first.library, 'components.json'), 'utf8'));
  assert.equal(registry.registries['@react-bits'], 'https://reactbits.dev/r/{name}.json');
  await assert.rejects(fs.stat(path.join(first.library, 'node_modules')), /ENOENT/);
  const unrelated = await tempProject(t);
  await fs.mkdir(path.join(unrelated, 'component-library'));
  await fs.writeFile(path.join(unrelated, 'component-library/manual.tsx'), '// keep');
  await assert.rejects(initLibrary({ project: unrelated }));
  assert.equal(await fs.readFile(path.join(unrelated, 'component-library/manual.tsx'), 'utf8'), '// keep');
});

test('registry destinations, command flags and dependency protocols cannot escape staging', () => {
  const source = { name: 'Effect-TS-CSS', dependencies: ['gsap@^3.0.0', '@react-three/fiber@9.0.0'], files: [{ type: 'registry:component', path: 'Effect.tsx', content: 'export default ()=>null' }, { type: 'registry:file', path: 'Effect.css', target: '@components/Effect.css', content: '.effect{}' }] };
  validateRegistry(source);
  assert.equal(componentName('@react-bits/NotPreviouslyBundled-TS-CSS'), 'NotPreviouslyBundled-TS-CSS');
  for (const name of ['--global', '../outside', '@react-bits/../../outside', 'https://evil.test/item.json']) assert.throws(() => componentName(name), /explicit @react-bits/);
  for (const target of ['/tmp/escape', '../escape', '@components/../../escape', '~/.npmrc', 'node_modules/postinstall.js']) assert.throws(() => validateRegistry({ ...source, files: [{ ...source.files[1], target }] }), /Unsafe|outside src/);
  for (const dependency of ['file:../../outside', 'git+https://evil.test/pkg', '--global', '-g', 'foo@https://evil.test/pkg']) assert.throws(() => validateRegistry({ ...source, dependencies: [dependency] }), /Only npm registry/);
  assert.throws(() => validateRegistry({ ...source, registryDependencies: ['https://evil.test/item.json'] }), /explicit @react-bits/);
});

test('registry CSS accepts keyframes/theme variables without accepting environment or malformed changes', () => {
  const source = { name: 'marquee', files: [{ type: 'registry:ui', path: 'marquee.tsx', content: 'export const Marquee = () => null;' }],
    cssVars: { theme: { 'animate-marquee': 'marquee var(--duration) linear infinite' } },
    css: { '@keyframes marquee': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(calc(-100% - var(--gap)))' } } } };
  validateRegistry(source, '@magicui');
  for (const css of [null, [], 'body{}', { body: null }, { body: { color: [] } }, JSON.parse('{"__proto__":{"polluted":"yes"}}')]) {
    assert.throws(() => validateRegistry({ ...source, css }, '@magicui'), /CSS object|CSS key|CSS string/);
  }
  for (const cssVars of [{ other: {} }, { theme: 'invalid' }, { theme: { color: { nested: 'invalid' } } }]) {
    assert.throws(() => validateRegistry({ ...source, cssVars }, '@magicui'), /cssVars|CSS object/);
  }
  assert.throws(() => validateRegistry({ ...source, envVars: {} }, '@magicui'), /environment changes/);
  assert.throws(() => validateRegistry({ ...source, envVars: { API_KEY: 'value' } }, '@magicui'), /environment changes/);
});

test('bare Magic dependencies resolve only to the official dependency-only shadcn registry', () => {
  const button = 'https://ui.shadcn.com/r/styles/new-york-v4/button.json';
  assert.equal(registryDependency('button', '@magicui'), button);
  assert.equal(registryDependency(button, '@magicui'), button);
  assert.equal(registryDependency('button', '@shadcn-dependency'), button);
  assert.equal(registryDependency('https://magicui.design/r/animated-beam.json', '@magicui'), '@magicui/animated-beam');
  assert.equal(registryDependency('@magicui/animated-beam', '@magicui'), '@magicui/animated-beam');
  for (const dependency of ['https://ui.shadcn.com.evil.test/r/styles/new-york-v4/button.json', 'https://ui.shadcn.com/r/styles/other/button.json', 'https://ui.shadcn.com/r/styles/new-york-v4/../../button.json', '../button']) {
    assert.throws(() => registryDependency(dependency, '@magicui'), /explicit @react-bits/);
  }
  assert.throws(() => componentName(button), /explicit @react-bits/);
  assert.throws(() => componentName('@shadcn-dependency/button'), /explicit @react-bits/);
});

test('add refuses an existing import before network activity and preserves edits', async t => {
  const root = await tempProject(t);
  const { library } = await initLibrary({ project: root });
  const component = path.join(library, 'imports/Aurora-TS-CSS');
  await fs.mkdir(component, { recursive: true });
  await fs.writeFile(path.join(component, 'manual.tsx'), '// changed by author');
  await assert.rejects(addComponent({ project: root, component: '@react-bits/Aurora-TS-CSS' }), /never overwrites/);
  assert.equal(await fs.readFile(path.join(component, 'manual.tsx'), 'utf8'), '// changed by author');
  await assert.rejects(fs.stat(path.join(library, '.operation.lock')), /ENOENT/);
});

test('real React/CSS/assets bundle is self-contained and remains usable after node_modules is omitted', async t => {
  const { root, library } = await buildFixture(t);
  const result = await buildComponents({ project: root });
  assert.equal(result.script, 'assets/components/entry.js');
  assert.equal(result.styles, 'assets/components/entry.css');
  const js = await fs.readFile(path.join(root, result.script), 'utf8');
  assert.match(js, /component fixture/);
  assert.doesNotMatch(js, /from\s*["'](?:react|react-dom)/);
  assert.match(js, /media\/logo-[A-Z0-9]+\.svg/);
  const css = await fs.readFile(path.join(root, result.styles), 'utf8');
  assert.match(css, /media\/logo-[A-Z0-9]+\.svg/);
  const manifest = JSON.parse(await fs.readFile(path.join(root, result.manifest), 'utf8'));
  assert.ok(Object.keys(manifest.inputs).some(file => file.includes('node_modules/react-dom/')));
  assert.ok(result.files.some(file => file.includes('licenses/npm-node_modules_react-LICENSE')));
  assert.equal(manifest.packageLockSha256, digest(await fs.readFile(path.join(library, 'package-lock.json'))));
  const second = await buildComponents({ project: root });
  assert.deepEqual(second, result);
  assert.equal(await fs.readFile(path.join(root, result.script), 'utf8'), js);
  // A normal version snapshot excludes node_modules. Every playback dependency
  // is already in the saved artifact; deleting it must not change any output.
  await fs.rm(path.join(library, 'node_modules'), { recursive: true });
  for (const [file, expected] of Object.entries(manifest.generatedFiles)) assert.equal(digest(await fs.readFile(path.join(root, 'assets/components', file))), expected);
  // Serve HTML above the bundle directory under an arbitrary URL prefix. A raw
  // file-loader string like ./media/logo.svg would incorrectly request a file
  // next to index.html. Verify JS imports and CSS URLs both load after snapshot.
  await fs.writeFile(path.join(root, 'index.html'), `<html><head><link rel="stylesheet" href="${result.styles}"></head><body><div id="root"></div><script type="module" src="${result.script}"></script></body></html>`);
  const requests = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const relative = url.pathname.replace(/^\/preview\/film\//, '');
    try {
      const contents = await fs.readFile(await projectPath(root, relative, { mustExist: true }));
      requests.push({ path: url.pathname, status: 200 });
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[path.extname(relative)] || 'application/octet-stream' });
      response.end(contents);
    } catch {
      requests.push({ path: url.pathname, status: 404 });
      response.writeHead(404); response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, ...(process.env.HYPERFRAMES_BROWSER_PATH ? { executablePath: process.env.HYPERFRAMES_BROWSER_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/preview/film/index.html`);
  await page.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0, null, { timeout: 5000 });
  const image = await page.locator('img').evaluate(element => ({ src: element.src, background: getComputedStyle(element).backgroundImage }));
  assert.match(image.src, /\/preview\/film\/assets\/components\/media\/logo-[A-Z0-9]+\.svg$/);
  assert.ok(image.background.includes(image.src));
  assert.ok(requests.some(request => request.path.endsWith('.svg') && request.status === 200));
  assert.deepEqual(requests.filter(request => request.path.endsWith('.svg') && request.status !== 200), []);
  assert.deepEqual(errors, []);
});

test('build rejects handwritten outputs and imports that escape through a symlink', async t => {
  const { root, library } = await buildFixture(t);
  await fs.mkdir(path.join(root, 'manual-output'));
  await fs.writeFile(path.join(root, 'manual-output/entry.js'), '// hand-authored');
  await assert.rejects(buildComponents({ project: root, out: 'manual-output' }));
  assert.equal(await fs.readFile(path.join(root, 'manual-output/entry.js'), 'utf8'), '// hand-authored');
  await assert.rejects(buildComponents({ project: root, out: 'component-library/generated' }), /outside component-library/);
  await assert.rejects(buildComponents({ project: root, out: '../outside' }), /relative without traversal/);
  const result = await buildComponents({ project: root });
  await fs.appendFile(path.join(root, result.script), '\n// edited by user');
  await assert.rejects(buildComponents({ project: root }), /edited manually/);
  const outside = await tempProject(t);
  await fs.writeFile(path.join(outside, 'secret.js'), 'export default "outside";');
  await fs.symlink(path.join(outside, 'secret.js'), path.join(library, 'escape.js'));
  await fs.writeFile(path.join(library, 'entry.tsx'), 'import value from "./escape.js"; console.log(value);');
  await assert.rejects(buildComponents({ project: root, out: 'assets/safe' }), /Import escapes this project/);
  await assert.rejects(fs.stat(path.join(root, 'assets/safe')), /ENOENT/);
  await fs.writeFile(path.join(library, 'entry.tsx'), 'import value from "https://example.com/remote.js"; console.log(value);');
  await assert.rejects(buildComponents({ project: root, out: 'assets/safe' }), /Remote imports must be copied/);
});

test('optional dependency lock normalization and absent platform packages do not block a bundle', async t => {
  const { root, library } = await buildFixture(t);
  const packagePath = path.join(library, 'package.json');
  const lockPath = path.join(library, 'package-lock.json');
  const manifest = JSON.parse(await fs.readFile(packagePath));
  const lock = JSON.parse(await fs.readFile(lockPath));
  manifest.optionalDependencies = { fsevents: '^2.3.3' };
  lock.packages[''] = { ...manifest, dependencies: { ...manifest.dependencies, fsevents: '2.3.3' } };
  lock.packages['node_modules/fsevents'] = { version: '2.3.3', optional: true, os: ['darwin'] };
  await fs.writeFile(packagePath, JSON.stringify(manifest));
  const saveLock = async () => {
    const data = JSON.stringify(lock);
    await fs.writeFile(lockPath, data);
    await fs.writeFile(path.join(library, 'node_modules/.yingya-lock-sha256'), digest(data));
  };
  await saveLock();
  const result = await buildComponents({ project: root });
  assert.ok(!result.files.some(file => file.includes('fsevents')));
  assert.ok(result.files.some(file => file.includes('react-LICENSE')));
  // Optional does not permit a source import that cannot actually resolve.
  await fs.writeFile(path.join(library, 'entry.tsx'), 'import watcher from "fsevents"; console.log(watcher);');
  await assert.rejects(buildComponents({ project: root }), /Could not resolve "fsevents"/);
  await fs.writeFile(path.join(library, 'entry.tsx'), 'console.log("no watcher");');
  // A missing required package remains an error, even if unused by this entry.
  lock.packages['node_modules/fsevents'].optional = false;
  await saveLock();
  await assert.rejects(buildComponents({ project: root }), /ENOENT/);
  lock.packages['node_modules/fsevents'].optional = true;
  lock.packages[''].optionalDependencies = { fsevents: '^1.0.0' };
  await saveLock();
  await assert.rejects(buildComponents({ project: root }), /package.json and package-lock.json disagree/);
});

test('diagnose reports missing source imports and assets, and rechecks repaired sources without execution', async t => {
  const { root, library } = await buildFixture(t);
  const directory = path.join(library, 'imports/Probe-TS-CSS');
  await fs.mkdir(path.join(directory, 'src/components'), { recursive: true });
  await fs.mkdir(path.join(directory, 'src/lib'));
  await fs.copyFile(path.join(library, 'tsconfig.json'), path.join(directory, 'tsconfig.json'));
  const source = path.join(directory, 'src/components/Probe.tsx');
  await fs.writeFile(path.join(directory, 'src/lib/value.ts'), 'export default 42;');
  await fs.writeFile(source, 'import value from "@/lib/value"; import missing from "yingya-missing-test-package"; import model from "./card.glb"; import remote from "https://example.test/effect.js"; throw new Error("must not execute"); export default () => <div>{value}{missing}{model}{remote}</div>;');
  const first = await diagnoseComponent({ project: root, component: '@react-bits/Probe-TS-CSS' });
  assert.equal(first.diagnostics.status, 'needs-repair');
  assert.deepEqual(new Set(first.diagnostics.issues.map(issue => issue.specifier)), new Set(['yingya-missing-test-package', './card.glb', 'https://example.test/effect.js']));
  for (const issue of first.diagnostics.issues) assert.equal(issue.file, 'src/components/Probe.tsx');
  await fs.writeFile(path.join(directory, 'src/components/card.glb'), 'fixture bytes');
  await fs.writeFile(source, 'import value from "@/lib/value"; import model from "./card.glb"; throw new Error("must not execute"); export default () => <div>{value}{model}</div>;');
  const second = await diagnoseComponent({ project: root, component: '@react-bits/Probe-TS-CSS' });
  assert.equal(second.diagnostics.status, 'imports-resolved');
  assert.deepEqual(second.diagnostics.issues, []);
  await fs.writeFile(source, 'export default ( =>');
  assert.equal((await diagnoseComponent({ project: root, component: '@react-bits/Probe-TS-CSS' })).diagnostics.status, 'needs-repair');
  assert.deepEqual(await fs.readdir(path.join(root, 'assets')).catch(() => []), []);
});

test('live registry search/import builds locked sources and reconstructs omitted dependencies', { skip: !process.env.YINGYA_COMPONENT_LIVE_TESTS, timeout: 180000 }, async t => {
  const root = await tempProject(t);
  const results = await searchComponents({ project: root, query: 'Aurora', limit: 10 });
  assert.ok(results.items.some(item => item.name === 'Aurora-TS-CSS'));
  const imported = await addComponent({ project: root, component: '@react-bits/Aurora-TS-CSS' });
  assert.equal(imported.diagnostics.status, 'imports-resolved');
  const provenance = JSON.parse(await fs.readFile(imported.provenance, 'utf8'));
  assert.equal(provenance.component, '@react-bits/Aurora-TS-CSS');
  const registry = await fs.readFile(path.join(imported.directory, 'registry.json'));
  assert.equal(digest(registry), provenance.registrySha256);
  for (const [file, expected] of Object.entries(provenance.importedFiles)) assert.equal(digest(await fs.readFile(path.join(imported.directory, file))), expected);
  await fs.writeFile(path.join(root, 'component-library/entry.tsx'), 'import {createRoot} from "react-dom/client"; import Aurora from "./imports/Aurora-TS-CSS/src/components/Aurora"; createRoot(document.getElementById("root")!).render(<Aurora/>);');
  const built = await buildComponents({ project: root });
  const first = await fs.readFile(path.join(root, built.script));
  await fs.rm(path.join(root, 'component-library/node_modules'), { recursive: true });
  await buildComponents({ project: root });
  assert.deepEqual(await fs.readFile(path.join(root, built.script)), first);
});

test('live incomplete registry item preserves source and reports actionable missing dependencies and assets', { skip: !process.env.YINGYA_COMPONENT_LIVE_TESTS, timeout: 180000 }, async t => {
  const root = await tempProject(t);
  const imported = await addComponent({ project: root, component: '@react-bits/Lanyard-TS-CSS' });
  assert.equal(imported.diagnostics.status, 'needs-repair');
  const missing = imported.diagnostics.issues.map(issue => issue.specifier);
  assert.ok(missing.includes('@react-three/fiber'));
  assert.ok(missing.includes('./card.glb'));
  assert.ok(missing.includes('./lanyard.png'));
  assert.ok(await fs.stat(imported.provenance));
  assert.ok(imported.files.some(file => file.endsWith('Lanyard.tsx')));
});

test('live Magic CSS and default shadcn dependencies build with working browser styles', { skip: !process.env.YINGYA_COMPONENT_LIVE_TESTS, timeout: 240000 }, async t => {
  // An explicit fresh directory retains the real sources, bundle and screenshot
  // for release review; ordinary test runs clean their temporary fixtures.
  const root = process.env.YINGYA_MAGIC_FIXTURE_DIR
    ? await fs.realpath(process.env.YINGYA_MAGIC_FIXTURE_DIR) : await tempProject(t);
  const marquee = await addComponent({ project: root, component: '@magicui/marquee' });
  const marqueeSource = path.join(marquee.directory, 'src/components/marquee.tsx');
  await fs.appendFile(marqueeSource, '\n// Retain the video author\'s adaptation.\n');
  const edited = await fs.readFile(marqueeSource);
  const priorLock = JSON.parse(await fs.readFile(marquee.packageLock, 'utf8'));
  const bento = await addComponent({ project: root, component: '@magicui/bento-grid' });
  assert.deepEqual(await fs.readFile(marqueeSource), edited);
  const nextLock = JSON.parse(await fs.readFile(bento.packageLock, 'utf8'));
  for (const name of ['react', 'react-dom', 'tailwindcss']) {
    assert.equal(nextLock.packages[`node_modules/${name}`].version, priorLock.packages[`node_modules/${name}`].version);
  }
  assert.ok(nextLock.packages['node_modules/class-variance-authority']);
  const provenance = JSON.parse(await fs.readFile(bento.provenance, 'utf8'));
  const button = provenance.registrySources.find(source => source.registry === 'https://ui.shadcn.com/r/styles/new-york-v4/button.json');
  assert.equal(button?.dependencyOnly, true);
  assert.equal(button.provider, '@shadcn-dependency');
  assert.equal(digest(await fs.readFile(path.join(bento.directory, button.license.path))), button.license.sha256);
  assert.match(await fs.readFile(path.join(bento.directory, button.license.path), 'utf8'), /Copyright.*shadcn/);
  const library = path.join(root, 'component-library');
  await fs.writeFile(path.join(library, 'entry.tsx'), `
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {Marquee} from './imports/magicui-marquee/src/components/marquee';
import {BentoGrid, BentoCard} from './imports/magicui-bento-grid/src/components/bento-grid';
import {Button} from './imports/magicui-bento-grid/src/components/button';
import './imports/magicui-marquee/src/styles.css';
import './imports/magicui-bento-grid/src/styles.css';
const Icon = (props) => <svg {...props} viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16v16H4z"/></svg>;
flushSync(() => createRoot(document.getElementById('root')!).render(<main>
  <h1>Magic UI · imported source verification</h1>
  <Marquee id="marquee" repeat={2}>{['Registry CSS', 'Keyframes', 'Locked dependencies'].map(text => <span key={text} className="rounded-lg bg-neutral-100 p-4">{text}</span>)}</Marquee>
  <BentoGrid id="bento">{['Original component', 'Default registry dependency', 'Offline bundle'].map(name => <BentoCard key={name} className="col-span-1" name={name} Icon={Icon} background={<div className="h-20 bg-neutral-100"/>} description="Magic UI plus the original shadcn Button." href="#" cta="View source"/>)}</BentoGrid>
  <Button id="button">shadcn dependency</Button>
</main>));
`);
  const built = await buildComponents({ project: root });
  assert.match(await fs.readFile(path.join(root, built.styles), 'utf8'), /@keyframes marquee/);
  assert.ok(built.files.some(file => file.includes('shadcn-dependency-LICENSE.md')));
  await fs.writeFile(path.join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${built.styles}"><style>body{font-family:Arial,sans-serif;margin:40px;color:#171717;background:white}main{max-width:1120px;margin:auto}h1{font-size:28px;margin-bottom:24px}#bento{margin:32px 0}</style></head><body><div id="root"></div><script type="module" src="${built.script}"></script></body></html>`);
  // Snapshot playback must no longer need npm or network requests.
  await fs.rm(path.join(library, 'node_modules'), { recursive: true });
  const server = createServer(async (request, response) => {
    try {
      const relative = new URL(request.url, 'http://localhost').pathname.slice(1);
      const contents = await fs.readFile(await projectPath(root, relative, { mustExist: true }));
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(relative)] || 'application/octet-stream' });
      response.end(contents);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, ...(process.env.HYPERFRAMES_BROWSER_PATH ? { executablePath: process.env.HYPERFRAMES_BROWSER_PATH } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForSelector('#button');
  const styles = await page.evaluate(() => {
    const marquee = getComputedStyle(document.querySelector('#marquee'));
    const track = getComputedStyle(document.querySelector('#marquee > div'));
    const grid = getComputedStyle(document.querySelector('#bento'));
    const button = getComputedStyle(document.querySelector('#button'));
    return { marquee: marquee.display, gap: marquee.gap, animation: track.animationName, grid: grid.display, columns: grid.gridTemplateColumns.split(' ').length, button: button.display, height: button.height };
  });
  assert.deepEqual(styles, { marquee: 'flex', gap: '16px', animation: 'marquee', grid: 'grid', columns: 3, button: 'inline-flex', height: '36px' });
  const colors = () => page.locator('#button').evaluate(element => {
    const styles = getComputedStyle(element);
    return { background: styles.backgroundColor, text: styles.color };
  });
  assert.deepEqual(await colors(), { background: 'rgb(23, 23, 23)', text: 'rgb(250, 250, 250)' });
  await page.locator('#button').hover();
  await page.locator('#button').evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  const hovered = await colors();
  assert.notEqual(hovered.background, 'rgb(23, 23, 23)');
  assert.notEqual(hovered.background, 'rgba(0, 0, 0, 0)');
  assert.equal(hovered.text, 'rgb(250, 250, 250)');
  await page.mouse.move(0, 0);
  await page.locator('#button').evaluate(element => {
    element.style.setProperty('--primary', '#123456');
    element.getAnimations().forEach(animation => animation.finish());
  });
  assert.equal((await colors()).background, 'rgb(18, 52, 86)');
  await page.locator('#button').evaluate(element => {
    element.style.removeProperty('--primary');
    element.getAnimations().forEach(animation => animation.finish());
  });
  const transformAt = milliseconds => page.evaluate(time => {
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
    return getComputedStyle(document.querySelector('#marquee > div')).transform;
  }, milliseconds);
  const first = await transformAt(0);
  assert.notEqual(await transformAt(2000), first);
  assert.equal(await transformAt(0), first);
  assert.deepEqual(errors, []);
  if (process.env.YINGYA_MAGIC_FIXTURE_DIR) await page.screenshot({ path: path.join(root, 'verification.png'), fullPage: true });
});
