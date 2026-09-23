import { useEffect, useRef, useState } from 'react';
import landscape from '../assets/scenery/ink-ai-landscape.webp';
import { InkPreview } from './InkPreview';
import ochre from '../assets/scenery/ink-ai-director.webp';
import sage from '../assets/scenery/ink-ai-film.webp';
import ink from '../assets/scenery/ink-ai-hanging.webp';
import { cssTimeMilliseconds } from './motionTiming';

const visitors = [
  { id: 'ochre', image: ochre, place: '打板', reply: '打板的小怪兽准备开拍了。' },
  { id: 'sage', image: sage, place: '胶片旁', reply: '胶片旁的小怪兽抖了抖缠住的胶片。' },
  { id: 'ink', image: ink, place: '倒挂', reply: '倒挂的小怪兽向你点了点头。' },
];

function InkVisitor({ visitor }: { visitor: typeof visitors[number] }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const [reply, setReply] = useState({ text: '', count: 0 });

  useEffect(() => {
    const reset = () => {
      animationRef.current?.cancel();
      animationRef.current = null;
      if (buttonRef.current) buttonRef.current.dataset.playing = 'false';
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onVisibility = () => { if (document.hidden) reset(); };
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) reset(); });
    if (buttonRef.current) observer.observe(buttonRef.current);
    reduced.addEventListener('change', reset);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      observer.disconnect();
      reduced.removeEventListener('change', reset);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', reset);
    };
  }, []);

  function greet() {
    if (!imageRef.current || !buttonRef.current || animationRef.current) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = cssTimeMilliseconds(getComputedStyle(buttonRef.current).getPropertyValue('--motion-quick'));
    const poses: Record<string, string[]> = {
      ochre: ['none', 'translateY(2px) scale(1.06, .94)', 'translateY(-13px) rotate(-5deg)', 'translateY(1px) scale(1.05, .95)', 'none'],
      sage: ['none', 'rotate(-12deg)', 'rotate(10deg)', 'rotate(-5deg)', 'none'],
      ink: ['none', 'translateY(3px) scale(1.08, .9)', 'rotate(8deg)', 'rotate(-5deg)', 'none'],
    };
    const frames = reduced ? [{ opacity: 1 }, { opacity: .5 }, { opacity: 1 }] : poses[visitor.id].map(transform => ({ transform }));
    const animation = imageRef.current.animate(frames, { duration: duration * (reduced ? 1 : 5), easing: 'ease-in-out' });
    animationRef.current = animation;
    buttonRef.current.dataset.playing = 'true';
    setReply(current => ({ count: current.count + 1, text: reduced ? `${visitor.place}的小怪兽向你打了个招呼。` : visitor.reply }));
    void animation.finished.then(() => {
      if (animationRef.current !== animation) return;
      animationRef.current = null;
      if (buttonRef.current) buttonRef.current.dataset.playing = 'false';
    }).catch(() => { /* Cancellation restores the resting pose. */ });
  }

  return <>
    <button ref={buttonRef} className={`ink-visitor ink-visitor--${visitor.id}`} type="button" aria-label={`和${visitor.place}的小怪兽打个招呼`} onClick={greet} data-playing="false">
      <img ref={imageRef} src={visitor.image} alt="" draggable={false} />
    </button>
    <span className="sr-only" role="status" aria-atomic="true"><span key={reply.count}>{reply.text}</span></span>
  </>;
}

export function InkLandscape({ suspended }: { suspended: boolean }) {
  return <>
    <div className="ink-landscape-backdrop" aria-hidden="true"><img className="ink-landscape-image" src={landscape} alt="" draggable={false} fetchPriority="high" /></div>
    <div className="ink-landscape">
      <div className="ink-landscape-scene">
        <InkPreview suspended={suspended} />
        {visitors.map(visitor => <InkVisitor key={visitor.id} visitor={visitor} />)}
      </div>
    </div>
  </>;
}
