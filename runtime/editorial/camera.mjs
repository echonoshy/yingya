/*
 * Camera law adapted from HeyGen's ui-focus-zoom, Apache-2.0.
 * See vendor/PROVENANCE.json and vendor/HYPERFRAMES-LICENSE.
 * Changed by Yingya: pure absolute-time camera, no mutable drift/GSAP object
 * callbacks, static media, full overview at both ends. Original is retained.
 */
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const overview = Object.freeze({ x: 0, y: 0, scale: 1 });

export function focusCamera(focus) {
  if (!focus) return { ...overview };
  const rect = focus.rect;
  const anchor = rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : focus.anchor;
  const scale = rect ? clamp(Math.min(0.84 / rect.width, 0.84 / rect.height), 1, 3) : focus.zoom;
  // Original ui-focus-zoom servo law. No drift means no extra pan margin.
  const panMax = 50 * (scale - 1);
  return {
    x: clamp(-(anchor.x * 100 - 50) * scale, -panMax, panMax),
    y: clamp(-(anchor.y * 100 - 50) * scale, -panMax, panMax),
    scale,
  };
}

export function cameraSegments(scene) {
  const duration = scene.durationSeconds;
  if (['screen-overview', 'screen-highlight', 'screen-callout'].includes(scene.recipe)) return [{ at: 0, camera: { ...overview } }, { at: duration, camera: { ...overview } }];
  const intro = scene.overview.introSeconds;
  const outro = scene.overview.outroSeconds;
  const move = Math.min(1.1, (duration - intro - outro) / 2);
  const focused = focusCamera(scene.focus);
  if (scene.recipe === 'screen-result') return [
    { at: 0, camera: { ...overview } },
    { at: duration - outro - move, camera: { ...overview } },
    { at: duration - outro, camera: focused },
    { at: duration, camera: focused },
  ];
  return [
    { at: 0, camera: { ...overview } },
    { at: intro, camera: { ...overview } },
    { at: intro + move, camera: focused },
    { at: duration - outro - move, camera: focused },
    { at: duration - outro, camera: focusCamera(scene.overview.resultFocus) },
    { at: duration, camera: focusCamera(scene.overview.resultFocus) },
  ];
}

export function cameraAt(scene, time) {
  const points = cameraSegments(scene);
  const t = clamp(time, 0, scene.durationSeconds);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b.at) {
      const p = b.at === a.at ? 1 : (t - a.at) / (b.at - a.at);
      // GSAP power2.inOut (cubic), expressed without state.
      const eased = p < 0.5 ? 4 * p ** 3 : 1 - ((-2 * p + 2) ** 3) / 2;
      return Object.fromEntries(['x', 'y', 'scale'].map(key => [key, a.camera[key] + (b.camera[key] - a.camera[key]) * eased]));
    }
  }
  return { ...points.at(-1).camera };
}

export function cameraTransform(camera) {
  return `translate(${camera.x.toFixed(7)}%, ${camera.y.toFixed(7)}%) scale(${camera.scale.toFixed(7)})`;
}
