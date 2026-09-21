import { gsap } from 'gsap';

export type Point = { x: number; y: number };
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Coordinates share a 1200 × 400 stage. Characters are always rigid images:
// translate + rotate only. Only the separate ribbon follows a curve.
export const actors = [
  { x: 24, y: 48, size: 320, grip: { x: 0, y: 0 } },
  { x: 350, y: 0, size: 390, grip: { x: 346, y: 215 } },
  { x: 844, y: 112, size: 278, grip: { x: 59, y: 142 } },
];
export function rigidPoint(point: Point, pivot: Point, degrees: number, offset: Point): Point {
  const angle = degrees * Math.PI / 180;
  const x = point.x - pivot.x, y = point.y - pivot.y;
  return { x: pivot.x + x * Math.cos(angle) - y * Math.sin(angle) + offset.x,
    y: pivot.y + x * Math.sin(angle) + y * Math.cos(angle) + offset.y };
}
export function ribbonPoint(start: Point, end: Point, t: number, sag: number, pull: number): Point {
  return { x: start.x + (end.x - start.x) * t + Math.sin(Math.PI * t) * pull * 12,
    y: start.y + (end.y - start.y) * t + Math.sin(Math.PI * t) * sag };
}

type Pose = { pull: number; lift: number; roll: number; look: number };
const resting = (): Pose => ({ pull: 0, lift: 0, roll: 0, look: 0 });

