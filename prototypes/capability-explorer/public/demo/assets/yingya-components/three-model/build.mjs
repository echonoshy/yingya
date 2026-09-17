#!/usr/bin/env node
// Rebuild with the repository's pinned three/esbuild versions. No network fetches.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { BoxGeometry } from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const three = JSON.parse(await fs.readFile(path.join(root, 'node_modules/three/package.json')));
if (three.version !== '0.186.0') throw new Error('Expected pinned three@0.186.0; update provenance and validation when upgrading');
const result = await build({ entryPoints: [path.join(here, 'source.mjs')], outfile: path.join(here, 'model-scene.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'inline', metafile: true });
if (Object.values(result.metafile.outputs).some(output => output.imports.some(item => item.external))) throw new Error('Model scene must not have external runtime dependencies');
await fs.copyFile(path.join(root, 'node_modules/three/LICENSE'), path.join(here, 'LICENSE.three.txt'));

// An original geometric fixture, not a downloaded product or branded asset.
// Build glTF directly so fixture generation does not need a DOM/FileReader shim.
export function sampleModel({ externalBuffer = false } = {}) {
  const geometry = new BoxGeometry(1, 1, 1);
  const chunks = [], bufferViews = [], accessors = [];
  let offset = 0;
  function attribute(values, type, componentType, min, max) {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.byteLength });
    const aligned = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
    bytes.copy(aligned); chunks.push(aligned); offset += aligned.length;
    const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3 };
    accessors.push({ bufferView: bufferViews.length - 1, componentType, count: values.length / sizes[type], type, ...(min ? { min, max } : {}) });
    return accessors.length - 1;
  }
  const position = attribute(geometry.attributes.position.array, 'VEC3', 5126, [-.5, -.5, -.5], [.5, .5, .5]);
  const normal = attribute(geometry.attributes.normal.array, 'VEC3', 5126);
  const uv = attribute(geometry.attributes.uv.array, 'VEC2', 5126);
  const indices = attribute(geometry.index.array, 'SCALAR', 5123);
  const times = attribute(new Float32Array([0, 1, 2]), 'SCALAR', 5126, [0], [2]);
  const translations = attribute(new Float32Array([.55, .55, .15, .9, .55, .15, .55, .55, .15]), 'VEC3', 5126);
  const binary = Buffer.concat(chunks);
  const document = {
    asset: { version: '2.0', generator: 'Yingya original geometric model fixture', copyright: 'Copyright (c) 2026 Yingya contributors. MIT.' },
    scene: 0, scenes: [{ nodes: [0, 1, 2] }],
    nodes: [{ name: 'Body', mesh: 0, scale: [.8, 1.5, .7] }, { name: 'Side', mesh: 1, translation: [.55, .55, .15], scale: [.5, .28, .9] }, { name: 'Foot', mesh: 2, translation: [0, -.85, 0], scale: [1.1, .2, .95] }],
    meshes: [0, 1, 2].map(material => ({ primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, indices, material }] })),
    materials: [
      { name: 'Blue ceramic', pbrMetallicRoughness: { baseColorFactor: [.10, .32, .63, 1], metallicFactor: .15, roughnessFactor: .4 } },
      { name: 'Warm detail', pbrMetallicRoughness: { baseColorFactor: [.91, .39, .10, 1], metallicFactor: .1, roughnessFactor: .35 } },
      { name: 'Neutral base', pbrMetallicRoughness: { baseColorFactor: [.6, .63, .69, 1], metallicFactor: .2, roughnessFactor: .5 } },
    ],
    buffers: [{ byteLength: binary.length, ...(externalBuffer ? { uri: 'sample-model.bin' } : {}) }], bufferViews, accessors,
    animations: [{ name: 'detail-slide', channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }], samplers: [{ input: times, output: translations, interpolation: 'LINEAR' }] }],
  };
  geometry.dispose();
  const rawJson = Buffer.from(JSON.stringify(document));
  const paddedJson = Buffer.alloc(Math.ceil(rawJson.length / 4) * 4, ' '); rawJson.copy(paddedJson);
  const glb = Buffer.alloc(12 + 8 + paddedJson.length + 8 + binary.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(paddedJson.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); paddedJson.copy(glb, 20);
  const binaryStart = 20 + paddedJson.length;
  glb.writeUInt32LE(binary.length, binaryStart); glb.writeUInt32LE(0x004e4942, binaryStart + 4); binary.copy(glb, binaryStart + 8);
  return { glb, document, binary };
}

const sample = sampleModel();
await fs.writeFile(path.join(here, 'sample-model.glb'), sample.glb);
const files = {};
for (const name of ['source.mjs', 'model-scene.js', 'LICENSE.three.txt', 'sample-model.glb']) files[name] = sha256(await fs.readFile(path.join(here, name)));
await fs.writeFile(path.join(here, 'PROVENANCE.json'), `${JSON.stringify({
  component: 'model-stage', version: '1.0.0', dependency: { name: 'three', version: three.version, license: 'MIT', source: 'https://github.com/mrdoob/three.js/tree/r186', npm: 'https://registry.npmjs.org/three/-/three-0.186.0.tgz' },
  sources: ['https://threejs.org/docs/pages/GLTFLoader.html', 'https://threejs.org/docs/pages/AnimationMixer.html', 'https://threejs.org/docs/pages/WebGLRenderer.html'],
  model: { file: 'sample-model.glb', origin: 'Original geometry generated by build.mjs, no downloaded asset', license: 'MIT', licenseFile: 'LICENSE.sample-model.txt' }, files,
}, null, 2)}\n`);
console.log(JSON.stringify({ component: 'model-stage', threeVersion: three.version, files: Object.keys(files) }));
