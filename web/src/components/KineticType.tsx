import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import './playful-motion.css';

/** Short, interruptible gestures. Nothing keeps running after leaving the surface. */
export function usePlayMotion() {
  const running = useRef(new Map<Element, Animation>());
  const cancel = useCallback(() => {
    running.current.forEach(animation => animation.cancel());
    running.current.clear();
  }, []);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => { if (preference.matches || document.hidden) cancel(); };
    preference.addEventListener('change', stop);
    document.addEventListener('visibilitychange', stop);
    return () => { cancel(); preference.removeEventListener('change', stop); document.removeEventListener('visibilitychange', stop); };
  }, [cancel]);
  return useCallback((element: Element | null, frames: Keyframe[], duration = 720, delay = 0) => {
    if (!element || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const previous = running.current.get(element);
    // Continue from the painted pose on rapid replay instead of snapping to rest.
    let nextFrames = frames;
    if (previous?.playState === 'running') {
      const painted = getComputedStyle(element);
      const first = { ...frames[0] };
      if ('transform' in first) first.transform = painted.transform;
      if ('opacity' in first) first.opacity = painted.opacity;
      if ('textShadow' in first) first.textShadow = painted.textShadow;
      nextFrames = [first, ...frames.slice(1)];
    }
    previous?.cancel();
    const animation = element.animate(nextFrames, { duration, delay: previous ? 0 : delay, easing: 'cubic-bezier(.22,.7,.24,1)' });
    running.current.set(element, animation);
    void animation.finished.then(() => {
      if (running.current.get(element) === animation) running.current.delete(element);
    }).catch(() => undefined);
  }, []);
}

/** Text remains in normal flow and readable in every frame; visual glyphs aren't announced twice. */
export function KineticType({ text, cue = 0, mixed = false, reveal = false }: { text: string; cue?: number; mixed?: boolean; reveal?: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const animate = usePlayMotion();
  const play = useCallback((variant: number) => {
    root.current?.querySelectorAll<HTMLElement>('.kinetic-letter').forEach((letter, index) => {
      const sign = index % 2 ? 1 : -1;
      const middle = variant % 3 === 1
        ? `translate(${sign * .16}em,${sign * .12}em) rotate(${sign * 12}deg) scale(1.12)`
        : variant % 3 === 2 ? `translateY(-.2em) rotate(${sign * 7}deg) scale(.9,1.16)` : 'translateY(.09em) scale(1.1,.87)';
      animate(letter, [
        { transform: 'none', textShadow: '0 0 transparent' },
        { transform: middle, textShadow: '.065em .065em #1875e54d', offset: .3 },
        { transform: `translateY(-.035em) rotate(${-sign * 2}deg)`, textShadow: '.02em .02em #1875e520', offset: .7 },
        { transform: 'none', textShadow: '0 0 transparent' },
      ], 820, index * 45);
    });
  }, [animate]);
  useEffect(() => { if (cue) play(cue); }, [cue, play]);
  useEffect(() => {
    if (!reveal || !root.current) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { play(2); observer.disconnect(); }
    }, { threshold: .8 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [reveal, play]);
  return <span ref={root} className={`kinetic-type${mixed ? ' kinetic-type--mixed' : ''}`}>
    <span className="sr-only">{text}</span><span aria-hidden="true">{Array.from(text).map((letter, index) => <span className="kinetic-hit" key={index} onPointerEnter={event => {
      if (event.pointerType !== 'mouse') return;
      animate(event.currentTarget.firstElementChild, [{ transform: 'none' }, { transform: `translateY(-.12em) rotate(${index % 2 ? 9 : -9}deg)`, textShadow: '.045em .045em #1875e54d', offset: .35 }, { transform: 'none' }], 560);
    }}><span className={`kinetic-letter${mixed && index % 2 ? ' kinetic-letter--serif' : ''}`} style={{ '--letter-order': index } as CSSProperties}>{letter}</span></span>)}</span>
  </span>;
}
