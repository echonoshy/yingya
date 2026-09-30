import { Play } from '@phosphor-icons/react';
import { posterPath, type VideoExample } from './examples';
import { motionReferences, type MotionReference } from './motionReferences';
import './motionGallery.css';

function MotionCard({ example, onOpen }: { example: MotionReference; onOpen: (value: VideoExample) => void }) {
  return <div className="motion-tile" data-motion-id={example.id} data-revealed="true">
    <button className="marketing-example" onClick={() => onOpen(example)} aria-label={`播放：${example.title}`}>
      <div className="marketing-example-image"><img src={posterPath(example.id)} alt={example.label} width={960} height={540} loading="lazy" /><span className="motion-card-open" aria-hidden="true"><Play weight="fill" /></span></div>
      <div className="motion-card-caption"><h3>{example.label}</h3></div>
      <p className="motion-card-description">{example.summary}</p>
    </button>
  </div>;
}

export function MotionGallery({ onOpen, suspended, reduced }: { onOpen: (value: VideoExample) => void; suspended: boolean; reduced: boolean }) {
  const noMotion = reduced || suspended;
  return <section className="workshop-showcase motion-showcase" id="showcase" aria-labelledby="motion-gallery-title" data-motion-off={noMotion}>
    <div className="motion-gallery-heading"><div><h2 id="motion-gallery-title">视频示例</h2></div></div>
    <div className="marketing-gallery motion-gallery" id="motion-gallery-cards">{motionReferences.map(example => <MotionCard key={example.id} example={example} onOpen={onOpen} />)}</div>
  </section>;
}
