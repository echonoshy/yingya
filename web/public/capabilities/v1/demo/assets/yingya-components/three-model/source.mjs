// The Three.js scene is driven exclusively by Yingya's shared video clock.
// This file is the editable source of model-scene.js; run build.mjs to rebuild.
import {
  ACESFilmicToneMapping, AnimationMixer, Box3, DirectionalLight, Group,
  HemisphereLight, LoadingManager, LoopOnce, PerspectiveCamera, Scene,
  SRGBColorSpace, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const mounted = new WeakMap();
const unsupportedCompression = new Set(['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression', 'KHR_texture_basisu']);
const finite = (value, name, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new TypeError(`${name} must be a finite number between ${min} and ${max}`);
  return value;
};

export function localPath(value, name = 'modelUrl') {
  if (typeof value !== 'string' || !value.length || /[\\\0?#]/.test(value) || value.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(value)) throw new TypeError(`${name} must be a project-relative local path without a query or fragment`);
  let decoded;
  try { decoded = decodeURIComponent(value); } catch { throw new TypeError(`${name} has invalid URL encoding`); }
  if (/[\\\0?#]/.test(decoded) || decoded.startsWith('/') || decoded.split('/').includes('..') || /^[a-z][a-z\d+.-]*:/i.test(decoded)) throw new TypeError(`${name} must stay inside its local model directory`);
  return value;
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object') throw new TypeError('model-stage config is required');
  const modelUrl = localPath(input.modelUrl);
  if (!/\.(glb|gltf)$/i.test(modelUrl)) throw new TypeError('modelUrl must point to a local .glb or .gltf file');
  const motion = input.motion ?? 'turntable';
  if (!['turntable', 'orbit', 'still'].includes(motion)) throw new TypeError('motion must be turntable, orbit, or still');
  const animationClip = input.animationClip ?? null;
  if (animationClip !== null && !(typeof animationClip === 'string' && animationClip.length) && !(Number.isInteger(animationClip) && animationClip >= 0)) throw new TypeError('animationClip must be a clip name, nonnegative index, or null');
  if (input.animationLoop !== undefined && typeof input.animationLoop !== 'boolean') throw new TypeError('animationLoop must be boolean');
  return Object.freeze({
    component: 'model-stage', modelUrl,
    startSeconds: finite(input.startSeconds, 'startSeconds', 0, 86400),
    durationSeconds: finite(input.durationSeconds, 'durationSeconds', .1, 3600),
    width: finite(input.width, 'width', 16, 7680),
    height: finite(input.height, 'height', 16, 7680),
    motion, turns: finite(input.turns ?? .5, 'turns', -20, 20),
    yawDegrees: finite(input.yawDegrees ?? -25, 'yawDegrees', -360, 360),
    elevationDegrees: finite(input.elevationDegrees ?? 12, 'elevationDegrees', -80, 80),
    framing: finite(input.framing ?? 1.15, 'framing', 1, 4),
    exposure: finite(input.exposure ?? 1, 'exposure', .1, 4),
    animationClip, animationLoop: input.animationLoop ?? true,
    maxModelBytes: finite(input.maxModelBytes ?? 64 * 1024 * 1024, 'maxModelBytes', 1024, 256 * 1024 * 1024),
  });
}

// Preflight before GLTFLoader can request textures or optional decoders. A glTF
// model remains a local asset tree; never silently load a remote texture/CDN.
export function validateModelDocument(document) {
  if (document?.asset?.version !== '2.0') throw new Error('Only glTF 2.0 models are supported');
  const extensions = [...(document.extensionsUsed || []), ...(document.extensionsRequired || [])];
  const compressed = extensions.find(value => unsupportedCompression.has(value));
  if (compressed) throw new Error(`${compressed} requires an extra decoder. Export an uncompressed GLB with PNG/JPEG/WebP textures before importing.`);
  for (const entry of [...(document.buffers || []), ...(document.images || [])]) {
    if (entry.uri === undefined) continue;
    if (typeof entry.uri === 'string' && /^data:(?:application\/octet-stream|application\/gltf-buffer|image\/(?:png|jpeg|webp|avif));base64,[a-z\d+/=\s]+$/i.test(entry.uri)) continue;
    localPath(entry.uri, 'model buffer/texture URI');
  }
  return document;
}

export function readModelDocument(bytes) {
  const view = new DataView(bytes);
  if (bytes.byteLength >= 12 && view.getUint32(0, true) === 0x46546c67) {
    if (view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) throw new Error('Invalid glTF binary header');
    if (bytes.byteLength < 20 || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('GLB must start with a JSON chunk');
    const length = view.getUint32(12, true);
    if (length > bytes.byteLength - 20) throw new Error('GLB JSON chunk exceeds model size');
    return validateModelDocument(JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length))));
  }
  return validateModelDocument(JSON.parse(new TextDecoder().decode(bytes)));
}

function disposeObject(root) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), images = new Set();
  root?.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean)) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
    object.skeleton?.dispose();
  });
  for (const texture of textures) { if (texture.source?.data) images.add(texture.source.data); texture.dispose(); }
  // GLTFLoader ImageBitmaps must be closed explicitly, in addition to textures.
  for (const image of images) image.close?.();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export function createModelScene(container, input) {
  const config = validateConfig(input);
  if (!container || container.nodeType !== 1 || !container.isConnected || !container.style) throw new TypeError('container must be a connected HTML element');
  if (mounted.has(container)) throw new Error('container already has a model scene; dispose it before replacing it');
  if (container.childNodes.length) throw new Error('container must be empty; existing content is never replaced');
  const canvas = container.ownerDocument.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(config.width, config.height, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.exposure;
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, config.width / config.height, .01, 100);
  const turntable = new Group();
  const normalization = new Group();
  turntable.add(normalization);
  scene.add(turntable);
  scene.add(new HemisphereLight(0xffffff, 0x596171, 2.2));
  for (const [position, intensity] of [[[3, 5, 4], 3.2], [[-4, 2, -3], 2]]) {
    const light = new DirectionalLight(0xffffff, intensity);
    light.position.set(...position);
    scene.add(light);
  }
  const abort = new AbortController();
  let disposed = false, loaded = false, failure = null, gltf = null, mixer = null, action = null, distance = 5, currentTime = 0;
  const radians = Math.PI / 180;
  function renderAt(seconds) {
    finite(seconds, 'renderAt time', 0, 86400);
    if (disposed) return;
    currentTime = seconds;
    if (failure) throw failure;
    if (!loaded) return;
    const local = Math.max(0, Math.min(config.durationSeconds, seconds - config.startSeconds));
    const progress = local / config.durationSeconds;
    const angle = config.yawDegrees * radians + (config.motion === 'still' ? 0 : progress * config.turns * Math.PI * 2);
    turntable.rotation.set(0, config.motion === 'orbit' ? 0 : angle, 0);
    const azimuth = config.motion === 'orbit' ? angle : 0;
    const elevation = config.elevationDegrees * radians;
    camera.position.set(Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance);
    camera.lookAt(0, 0, 0);
    if (action) {
      const duration = action.getClip().duration;
      const clipTime = config.animationLoop && duration > 0 ? local % duration : Math.min(local, duration);
      // Reset paused/clamped action state too: an end -> beginning seek must not
      // leave AnimationMixer stuck at the previous final frame.
      action.reset().setLoop(LoopOnce, 1).play();
      action.clampWhenFinished = true;
      mixer.setTime(clipTime);
    }
    renderer.render(scene, camera);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    mixer?.stopAllAction();
    if (gltf?.scene) mixer?.uncacheRoot(gltf.scene);
    disposeObject(scene);
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    mounted.delete(container);
    container.dataset.yingyaModelState = 'disposed';
  }
  container.append(canvas);
  container.dataset.yingyaModelState = 'loading';
  const ready = (async () => {
    const modelUrl = new URL(config.modelUrl, container.ownerDocument.baseURI);
    const modelDirectory = new URL('.', modelUrl);
    const response = await fetch(modelUrl, { signal: abort.signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Model request failed (${response.status}): ${config.modelUrl}`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > config.maxModelBytes) throw new Error('Model exceeds maxModelBytes; optimize or split the model before use');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > config.maxModelBytes) throw new Error('Model exceeds maxModelBytes; optimize or split the model before use');
    readModelDocument(bytes);
    const manager = new LoadingManager();
    let resourceFailure = null;
    manager.onError = url => { resourceFailure = new Error(`Model resource failed to load: ${url}`); };
    manager.setURLModifier(url => {
      if (/^(data:|blob:)/.test(url)) return url;
      const resolved = new URL(url, modelDirectory);
      if (resolved.origin !== modelDirectory.origin || !resolved.pathname.startsWith(modelDirectory.pathname)) throw new Error('Model resources must stay inside the local model directory');
      return resolved.href;
    });
    gltf = await new GLTFLoader(manager).parseAsync(bytes, modelDirectory.href);
    if (disposed) { disposeObject(gltf.scene); throw new Error('Model scene was disposed while loading'); }
    if (resourceFailure) throw resourceFailure;
    const box = new Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) throw new Error('Model contains no visible mesh geometry');
    const size = box.getSize(new Vector3());
    const longest = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(longest) || longest <= 0) throw new Error('Model bounds are invalid');
    normalization.scale.setScalar(2 / longest);
    normalization.position.copy(box.getCenter(new Vector3())).multiplyScalar(-2 / longest);
    normalization.add(gltf.scene);
    const radius = size.length() / longest;
    const halfFov = camera.fov * radians / 2;
    const smallestHalfFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    distance = radius / Math.sin(smallestHalfFov) * config.framing;
    camera.far = distance + radius * 5;
    camera.updateProjectionMatrix();
    if (config.animationClip !== null) {
      const clip = typeof config.animationClip === 'number' ? gltf.animations[config.animationClip] : gltf.animations.find(item => item.name === config.animationClip);
      if (!clip) throw new Error(`Animation clip not found: ${config.animationClip}`);
      mixer = new AnimationMixer(gltf.scene);
      action = mixer.clipAction(clip);
    }
    // All textures have resolved before parseAsync completes. Compile now so the
    // ready promise also covers shaders needed for the first captured frame.
    if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    if (disposed) throw new Error('Model scene was disposed while preparing');
    loaded = true;
    renderAt(currentTime);
    container.dataset.yingyaModelState = 'ready';
  })().catch(error => {
    failure = error instanceof Error ? error : new Error(String(error));
    if (!disposed) {
      container.dataset.yingyaModelState = 'error';
      container.dataset.yingyaModelError = failure.message;
      disposeObject(gltf?.scene);
      renderer.dispose();
    }
    throw failure;
  });
  // The bridge/render caller still receives the original rejected promise, while
  // direct factory users can attach their readiness handler in the next task.
  ready.catch(() => {});
  const controller = { ready, renderAt, seek: renderAt, dispose, startSeconds: config.startSeconds, durationSeconds: config.durationSeconds, config, canvas, scene, camera, renderer,
    get currentTime() { return currentTime; }, get status() { return disposed ? 'disposed' : failure ? 'error' : loaded ? 'ready' : 'loading'; },
    get animations() { return (gltf?.animations || []).map(clip => ({ name: clip.name, duration: clip.duration })); } };
  mounted.set(container, controller);
  return controller;
}

globalThis.YingyaComponents?.define('model-stage', createModelScene);
