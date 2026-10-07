import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, SpeakerSlash } from '@phosphor-icons/react';
import { ActionDialog } from '../components/ActionDialog';
import { ShowcasePlayer } from './ShowcasePlayer';
import { filmTime, referenceFilms, type ShowcaseClip } from './showcaseMedia';
import './referenceGallery.css';

/** Mount only for the current pointer preview; unmounting cancels its media request. */
function HoverPreview({ clip, onStop }: { clip: ShowcaseClip; onStop: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const stop = useRef(onStop);
  stop.current = onStop;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let disposed = false;
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const stopPreview = () => stop.current();
    const hide = () => { if (document.hidden) stopPreview(); };
    const reduce = () => { if (preference.matches) stopPreview(); };
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .2)) stopPreview();
    }, { threshold: [0, .2] });
    observer.observe(video);
    video.muted = true;
    video.src = clip.src;
    void video.play().catch(() => { if (!disposed) stopPreview(); });
    document.addEventListener('visibilitychange', hide);
    preference.addEventListener('change', reduce);
    return () => {
      disposed = true; observer.disconnect();
      document.removeEventListener('visibilitychange', hide);
      preference.removeEventListener('change', reduce);
      video.pause(); video.removeAttribute('src'); video.load();
    };
  }, [clip]);
  return <video className="reference-hover-video" data-ready={ready || undefined} ref={ref} muted loop playsInline preload="none" aria-hidden="true" onLoadedData={() => setReady(true)} onError={() => stop.current()}/>;
}

export function ReferenceGallery({ onOpenChange, onChoose }: { onOpenChange: (open: boolean) => void; onChoose: (clip: ShowcaseClip) => boolean }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const hoverTimer = useRef(0);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const clip = selected === null ? null : referenceFilms[selected];
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const stopPreview = () => { clearTimeout(hoverTimer.current); setPreview(null); onOpenChange(selected !== null); };
  const close = () => { setSelected(null); onOpenChange(false); };
  const requestPreview = (index: number) => {
    clearTimeout(hoverTimer.current);
    if (selected !== null || matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    hoverTimer.current = window.setTimeout(() => { onOpenChange(true); setPreview(index); }, 160);
  };
  return <section id="style-references" className="home-references" aria-labelledby="references-title">
    <header className="references-heading"><h2 id="references-title" tabIndex={-1}>找到风格，<span>带着参考开始。</span></h2><p className="home-english" lang="en">Find your rhythm. Make it your own.</p><p className="references-hint"><SpeakerSlash aria-hidden="true"/><span className="references-hover-hint">悬停预览，点击听见完整作品。</span><span className="references-touch-hint">点击观看，播放原片声音。</span></p><code className="references-code" aria-hidden="true">{`<Showcase clips={${referenceFilms.length}} />`}</code></header>
    <div className="reference-grid">{referenceFilms.map((film, index) => <article className="reference-item" key={film.id} data-previewing={preview === index || undefined}>
      <button className="reference-play" type="button" aria-label={`播放参考视频：${film.title}`} aria-haspopup="dialog" onPointerEnter={event => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') requestPreview(index); }} onPointerLeave={stopPreview} onClick={event => { clearTimeout(hoverTimer.current); setPreview(null); returnFocus.current = event.currentTarget; onOpenChange(true); setSelected(index); }}>
        <span className="reference-artwork"><span className="reference-image"><img src={film.poster} width="800" height="450" alt="" loading="lazy" decoding="async"/>{preview === index ? <HoverPreview clip={film} onStop={stopPreview}/> : null}</span></span>
        <span className="reference-caption"><span className="reference-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><strong>{film.title}</strong><span className="reference-duration">{filmTime(Math.round(film.duration))}</span><span className="reference-open" aria-hidden="true">{preview === index ? <SpeakerSlash/> : <ArrowRight/>}</span></span>
        <span className="reference-english" lang="en">{film.english}</span>
      </button>
    </article>)}</div>
    {clip && selected !== null ? <ActionDialog title={clip.title} className="reference-dialog" onClose={close} returnFocus={returnFocus}>
      <p className="reference-dialog-description" lang="en">{clip.english}</p>
      <ShowcasePlayer key={clip.id} clip={clip} autoStart initialMuted={false}/>
      <nav className="reference-dialog-nav" aria-label="切换参考视频"><button type="button" disabled={selected === 0} onClick={() => setSelected(selected - 1)}><ArrowLeft/>上一支</button><span>{selected + 1} / {referenceFilms.length}</span><button type="button" disabled={selected === referenceFilms.length - 1} onClick={() => setSelected(selected + 1)}>下一支<ArrowRight/></button></nav>
      <button className="reference-use-style" type="button" onClick={() => { onChoose(clip); close(); }}>用这个风格准备创作<ArrowRight aria-hidden="true"/></button>
    </ActionDialog> : null}
  </section>;
}
