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
    const plate = new Image();
    plate.decoding = 'async';
    const preload = () => {
      if (media.matches && !plate.getAttribute('src')) plate.src = '/marketing/studio-clean-plate.png';
    };
    if (mouseCapability.matches) preload();
    const style = getComputedStyle(root);
    const duration = (token: string) => {
      // Production CSS may minify 160ms to .16s. Normalize before using RAF/timers.
      const value = style.getPropertyValue(token).trim();
      return parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    };
    const quick = duration('--motion-quick'), standard = duration('--motion-standard');
    const gestureDuration = standard * 2;
    let renderer: ReturnType<typeof createStudioRenderer> = null;
    let failed = false, frame = 0, previousTime = 0, visible = true;
    let pointer: { clientX: number; clientY: number } | null = null;
    let left = 0, right = 0;
    const pendingClicks = new Set<number>();
    const arms = [
      { x: .294, y: .29, near: false, clicked: false, timer: 0, started: -Infinity, last: -Infinity },
      { x: .72, y: .31, near: false, clicked: false, timer: 0, started: -Infinity, last: -Infinity },
    ];

    const clearArms = (includeClicks = true) => {
      for (const arm of arms) {
        window.clearTimeout(arm.timer); arm.timer = 0; arm.near = false;
        if (includeClicks || !arm.clicked) { arm.started = -Infinity; arm.clicked = false; }
      }
    };
    const stop = () => {
      cancelAnimationFrame(frame); frame = 0; previousTime = 0;
      left = right = 0;
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
      const pulse = (start: number) => {
        const progress = (now - start) / gestureDuration;
        return progress >= 0 && progress < 1 ? Math.sin(progress * Math.PI) ** 2 : 0;
      };
      const targetLeft = pulse(arms[0].started) * .07;
      const targetRight = pulse(arms[1].started) * -.07;
      left += (targetLeft - left) * blend; right += (targetRight - right) * blend;
      const responding = arms.some(arm => now - arm.started < gestureDuration);
      const settling = Math.abs(left - targetLeft) + Math.abs(right - targetRight) > .00001;
      if (!settling && !responding) { left = targetLeft; right = targetRight; }
      renderer?.draw(left, right);
      if (left || right) root.dataset.rendered = 'true';
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
      if (!image.complete || !image.naturalWidth || !plate.complete || !plate.naturalWidth) return false;
      if (!renderer) {
        renderer = createStudioRenderer(canvas, image, plate);
        if (!renderer) { failed = true; return false; }
      }
      return true;
    };
    const playClick = (index: number) => {
      if (!media.matches || !visible || document.hidden || failed) return;
      preload();
      if (!prepareRenderer()) { pendingClicks.add(index); return; }
      pendingClicks.delete(index);
      const arm = arms[index];
      window.clearTimeout(arm.timer); arm.timer = 0;
      arm.clicked = true;
      arm.started = arm.last = performance.now();
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
        const distance = Math.hypot((px - arm.x) / .12, (py - arm.y) / .23);
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
    <button type="button" className="studio-arm-trigger studio-arm-trigger--left" data-studio-arm="0" aria-label="播放左侧机械臂动作" title="点击播放机械臂动作" disabled={suspended} />
    <button type="button" className="studio-arm-trigger studio-arm-trigger--right" data-studio-arm="1" aria-label="播放右侧机械臂动作" title="点击播放机械臂动作" disabled={suspended} />
  </div>;
}
