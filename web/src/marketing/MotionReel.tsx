import { ShowcasePlayer } from './ShowcasePlayer';
import { introFilm } from './showcaseMedia';

export function MotionReel({ suspended = false }: { suspended?: boolean }) {
  return <div id="yingya-film" className="home-motion-reel" role="region" aria-label="YingYa 宣传片">
    <div className="motion-reel-caption"><code aria-hidden="true">{'<YingYa loop />'}</code><span>点 · 线 · 面 · 体 · 光 · 声</span></div>
    <div className="motion-reel-shell"><ShowcasePlayer clip={introFilm} suspended={suspended} playWhenVisible loop/></div>
  </div>;
}