export function createHeroTug(scene: HTMLElement, canvas: HTMLCanvasElement, texture: HTMLImageElement,
  announce: (message: string) => void) {
  const context = canvas.getContext('2d');
  if (!context) { scene.dataset.engine = 'static'; return () => {}; }
  const characters = Array.from(scene.querySelectorAll<HTMLElement>('.hero-actor-motion'));
  const buttons = Array.from(scene.querySelectorAll<HTMLButtonElement>('button'));
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const camera = { x: 0, y: 0 };
  const depthActors = Array.from(scene.querySelectorAll<HTMLElement>('.hero-depth-actor'));
  const rearProps = scene.querySelector<HTMLElement>('.hero-depth-props--rear')!;
  const frontProps = scene.querySelector<HTMLElement>('.hero-depth-props--front')!;
  // Separate camera offsets from each actor's gesture. The left prop and hand
  // share their actor's camera movement, so tossing never breaks the grip.
  const depthOffset = (index: number) => ({ x: camera.x * [22, 14, 30][index], y: camera.y * [13, 8, 18][index] });
  const pose = resting();
  const leftRest = () => ({ bodyX: 0, bodyY: 0, bodyAngle: 0, armAngle: 0, armY: 0, keyX: 0, keyY: 0, keyAngle: 0 });
  const leftPose = leftRest();
  const leftBody = scene.querySelector<HTMLElement>('.hero-toss-body')!;
  const leftArm = scene.querySelector<HTMLElement>('.hero-toss-arm')!;
  const leftKey = scene.querySelector<HTMLElement>('.hero-toss-key')!;
  let leftTimeline: gsap.core.Timeline | null = null;
  let filmState = 'idle';
  let timeline: gsap.core.Timeline | null = null;
  let disposed = false;
  let ready = false;
  let visible = true;
  let dragging: { id: number; x: number; y: number; moved: boolean; target: HTMLElement } | null = null;
  let suppressClick = false;
  const enabled = () => ready && !motion.matches && !document.hidden && visible;
  const status = (name: string) => {
    filmState = name;
    scene.dataset.playing = leftTimeline && ['idle', 'looking'].includes(name) ? 'play' : name;
    scene.dataset.leftPlaying = leftTimeline ? 'play' : 'idle';
  };
  function renderLeft() {
    if (disposed || !ready) return;
    const scale = scene.clientWidth / 1200;
    // Body and hand are rigid layers. The detached prop follows its own arc;
    // nothing stretches and film interactions cannot overwrite these channels.
    characters[0].style.transform = 'none';
    leftBody.style.transform = `translate(${leftPose.bodyX * scale}px, ${leftPose.bodyY * scale}px) rotate(${leftPose.bodyAngle}deg)`;
    leftArm.style.transform = `translate(${leftPose.bodyX * scale}px, ${(leftPose.bodyY + leftPose.armY) * scale}px) rotate(${leftPose.bodyAngle + leftPose.armAngle}deg)`;
    leftKey.style.transform = `translate(${leftPose.keyX * scale}px, ${leftPose.keyY * scale}px) rotate(${leftPose.keyAngle}deg)`;
  }
  function stopLeft() {
    leftTimeline?.kill(); leftTimeline = null; Object.assign(leftPose, leftRest()); scene.dataset.leftPhase = 'idle';
  }
  function playLeft() {
    if (leftTimeline) return; // Repeated taps never restart or stack the gesture.
    announce('小鬼吓了一跳，抛起播放键，又伸手接住了。');
    leftTimeline = gsap.timeline({ onUpdate: renderLeft, onComplete: () => {
      leftTimeline = null; Object.assign(leftPose, leftRest()); scene.dataset.leftPhase = 'idle'; renderLeft(); status(filmState);
    } });
    status(filmState);
    leftTimeline.set(scene, { attr: { 'data-left-phase': 'startle' } })
      // Sudden recoil and a small hand dip before the throw.
      .to(leftPose, { bodyX: -5, bodyY: 4, bodyAngle: -3, armAngle: 5, keyY: 4, keyAngle: -2, duration: .12, ease: 'power2.out' })
      .set(scene, { attr: { 'data-left-phase': 'airborne' } })
      // Fast release, slowing to the top of the arc. No freeze at the apex.
      .to(leftPose, { keyX: 8, keyY: -180, keyAngle: -20, duration: .30, ease: 'power2.out' }, .12)
      .to(leftPose, { bodyX: -10, bodyY: -4, bodyAngle: -7, armAngle: -24, armY: -3, duration: .20, ease: 'power2.out' }, .12)
      // Accelerate downward into the waiting hands, with a gentle rotation back.
      .to(leftPose, { keyX: 0, keyY: 0, keyAngle: 0, duration: .38, ease: 'power2.in' }, .42)
      .to(leftPose, { bodyX: 0, bodyY: 0, bodyAngle: 0, armAngle: -8, armY: -2, duration: .28, ease: 'sine.inOut' }, .50)
      .set(scene, { attr: { 'data-left-phase': 'catch' } }, .80)
      // Hand, body and prop absorb the catch together, then settle as one.
      .to(leftPose, { bodyY: 7, armAngle: 0, armY: 0, keyY: 7, duration: .12, ease: 'power2.out' }, .80)
      .to(leftPose, { bodyY: 0, keyY: 0, duration: .30, ease: 'sine.inOut' }, .92);
  }

  // Scan the generated raster's alpha once to locate the strip, excluding padding.
  let crop = { y: 0, height: 1 };
  function render() {
    if (disposed || !ready) return;
    const width = scene.clientWidth;
    const scale = width / 1200;
    const translate = (element: HTMLElement, x: number, y: number) => {
      element.style.transform = `translate(${x * scale}px, ${y * scale}px)`;
    };
    depthActors.forEach((element, index) => {
      const offset = depthOffset(index); translate(element, offset.x, offset.y);
    });
    translate(rearProps, camera.x * -7, camera.y * -4);
    translate(frontProps, camera.x * 36, camera.y * 21);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(width / 3 * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    context!.setTransform(pixelWidth / 1200, 0, 0, pixelHeight / 400, 0, 0);
    context!.clearRect(0, 0, 1200, 400);
    const transforms = [
      { x: 0, y: 0, angle: 0 },
      { x: -pose.pull * 13, y: -Math.abs(pose.pull) * 3, angle: -pose.pull * 5 + pose.look * 2 },
      { x: -pose.pull * 22 + pose.roll * 4, y: -Math.abs(pose.roll) * 7, angle: pose.pull * 8 + pose.roll * 19 + pose.look },
    ];
    renderLeft();
    characters.forEach((element, index) => {
      if (index === 0) return;
      const p = transforms[index];
      element.style.transform = `translate(${p.x * scale}px, ${p.y * scale}px) rotate(${p.angle}deg)`;
    });
    function grip(index: number) {
      const actor = actors[index], transform = transforms[index];
      const point = rigidPoint(actor.grip, { x: actor.size / 2, y: actor.size * .85 }, transform.angle, transform);
      const offset = depthOffset(index);
      return { x: actor.x + point.x + offset.x, y: actor.y + point.y + offset.y };
    }
    const start = grip(1), end = grip(2);
    const sag = 67 - Math.abs(pose.pull) * 32 + pose.lift * 25;
    // Map narrow raster slices along the ribbon at constant thickness. The
    // character images never enter this renderer, so their faces cannot warp.
    const segments = 180, thickness = 38;
    for (let index = 0; index < segments; index++) {
      const t = index / segments;
      const a = ribbonPoint(start, end, t, sag, pose.pull);
      const b = ribbonPoint(start, end, (index + 1) / segments, sag, pose.pull);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      context!.save(); context!.translate(a.x, a.y); context!.rotate(Math.atan2(b.y - a.y, b.x - a.x));
      context!.drawImage(texture, t * texture.naturalWidth * .65, crop.y, texture.naturalWidth * .65 / segments, crop.height,
        0, -thickness / 2, length + .7, thickness);
      context!.restore();
    }
  }
  const lookTo = gsap.quickTo(pose, 'look', { duration: .36, ease: 'power2.out', onUpdate: render });
  const pullTo = gsap.quickTo(pose, 'pull', { duration: .16, ease: 'power2.out', onUpdate: render });
  const liftTo = gsap.quickTo(pose, 'lift', { duration: .16, ease: 'power2.out', onUpdate: render });
  const cameraXTo = gsap.quickTo(camera, 'x', { duration: .5, ease: 'power2.out', onUpdate: render });
  const cameraYTo = gsap.quickTo(camera, 'y', { duration: .5, ease: 'power2.out', onUpdate: render });
  function freezeCamera() { cameraXTo.tween.pause(); cameraYTo.tween.pause(); }
  function moveCamera(x: number, y: number) { cameraXTo(x, camera.x); cameraYTo(y, camera.y); }
  function kill() { timeline?.kill(); timeline = null; gsap.killTweensOf(pose); }
  function releaseCapture() {
    const current = dragging; dragging = null;
    if (current?.target.hasPointerCapture(current.id)) current.target.releasePointerCapture(current.id);
  }
  function reset() {
    kill(); stopLeft(); releaseCapture(); suppressClick = false;
    freezeCamera(); camera.x = 0; camera.y = 0;
    Object.assign(pose, resting()); status('idle'); render();
  }
  function settle() {
    kill(); status('settling');
    // Pointer capture can end outside the scene, where no later leave event
    // will arrive. Always bring the frozen camera home with the released film.
    moveCamera(0, 0);
    timeline = gsap.timeline({ onUpdate: render, onComplete: () => { timeline = null; status('idle'); } })
      .to(pose, { pull: 0, lift: 0, roll: 0, look: 0, duration: .85, ease: 'elastic.out(1, 0.5)' });
  }
  function play(name: string) {
    if (!enabled()) return;
    if (name === 'play') { playLeft(); return; }
    kill(); status(name);
    timeline = gsap.timeline({ onUpdate: render, onComplete: () => { timeline = null; status('idle'); } });
    if (name === 'tumble') {
      announce('小鬼试着翻身，被胶片轻轻拉了回来。');
      timeline.to(pose, { roll: -.18, duration: .16 }).to(pose, { roll: 1, pull: .45, duration: .36, ease: 'power2.out' })
        .to(pose, { roll: 0, pull: 0, lift: 0, duration: .85, ease: 'elastic.out(1, 0.5)' }, '+=.12');
    } else {
      announce('小鬼拉紧胶片，同伴被轻轻带动，然后一起松手。');
      timeline.to(pose, { pull: -.15, duration: .16 }).to(pose, { pull: 1, lift: -.3, duration: .36, ease: 'power2.out' })
        .to(pose, { pull: 0, lift: 0, roll: 0, duration: .85, ease: 'elastic.out(1, 0.5)' }, '+=.1');
    }
  }
  function down(event: PointerEvent) {
    if (!enabled() || !event.isPrimary || event.button !== 0 || dragging) return;
    suppressClick = false;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-tug]');
    if (!target) return;
    freezeCamera(); // Pause reusable quickTo tweens; killing them prevents later resetTo calls.
    kill(); dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, target };
    target.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!enabled()) return;
    const bounds = scene.getBoundingClientRect();
    if (!dragging && event.pointerType === 'mouse' && finePointer.matches) {
      moveCamera(clamp(((event.clientX - bounds.left) / bounds.width - .5) * 2, -1, 1),
        clamp(((event.clientY - bounds.top) / bounds.height - .5) * 2, -1, 1));
    }
    if (dragging) {
      if (event.pointerId !== dragging.id) return;
      const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
      if (!dragging.moved && Math.hypot(dx, dy) < 5) return;
      dragging.moved = true; status('dragging');
      pullTo(clamp(dx / (bounds.width * .12), -1.2, 1.2));
      liftTo(clamp(dy / (bounds.height * .25), -1, 1));
    } else if (event.pointerType === 'mouse' && !timeline) {
      status('looking'); lookTo(clamp(((event.clientX - bounds.left) / bounds.width - .5) * 2, -1, 1));
    }
  }
  function up(event: PointerEvent) {
    if (!dragging || event.pointerId !== dragging.id) return;
    const moved = dragging.moved;
    suppressClick = moved; releaseCapture();
    if (moved) { announce('松开胶片，小鬼们回到了原位。'); settle(); }
    else if (event.type !== 'pointerup') settle();
  }
  function click(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (suppressClick && event.detail > 0) { suppressClick = false; return; }
    play(button.dataset.character ?? 'film');
  }
  function leave() { if (!enabled()) return; if (!dragging) { moveCamera(0, 0); lookTo(0); if (!timeline) status('idle'); } }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { reset(); return; }
    if (!(event.target as HTMLElement).matches('[data-tug]') || !['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault(); if (!enabled()) return;
    if (event.key === 'Home') { settle(); return; }
    kill(); status('dragging'); pullTo(event.key === 'ArrowLeft' ? -1 : 1);
  }
  function keyup(event: KeyboardEvent) {
    if ((event.target as HTMLElement).matches('[data-tug]') && ['ArrowLeft', 'ArrowRight'].includes(event.key) && enabled()) settle();
  }
  function focusout(event: FocusEvent) { if (!scene.contains(event.relatedTarget as Node | null)) { if (scene.dataset.playing === 'dragging') settle(); leave(); } }
  function visibility() { if (document.hidden) reset(); }
  function preference() { reset(); scene.dataset.reduced = String(motion.matches); }
  const resize = new ResizeObserver(() => { if (dragging) reset(); else render(); }); resize.observe(scene);
  const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (!visible) reset(); }); observer.observe(scene);
  const listeners = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, lostpointercapture: up,
    click, pointerleave: leave, keydown, keyup, focusout };
  for (const [name, handler] of Object.entries(listeners)) scene.addEventListener(name, handler as EventListener);
  motion.addEventListener('change', preference); document.addEventListener('visibilitychange', visibility);
  finePointer.addEventListener('change', preference);
  const blur = () => reset(); window.addEventListener('blur', blur);
  scene.dataset.reduced = String(motion.matches);
  status('idle');
  scene.dataset.leftPhase = 'idle';
  void Promise.all([texture.decode(), ...Array.from(scene.querySelectorAll('img')).map(image => image.decode())]).then(() => {
    if (disposed) return;
    const scratch = document.createElement('canvas'); scratch.width = 1; scratch.height = texture.naturalHeight;
    const scan = scratch.getContext('2d');
    if (scan) {
      scan.drawImage(texture, Math.floor(texture.naturalWidth / 2), 0, 1, texture.naturalHeight, 0, 0, 1, texture.naturalHeight);
      const pixels = scan.getImageData(0, 0, 1, texture.naturalHeight).data;
      let top = 0, bottom = texture.naturalHeight - 1;
      while (top < bottom && pixels[top * 4 + 3] < 200) top++;
      while (bottom > top && pixels[bottom * 4 + 3] < 200) bottom--;
      crop = { y: top, height: bottom - top + 1 };
    }
    ready = true; scene.dataset.engine = 'gsap-rigid'; render();
  }).catch(() => { scene.dataset.engine = 'static'; buttons.forEach(button => { button.disabled = true; }); });
  return () => {
    disposed = true; kill(); stopLeft(); gsap.killTweensOf(camera); releaseCapture(); resize.disconnect(); observer.disconnect();
    for (const [name, handler] of Object.entries(listeners)) scene.removeEventListener(name, handler as EventListener);
    motion.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', blur);
    finePointer.removeEventListener('change', preference);
  };
}
