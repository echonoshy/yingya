import { useEffect, useRef } from 'react';
import { createStudioRenderer } from './studioMotion';
import './studioIllustration.css';

export function StudioIllustration({ suspended }: { suspended: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current, image = imageRef.current, canvas = canvasRef.current;
    if (!root || !image || !canvas || suspended) return;
    const media = window.matchMedia('(prefers-reduced-motion: no-preference)');
    const mouseCapability = window.matchMedia('(any-hover: hover) and (any-pointer: fine)');
    const plate = new Image(), propsPlate = new Image();
    plate.decoding = propsPlate.decoding = 'async';
    const preload = () => {
      if (media.matches && !plate.getAttribute('src')) plate.src = '/marketing/studio-clean-plate.png';
      if (media.matches && !propsPlate.getAttribute('src')) propsPlate.src = '/marketing/studio-props-plate.png';
    };
    if (mouseCapability.matches) preload();
    const style = getComputedStyle(root);
    const duration = (token: string) => {
      // Production CSS may minify 160ms to .16s. Normalize before using RAF/timers.
      const value = style.getPropertyValue(token).trim();
      return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    };
    const quick = duration('--motion-quick'), standard = duration('--motion-standard');
    const stagger = duration('--motion-stagger');
    const gestureDuration = standard * 2;
    let renderer: ReturnType<typeof createStudioRenderer> = null;
    let failed = false, frame = 0, previousTime = 0, visible = true;
    let pointer: { clientX: number; clientY: number } | null = null;
    const values = Array<number>(13).fill(0);
    const pendingClicks = new Set<number>();
    const arms = [
      { x: .294, y: .29, rx: .12, ry: .23, hover: true, amplitude: .07 },
      { x: .72, y: .31, rx: .12, ry: .23, hover: true, amplitude: -.07 },
      { x: .14, y: .66, rx: .105, ry: .095, hover: true, amplitude: 1 },
      { x: .223, y: .848, rx: .07, ry: .06, hover: false, amplitude: 1 },
      { x: .303, y: .865, rx: .06, ry: .05, hover: false, amplitude: 1 },
      { x: .866, y: .86, rx: .07, ry: .07, hover: false, amplitude: 1 },
      { x: .938, y: .565, rx: .047, ry: .1, hover: true, amplitude: 1 },
    ].map(spec => ({ ...spec, near: false, clicked: false, timer: 0, started: -Infinity, last: -Infinity }));

    const clearArms = (includeClicks = true) => {
      for (const arm of arms) {
        window.clearTimeout(arm.timer); arm.timer = 0; arm.near = false;
        if (includeClicks || !arm.clicked) { arm.started = -Infinity; arm.clicked = false; }
      }
    };
    const stop = () => {
      cancelAnimationFrame(frame); frame = 0; previousTime = 0;
      values.fill(0);
      pointer = null;
      pendingClicks.clear();
      clearArms();
      delete root.dataset.moving;
      delete root.dataset.rendered;
    };
    const tick = (now: number) => {
      frame = 0;
      const dt = previousTime ? Math.min(now - previousTime, 50) : 16;
      previousTime = now;
      const blend = 1 - Math.exp(-dt / (quick / 5));
      const pulse = (start: number, offset = 0) => {
        const progress = (now - start - offset) / (gestureDuration - offset);
        return progress >= 0 && progress < 1 ? Math.sin(progress * Math.PI) ** 2 : 0;
      };
      const targets = arms.map(arm => pulse(arm.started) * arm.amplitude);
      for (let i = 0; i < 4; i++) targets.push(pulse(arms[2].started, i * stagger));
      for (let i = 0; i < 2; i++) targets.push(pulse(arms[6].started, i * stagger));
      let settling = false;
      values.forEach((value, index) => {
        values[index] = value + (targets[index] - value) * blend;
        if (Math.abs(values[index] - targets[index]) > .00001) settling = true;
      });
      const responding = arms.some(arm => now - arm.started < gestureDuration);
      if (!settling && !responding) targets.forEach((target, index) => { values[index] = target; });
      renderer?.draw(values[0], values[1], values.slice(2));
      if (values.some(Boolean)) root.dataset.rendered = 'true';
      else delete root.dataset.rendered;
      if (settling || responding) {
        root.dataset.moving = 'true';
        frame = requestAnimationFrame(tick);
      } else { delete root.dataset.moving; previousTime = 0; }
    };
    const requestFrame = () => {
      if (!frame) { root.dataset.moving = 'true'; frame = requestAnimationFrame(tick); }
    };
    const prepareRenderer = () => {
      if (!media.matches || !visible || document.hidden || failed) return false;
      if (!image.complete || !image.naturalWidth || !plate.complete || !plate.naturalWidth || !propsPlate.complete || !propsPlate.naturalWidth) return false;
      if (!renderer) {
        renderer = createStudioRenderer(canvas, image, plate, propsPlate);
        if (!renderer) { failed = true; return false; }
      }
      return true;
    };
    const playClick = (index: number, delay = 0) => {
      if (!media.matches || !visible || document.hidden || failed) return;
      preload();
      if (!prepareRenderer()) { pendingClicks.add(index); return; }
      pendingClicks.delete(index);
      if (index === 7) { playClick(3); playClick(4, standard / 2); return; }
      const arm = arms[index];
      window.clearTimeout(arm.timer); arm.timer = 0;
      arm.clicked = true;
      arm.last = performance.now(); arm.started = arm.last + delay;
      // Explicit activation bypasses hover cooldown and restarts from the current pose.
      requestFrame();
    };
    const click = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-studio-arm]') : null;
      if (button && root.contains(button)) playClick(Number(button.dataset.studioArm));
    };
    const updatePointer = () => {
      if (!pointer || !prepareRenderer()) return;
      const bounds = root.getBoundingClientRect();
      const px = (pointer.clientX - bounds.left) / bounds.width, py = (pointer.clientY - bounds.top) / bounds.height;
      if (px < 0 || px > 1 || py < 0 || py > 1) { stop(); return; }
      for (const arm of arms) {
        if (!arm.hover) continue;
        const distance = Math.hypot((px - arm.x) / arm.rx, (py - arm.y) / arm.ry);
        if (distance < 1 && !arm.near) {
          arm.near = true;
          // A short dwell ignores fly-by movements. One response per approach,
          // with a cooldown so boundary crossings cannot restart the gesture.
          if (performance.now() - arm.last > standard * 4) {
            arm.timer = window.setTimeout(() => {
              arm.timer = 0;
              arm.clicked = false;
              arm.started = arm.last = performance.now();
              requestFrame();
            }, quick / 2);
          }
        } else if (distance > 1.2 && arm.near) {
          arm.near = false; window.clearTimeout(arm.timer); arm.timer = 0;
        }
      }
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !media.matches) return;
      pointer = { clientX: event.clientX, clientY: event.clientY };
      preload();
      updatePointer();
    };
    const leave = () => {
      pointer = null;
      clearArms(false);
      if (renderer) requestFrame();
    };
    const assetsLoaded = () => {
      for (const index of pendingClicks) playClick(index);
      updatePointer();
    };
    const mediaChanged = () => {
      stop();
      if (!media.matches) { renderer?.dispose(); renderer = null; }
      else if (mouseCapability.matches) preload();
    };
    const contextLost = (event: Event) => {
      event.preventDefault(); stop(); renderer?.dispose(); renderer = null; failed = true;
    };
    const contextRestored = () => { failed = false; };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) stop();
    });
    observer.observe(root);
    const resizeObserver = new ResizeObserver(stop);
    resizeObserver.observe(root);
    root.addEventListener('click', click);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', leave);
    root.addEventListener('pointercancel', leave);
    image.addEventListener('load', assetsLoaded);
    plate.addEventListener('load', assetsLoaded);
    propsPlate.addEventListener('load', assetsLoaded);
    canvas.addEventListener('contextlost', contextLost);
    canvas.addEventListener('contextrestored', contextRestored);
    media.addEventListener('change', mediaChanged);
    document.addEventListener('visibilitychange', stop);
    window.addEventListener('blur', stop);
    window.addEventListener('scroll', stop, { passive: true, capture: true });
    return () => {
      stop(); observer.disconnect(); resizeObserver.disconnect(); renderer?.dispose();
      root.removeEventListener('click', click);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('pointercancel', leave);
      image.removeEventListener('load', assetsLoaded);
      plate.removeEventListener('load', assetsLoaded);
      propsPlate.removeEventListener('load', assetsLoaded);
      canvas.removeEventListener('contextlost', contextLost);
      canvas.removeEventListener('contextrestored', contextRestored);
      media.removeEventListener('change', mediaChanged);
      document.removeEventListener('visibilitychange', stop);
      window.removeEventListener('blur', stop);
      window.removeEventListener('scroll', stop, true);
    };
  }, [suspended]);

  return <div ref={rootRef} className="studio-scene">
    <img ref={imageRef} className="studio-illustration" src="/marketing/static-studio.png" alt="两只卡通机械臂围绕视频剪辑工作台，整理照片和视频素材" width="1942" height="809" fetchPriority="high" draggable={false} />
    <canvas ref={canvasRef} className="studio-motion" aria-hidden="true" />
    <button type="button" className="studio-arm-trigger studio-arm-trigger--left" data-studio-arm="0" aria-label="播放左侧机械臂动作" disabled={suspended} />
    <button type="button" className="studio-arm-trigger studio-arm-trigger--right" data-studio-arm="1" aria-label="播放右侧机械臂动作" disabled={suspended} />
    {[
      ['box', '播放素材盒照片动作', 2],
      ['ocean', '播放海景照片动作', 3],
      ['flower', '播放花朵照片动作', 4],
      ['sunflower', '播放向日葵照片动作', 5],
      ['stationery', '播放文具动作', 6],
      ['photo-pair', '播放桌面照片动作', 7],
    ].map(([name, label, index]) => <button key={name} type="button" className={`studio-arm-trigger studio-prop-trigger--${name}`} data-studio-arm={index} aria-label={String(label)} disabled={suspended} />)}
  </div>;
}
