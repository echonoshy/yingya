import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowCounterClockwise, ArrowsOut, Pause, Play, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { filmTime, type ShowcaseClip } from './showcaseMedia';
import './motionReel.css';

type Command = { type: 'toggle' | 'play' | 'pause' | 'retry' | 'seek' | 'synchronize'; value?: number };

/** Only visible, selected films autoplay; references load after a viewer opens them. */
export function ShowcasePlayer({ clip, autoStart = false, playWhenVisible = false, suspended = false, loop = false, initialMuted = true }: { clip: ShowcaseClip; autoStart?: boolean; playWhenVisible?: boolean; suspended?: boolean; loop?: boolean; initialMuted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<HTMLDivElement>(null);
  const suspendedRef = useRef(suspended);
  const command = useRef<(action: Command) => void>(() => undefined);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(initialMuted);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(clip.duration);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);

  useEffect(() => {
    const video = videoRef.current, player = playerRef.current;
    if (!video || !player) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false, disposed = false, wantsPlay = autoStart || (playWhenVisible && !reducedMotion.matches), mediaFailed = false, request = 0;
    let interacted = false;
    let pendingTime: number | undefined;
    const allowed = () => visible && !document.hidden && !suspendedRef.current && wantsPlay && !mediaFailed;
    const load = () => {
      if (!video.hasAttribute('src')) {
        setLoaded(false); setLoading(true); video.src = clip.src;
      }
    };
    const synchronize = () => {
      const current = ++request;
      if (!allowed()) { video.pause(); setPlaying(false); return; }
      load();
      void video.play().then(() => {
        if (disposed || !allowed()) video.pause();
      }).catch((error: DOMException) => {
        if (disposed || current !== request) return;
        if (error.name === 'NotAllowedError' && !video.muted) {
          video.muted = true; setMuted(true); setSoundBlocked(true); synchronize();
        } else { setLoading(false); wantsPlay = false; }
      });
    };
    const metadata = () => {
      if (Number.isFinite(video.duration)) setDuration(video.duration);
      if (pendingTime !== undefined) {
        video.currentTime = Math.min(pendingTime, video.duration || clip.duration);
        pendingTime = undefined;
      }
    };
    const ready = () => { setLoaded(true); setLoading(false); };
    const error = () => { mediaFailed = true; wantsPlay = false; setFailed(true); setLoading(false); setLoaded(false); setPlaying(false); video.pause(); };
    const ended = () => { wantsPlay = false; interacted = true; setPlaying(false); };
    const motionChanged = () => {
      if (!playWhenVisible) return;
      if (reducedMotion.matches) wantsPlay = false;
      else if (!interacted) wantsPlay = true;
      synchronize();
    };
    command.current = action => {
      if (action.type === 'synchronize') { synchronize(); return; }
      interacted = true;
      if (action.type === 'pause') { wantsPlay = false; synchronize(); return; }
      if (action.type === 'seek') {
        const target = action.value ?? 0;
        setTime(target);
        if (video.hasAttribute('src') && video.readyState >= 1) video.currentTime = target;
        else { pendingTime = target; video.preload = 'auto'; load(); }
        return;
      }
      if (action.type === 'toggle' && !video.paused) { wantsPlay = false; synchronize(); return; }
      if (action.type === 'retry' || mediaFailed) {
        mediaFailed = false; setFailed(false); setSlow(false);
        pendingTime = video.currentTime; video.removeAttribute('src');
      }
      if (video.ended || action.value === 0) {
        setTime(0);
        if (video.hasAttribute('src') && video.readyState >= 1) video.currentTime = 0;
        else pendingTime = 0;
      }
      wantsPlay = true; synchronize();
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .1);
      synchronize();
    }, { threshold: [0, .1] });
    observer.observe(player);
    video.addEventListener('loadedmetadata', metadata);
    video.addEventListener('loadeddata', ready);
    video.addEventListener('canplay', ready);
    video.addEventListener('playing', ready);
    video.addEventListener('error', error);
    video.addEventListener('ended', ended);
    document.addEventListener('visibilitychange', synchronize);
    reducedMotion.addEventListener('change', motionChanged);
    return () => {
      disposed = true; ++request; observer.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      reducedMotion.removeEventListener('change', motionChanged);
      video.removeEventListener('loadedmetadata', metadata); video.removeEventListener('loadeddata', ready);
      video.removeEventListener('canplay', ready); video.removeEventListener('playing', ready);
      video.removeEventListener('error', error); video.removeEventListener('ended', ended);
      video.pause(); video.removeAttribute('src'); video.load(); command.current = () => undefined;
    };
  }, [clip, autoStart, playWhenVisible]);
  useEffect(() => {
    suspendedRef.current = suspended;
    command.current({ type: 'synchronize' });
  }, [suspended]);
  useEffect(() => {
    setSlow(false);
    if (!loading) return;
    const timer = window.setTimeout(() => setSlow(true), 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  return <div className="showcase-player" data-clip={clip.id}>
    <div className="motion-reel-player" data-playing={playing || undefined} ref={playerRef}>
      <div className="motion-reel-screen" data-loaded={loaded || undefined}>
        <img src={clip.poster} width="1280" height="720" alt={`${clip.title}视频封面`} loading={playWhenVisible ? 'eager' : 'lazy'} decoding="async"/>
        <video ref={videoRef} muted={muted} loop={loop} playsInline preload="none" aria-label={clip.title} onVolumeChange={event => setMuted(event.currentTarget.muted)} onPlay={event => setPlaying(!event.currentTarget.paused)} onPause={() => setPlaying(false)} onWaiting={() => setLoading(true)} onTimeUpdate={event => setTime(event.currentTarget.currentTime)}/>
        {(failed || slow) ? <div className="motion-reel-error" role="status"><p>{failed ? '视频暂时没有加载出来' : '视频加载较慢，请稍候或重试'}</p><button type="button" onClick={() => command.current({ type: 'retry' })}>重新加载<ArrowCounterClockwise aria-hidden="true"/></button></div> : null}
        {loading && !slow ? <span className="motion-reel-loading" role="status">正在加载视频…</span> : null}
        {soundBlocked ? <button className="motion-reel-unmute" type="button" onClick={() => { const video = videoRef.current; if (video) { video.muted = false; setMuted(false); setSoundBlocked(false); command.current({ type: 'play' }); } }}><SpeakerHigh/>点击播放声音</button> : null}
      </div>
      <div className="motion-reel-controls">
        <button type="button" aria-label={playing ? '暂停视频' : '继续播放视频'} onClick={() => command.current({ type: 'toggle' })}>{playing ? <Pause weight="fill"/> : <Play weight="fill"/>}</button>
        <button type="button" aria-label="从头播放视频" onClick={() => command.current({ type: 'play', value: 0 })}><ArrowCounterClockwise/></button>
        <label className="motion-reel-scrubber"><span className="sr-only">视频播放进度</span><input type="range" min="0" max={duration} step="0.1" value={Math.min(time, duration)} style={{ '--reel-progress': `${Math.min(time / duration, 1) * 100}%` } as CSSProperties} aria-valuetext={`${filmTime(time)} / ${filmTime(duration)}`} onChange={event => command.current({ type: 'seek', value: Number(event.target.value) })}/></label>
        <span className="motion-reel-time" aria-hidden="true">{filmTime(time)} / {filmTime(duration)}</span>
        {clip.hasAudio !== false ? <button className="motion-reel-sound" type="button" aria-label={muted ? '开启声音' : '静音'} aria-pressed={!muted} onClick={() => { const video = videoRef.current; if (video) { video.muted = !video.muted; setMuted(video.muted); setSoundBlocked(false); } }}>{muted ? <SpeakerSlash/> : <SpeakerHigh/>}<span>{muted ? '开启声音' : '静音'}</span></button> : null}
        <button type="button" aria-label="全屏观看视频" onClick={() => { setFullscreenError(false); if (!playerRef.current?.requestFullscreen) { setFullscreenError(true); return; } void playerRef.current.requestFullscreen().catch(() => setFullscreenError(true)); }}><ArrowsOut/></button>
      </div>
    </div>
    {fullscreenError ? <p className="motion-reel-help" role="status">浏览器暂不支持全屏，可以继续在这里观看。</p> : null}
  </div>;
}
