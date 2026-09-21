import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, CaretDown, CaretUp, Play } from '@phosphor-icons/react';
import { posterPath, type VideoExample } from './examples';
import { motionReferences, type MotionReference } from './motionReferences';
import './motionGallery.css';

function MotionCard({ example, index, paused, onOpen }: { example: MotionReference; index: number; paused: boolean; onOpen: (value: VideoExample) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let inView = false;
    const sync = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      if (inView) setRevealed(true);
      sync();
    }, { threshold: .06 });
    observer.observe(element);
    document.addEventListener('visibilitychange', sync);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', sync); };
  }, []);
  return <div ref={ref} className="motion-tile" data-motion-id={example.id} data-revealed={revealed} style={{ '--tile-order': index % 3 } as CSSProperties} onFocus={() => setRevealed(true)}>
    <button className="marketing-example" onClick={() => onOpen(example)} aria-label={`播放：${example.title}`}>
      <div className="marketing-example-image"><img src={visible && !paused && !failed ? example.webp : posterPath(example.id)} alt={example.title} width={example.width} height={example.height} loading="lazy" onError={() => setFailed(true)} /><span className="motion-card-open"><Play weight="fill" />查看动效</span></div>
      <div className="motion-card-caption"><h3>{example.label}</h3><ArrowRight aria-hidden="true" /></div>
      <p className="motion-card-description">{example.summary}</p>
    </button>
  </div>;
}

export function MotionGallery({ onOpen, suspended, reduced }: { onOpen: (value: VideoExample) => void; suspended: boolean; reduced: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? motionReferences : motionReferences.slice(0, 6);
  const noMotion = reduced || suspended;
  return <section className="workshop-showcase motion-showcase" id="showcase" aria-labelledby="motion-gallery-title" data-motion-off={noMotion}>
    <div className="motion-gallery-heading"><div><h2 id="motion-gallery-title">视频示例</h2></div></div>
    <div className="marketing-gallery motion-gallery" id="motion-gallery-cards">{shown.map((example, index) => <MotionCard key={example.id} index={index} example={example} paused={noMotion} onOpen={onOpen} />)}</div>
    <div className="motion-gallery-bottom"><button className="motion-more" aria-label={expanded ? '收起更多例子' : '展开更多例子'} title={expanded ? '收起更多例子' : '展开更多例子'} aria-controls="motion-gallery-cards" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <CaretUp aria-hidden="true" /> : <CaretDown aria-hidden="true" />}</button></div>
  </section>;
}
