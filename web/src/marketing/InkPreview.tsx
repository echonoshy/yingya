import { useEffect, useRef, useState } from 'react';
import { ArrowBendDownRight, ArrowsOut, CheckCircle, Cursor, Pause, Play } from '@phosphor-icons/react';
import shot0 from '../assets/scenery/ink-ai-shot-0.webp';
import shot4 from '../assets/scenery/ink-ai-shot-4.webp';
import shot8 from '../assets/scenery/ink-ai-shot-8.webp';
import preview from '../assets/scenery/ink-ai-preview.mp4';

const duration = 12;
const shots = [{ time: 0, image: shot0 }, { time: 4, image: shot4 }, { time: 8, image: shot8 }];
const timecode = (time: number) => `00:${Math.floor(time).toString().padStart(2, '0')}`;

/** A real, on-demand landscape clip. No autoplay or simulated generation status. */
export function InkPreview({ suspended }: { suspended: boolean }) {
  const playerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState('');
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    const player = playerRef.current;
    if (!video || !player) return;
    setCanExpand(Boolean(document.fullscreenEnabled && player.requestFullscreen));
    const pause = () => video.pause();
    const onVisibility = () => { if (document.hidden) pause(); };
    const observer = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) pause(); });
    observer.observe(player);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', pause);
    return () => { pause(); observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); window.removeEventListener('blur', pause); };
  }, []);

  useEffect(() => { if (suspended) videoRef.current?.pause(); }, [suspended]);

  async function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) { video.pause(); return; }
    setError('');
    try {
      if (video.ended) video.currentTime = 0;
      await video.play();
    } catch { setError('暂时无法播放，请重试。'); }
  }

  function seek(time: number) {
    const video = videoRef.current;
    if (!video) return;
    const apply = () => { video.currentTime = time; setPosition(time); setStarted(true); };
    if (video.readyState >= 1) apply();
    else { video.addEventListener('loadedmetadata', apply, { once: true }); video.load(); }
  }

  async function expand() {
    try { await playerRef.current?.requestFullscreen(); }
    catch { setError('浏览器暂不支持全屏，仍可在这里播放。'); }
  }

  return <div className="ink-preview" ref={playerRef} role="group" aria-label="山水动态示例预览">
    <div className="ink-preview-frame">
      <video ref={videoRef} className={started ? 'has-started' : ''} src={preview} preload="none" playsInline muted aria-label="独眼摄影怪推车、三眼收音怪蹦跳、云朵飞行怪骑纸飞机的水墨动画，无声视频"
        onPlay={() => { setPlaying(true); setStarted(true); }} onPause={() => setPlaying(false)}
        onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onEnded={() => setPlaying(false)}
        onError={() => setError('暂时无法加载预览，请重试或观看演示。')} />
      <span className="ink-frame-corner ink-frame-corner--tl" aria-hidden="true" /><span className="ink-frame-corner ink-frame-corner--tr" aria-hidden="true" />
      <span className="ink-frame-corner ink-frame-corner--bl" aria-hidden="true" /><span className="ink-frame-corner ink-frame-corner--br" aria-hidden="true" />
      <button className="ink-preview-focus" type="button" aria-label={playing ? '暂停选中画面' : '播放选中画面'} onClick={() => void togglePlayback()}><Cursor weight="fill" aria-hidden="true" /></button>
      <ArrowBendDownRight className="ink-preview-flow" aria-hidden="true" />
      <div className="ink-preview-shots" aria-label="预览画面定位">
        {shots.map(({ time, image }, index) => <button key={time} type="button" aria-label={`跳转到第 ${time} 秒画面`} aria-pressed={Math.min(2, Math.floor(position / 4)) === index} onClick={() => seek(time)}>
          <img src={image} alt="" />
        </button>)}
      </div>
    </div>
    <div className="ink-preview-controls">
      <button type="button" aria-label={playing ? '暂停山水预览' : '播放山水预览'} onClick={() => void togglePlayback()}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
      <span className="ink-preview-time">{timecode(position)} <span>/ {timecode(duration)}</span></span>
      <input type="range" min="0" max={duration} step="0.1" value={Math.min(position, duration)} aria-label="山水预览播放进度" aria-valuetext={`${timecode(position)}，共 ${timecode(duration)}`} onChange={event => seek(Number(event.target.value))} />
      <span className="ink-preview-status"><CheckCircle weight="fill" /><span>{playing ? '正在播放' : '动态示例'}</span></span>
      {canExpand ? <button type="button" aria-label="全屏查看山水预览" onClick={() => void expand()}><ArrowsOut /></button> : null}
    </div>
    {error ? <p className="ink-preview-error" role="alert">{error}</p> : null}
  </div>;
}
