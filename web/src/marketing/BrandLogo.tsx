import { useEffect, useId, useRef, useState } from 'react';

// One outline, shared by the drawing and its occlusion mask. No bitmap underneath.
const BODY = 'M27 41 C25 22 41 8 59 8 C80 8 93 24 91 43 C90 61 82 70 78 80 C76 88 73 91 67 87 C62 82 60 81 54 85 C49 89 46 93 41 91 C36 90 35 82 31 81 C27 79 23 83 18 82 C11 81 7 77 8 72 C9 66 13 67 18 68 C28 71 29 54 27 41Z';
const ENLARGED = { scale: 1.65, x: 4, y: 2 };
// A rounded opening in the silhouette, with no teeth or competing facial detail.
const MOUTH = 'M100 48 C89 48 73 47 65 51 C58 55 58 65 65 70 C74 77 89 78 100 77Z';

/** A single wordmark passes through the rounded opening in the mascot silhouette. */
export function BrandLogo() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sceneRef = useRef<SVGSVGElement>(null);
  const animationsRef = useRef<Animation[]>([]);
  const runningRef = useRef(false);
  const runRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const id = useId();
  const faceMask = `${id}-face`;

  useEffect(() => {
    const reset = () => {
      runRef.current += 1;
      runningRef.current = false;
      animationsRef.current.forEach(animation => animation.cancel());
      animationsRef.current = [];
      setPlaying(false);
    };
    const onVisibility = () => { if (document.hidden) reset(); };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.addEventListener('change', reset);
    window.addEventListener('resize', reset);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      runRef.current += 1;
      animationsRef.current.forEach(animation => animation.cancel());
      reduced.removeEventListener('change', reset);
      window.removeEventListener('resize', reset);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  function play() {
    const button = buttonRef.current;
    const scene = sceneRef.current;
    if (!button || !scene || runningRef.current) return;
    runningRef.current = true;
    const run = ++runRef.current;
    setPlaying(true);
    setAnnouncement('');
    const style = getComputedStyle(button);
    const quick = parseFloat(style.getPropertyValue('--motion-quick')) || 160;
    const ease = style.getPropertyValue('--ease-sprout').trim() || 'ease-out';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? quick : quick * 30;
    const animate = (selector: string, frames: Keyframe[]) => {
      scene.querySelectorAll(selector).forEach(element => {
        animationsRef.current.push(element.animate(frames, { duration, fill: 'none' }));
      });
    };

    if (reduced) {
      animate('.brand-body', [{ opacity: 1 }, { opacity: .6 }, { opacity: 1 }]);
    } else {
      const rest = 'translate(0px, 0px) scale(1)';
      const big = `translate(${ENLARGED.x}px, ${ENLARGED.y}px) scale(${ENLARGED.scale})`;
      // The drawing and its occlusion mask share exactly the same pose.
      // Both move together, including the small recoil when breathing the letters out.
      animate('[data-brand-pose]', [
        { offset: 0, transform: rest, easing: ease },
        { offset: .04, transform: 'translate(-1px, 1px) scale(.96, 1.02)', easing: ease },
        { offset: .14, transform: big },
        { offset: .38, transform: big, easing: ease },
        { offset: .43, transform: 'translate(4px, 2px) scale(1.7, 1.6)', easing: ease },
        { offset: .49, transform: big, easing: ease },
        { offset: .56, transform: 'translate(4px, 2px) scale(1.7, 1.66)', easing: ease },
        { offset: .61, transform: big, easing: ease },
        { offset: .65, transform: 'translate(2px, 2px) scale(1.65)', easing: ease },
        { offset: .71, transform: big, easing: ease },
        { offset: .76, transform: 'translate(2px, 2px) scale(1.65)', easing: ease },
        { offset: .82, transform: big },
        { offset: .88, transform: big, easing: ease },
        { offset: 1, transform: rest },
      ]);
      animate('[data-brand-mouth]', [
        { offset: 0, transform: 'scaleY(.02)', opacity: 0 },
        { offset: .06, transform: 'scaleY(.02)', opacity: 0, easing: ease },
        { offset: .14, transform: 'scaleY(1)', opacity: 1 },
        { offset: .38, transform: 'scaleY(1)', opacity: 1, easing: ease },
        { offset: .44, transform: 'scaleY(.02)', opacity: 0 },
        { offset: .54, transform: 'scaleY(.02)', opacity: 0, easing: ease },
        { offset: .61, transform: 'scaleY(1)', opacity: 1 },
        { offset: .88, transform: 'scaleY(1)', opacity: 1, easing: ease },
        { offset: .96, transform: 'scaleY(.02)', opacity: 0 },
        { offset: 1, transform: 'scaleY(.02)', opacity: 0 },
      ]);
      animate('.brand-eyes', [
        { offset: 0, transform: 'scaleY(1)' },
        { offset: .4, transform: 'scaleY(1)', easing: ease },
        { offset: .44, transform: 'scaleY(.25)', easing: ease },
        { offset: .49, transform: 'scaleY(1)' },
        { offset: 1, transform: 'scaleY(1)' },
      ]);
      [60, 82].forEach((startX, index) => {
        // The lip is x=50 and the rounded throat x=32 in this held pose.
        // Disappear only after reaching the throat; return through the same opening.
        const pose = (x: number, y: number, scale: number, rotation = 0, stretch = 1) => `translate(${x - startX}px, ${y - 25}px) rotate(${rotation}deg) scale(${scale * stretch}, ${scale / stretch})`;
        const swallowDelay = index * .08;
        // Return the farther character first so it cannot collide with the nearer one.
        const returnDelay = index === 1 ? 0 : .11;
        animate(`[data-brand-letter="${index}"]`, [
          { offset: 0, transform: rest, opacity: 1 },
          { offset: .14 + swallowDelay, transform: rest, opacity: 1, easing: 'ease-in-out' },
          { offset: .18 + swallowDelay, transform: pose(startX - 2, 24, .98, -5), opacity: 1, easing: 'cubic-bezier(.55, 0, 1, .45)' },
          { offset: .215 + swallowDelay, transform: pose(startX - 5, 26, .9, -7, 1.06), opacity: 1, easing: 'cubic-bezier(.55, .15, 1, .65)' },
          { offset: .255 + swallowDelay, transform: pose(47, 29, .6, -4, 1.18), opacity: 1, easing: 'ease-in' },
          { offset: .28 + swallowDelay, transform: pose(33, 29, .2, 0, 1.1), opacity: 0 },
          { offset: .61 + returnDelay, transform: pose(33, 29, .2), opacity: 0, easing: 'ease-in' },
          { offset: .645 + returnDelay, transform: pose(41, 29, .45, 0, 1.1), opacity: 1 },
          { offset: .69 + returnDelay, transform: pose(55, 26, .76, 5), opacity: 1, easing: ease },
          { offset: .77 + returnDelay, transform: pose(startX + 4, 21, 1, 7), opacity: 1, easing: 'ease-in-out' },
          { offset: .86 + returnDelay, transform: rest, opacity: 1 },
          { offset: 1, transform: rest, opacity: 1 },
        ]);
      });
    }
    void Promise.all(animationsRef.current.map(animation => animation.finished)).then(() => {
      if (run !== runRef.current) return;
      animationsRef.current.forEach(animation => animation.cancel());
      animationsRef.current = [];
      runningRef.current = false;
      setPlaying(false);
      setAnnouncement(reduced ? '映芽小鬼向你打了个招呼。' : '小鬼吃掉了映芽，又把文字吐回来了。');
    }).catch(() => { /* Cancellation restores the SVG's resting pose. */ });
  }


  return <button ref={buttonRef} type="button" className="marketing-brand marketing-brand-toy" onClick={play} aria-label="播放映芽 Logo 吃字彩蛋" aria-busy={playing} title="点一下，让小鬼吃掉映芽" data-playing={playing}>
    <svg ref={sceneRef} className="brand-scene" viewBox="0 0 96 48" aria-hidden="true" focusable="false">
      <defs>
        <mask id={faceMask} maskUnits="userSpaceOnUse" x="-40" y="-40" width="200" height="140" style={{ maskType: 'luminance' }}>
          <rect x="-40" y="-40" width="200" height="140" fill="white" />
          <g data-brand-pose=""><g transform="translate(0 4) scale(.4)">
            <path d={BODY} fill="black" />
            <g data-brand-mouth=""><path className="brand-mouth-mask" d={MOUTH} fill="white" /></g>
          </g></g>
        </mask>
      </defs>
      <g data-brand-pose=""><g transform="translate(0 4) scale(.4)">
        <path className="brand-body" d={BODY} />
        <g data-brand-mouth=""><path className="brand-mouth-opening" d={MOUTH} /></g>
        <g className="brand-eyes"><ellipse cx="62" cy="35" rx="4.7" ry="7" /><ellipse cx="77" cy="34" rx="4.3" ry="6.8" /></g>
      </g></g>
      <g className="brand-letters" mask={`url(#${faceMask})`}>
        {['映', '芽'].map((letter, index) => <g key={letter} data-brand-letter={index} style={{ transformOrigin: `${60 + index * 22}px 25px` }}>
          <text x={60 + index * 22} y="25" textAnchor="middle" dominantBaseline="central">{letter}</text>
        </g>)}
      </g>
    </svg>
    <span className="marketing-sr-only" role="status">{announcement}</span>
  </button>;
}
