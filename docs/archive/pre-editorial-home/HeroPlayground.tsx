import { useEffect, useRef, useState } from 'react';
import playGhost from '../assets/comic/toss-body.webp';
import playKey from '../assets/comic/toss-key.webp';
import playArm from '../assets/comic/toss-arm.webp';
import directorGhost from '../assets/comic/tug-director.webp';
import tumbleGhost from '../assets/comic/tug-tumble.webp';
import props from '../assets/comic/tug-props.webp';
import fallback from '../assets/comic/marketing.webp';
import ribbon from '../assets/comic/tug-ribbon.webp';
import { actors, createHeroTug } from './heroTug';

const characters = [
  { id: 'play', image: playGhost, label: '吓一吓小鬼，看它抛起再接住播放键' },
  { id: 'film', image: directorGhost, label: '拉一拉胶片，和小鬼拔河' },
  { id: 'tumble', image: tumbleGhost, label: '帮倒着的小鬼翻身' },
];

export function HeroPlayground() {
  const scene = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), texture = useRef<HTMLImageElement>(null);
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
  useEffect(() => createHeroTug(scene.current!, canvas.current!, texture.current!, text => {
    setAnnouncement(current => ({ text, count: current.count + 1 }));
  }), []);
  return <div className="hero-playground">
    <div ref={scene} className="studio-art studio-art--marketing hero-connected-scene" data-theme="comic" data-artwork="marketing" data-engine="loading" data-playing="idle" role="group" aria-label="小鬼片场互动">
      <img className="hero-scene-fallback" src={fallback} alt="" aria-hidden="true" draggable={false} />
      <span className="hero-depth-props hero-depth-props--rear" aria-hidden="true"><img className="hero-scene-props" src={props} alt="" draggable={false} /></span>
      <span className="hero-depth-props hero-depth-props--front" aria-hidden="true"><img className="hero-scene-props" src={props} alt="" draggable={false} /></span>
      <canvas ref={canvas} className="hero-ribbon" aria-hidden="true" />
      <img className="hero-ribbon-texture" ref={texture} src={ribbon} alt="" hidden />
      {characters.map((character, index) => {
        const actor = actors[index];
        return <button key={character.id} type="button" className={`hero-scene-character hero-scene-character--${character.id}`} data-character={character.id} data-tug={index === 1 ? '' : undefined} aria-label={character.label}
          style={{ left: `${actor.x / 12}%`, top: `${actor.y / 4}%`, width: `${actor.size / 12}%`, height: `${actor.size / 4}%` }}>
          <span className="hero-depth-actor"><span className="hero-actor-motion">
            <img className={index === 0 ? 'hero-toss-body' : undefined} src={character.image} alt="" draggable={false} />
            {index === 0 && <><span className="hero-toss-key"><img src={playKey} alt="" draggable={false} /></span><span className="hero-toss-arm"><img src={playArm} alt="" draggable={false} /></span></>}
          </span></span>
        </button>;
      })}
      <button className="hero-ribbon-handle" type="button" data-tug="" aria-label="拖动胶片，或用左右方向键和小鬼拔河" />
    </div>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true"><span key={announcement.count}>{announcement.text}</span></span>
  </div>;
}
