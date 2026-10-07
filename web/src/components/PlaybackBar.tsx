import { SelectControl } from "./SelectControl";
import { useEffect, useId, useState, type RefObject } from 'react';
import { ArrowsOut, Pause, Play, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import './playback-bar.css';

const clock = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export function PlaybackBar({ videoRef, sourceKey }: { videoRef: RefObject<HTMLVideoElement | null>; sourceKey: string }) {
  const hintId = useId();
  const [state, setState] = useState({ time: 0, duration: 0, paused: true, muted: false, volume: 1, rate: 1 });
  const [error, setError] = useState('');
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => setState({ time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0, paused: video.paused, muted: video.muted, volume: video.volume, rate: video.playbackRate });
    const events = ['loadedmetadata', 'durationchange', 'timeupdate', 'play', 'pause', 'ended', 'volumechange', 'ratechange'];
    events.forEach(event => video.addEventListener(event, sync));
    video.controls = false;
    setError(''); sync();
    return () => { events.forEach(event => video.removeEventListener(event, sync)); video.controls = true; };
  }, [videoRef, sourceKey]);
  async function toggle() {
    const video = videoRef.current;
    if (!video) return;
    setError('');
    if (video.paused) { try { await video.play(); } catch { setError('暂时无法播放，请重新加载视频'); } }
    else video.pause();
  }
  async function fullscreen() {
    const target = videoRef.current?.closest('.preview-stage-shell');
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await target?.requestFullscreen(); }
    catch { setError('此浏览器暂不支持全屏播放'); }
  }
  return <div className="playback-bar" role="group" aria-label="视频播放控制" tabIndex={0} aria-describedby={hintId} onKeyDown={event => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const video = videoRef.current;
    if (!video || !state.duration) return;
    const key = event.key.toLowerCase();
    if (![' ', 'k', 'arrowleft', 'arrowright', 'm', 'f'].includes(key)) return;
    event.preventDefault();
    if (key === ' ' || key === 'k') void toggle();
    else if (key === 'm') video.muted = !video.muted;
    else if (key === 'f') void fullscreen();
    else video.currentTime = Math.max(0, Math.min(state.duration, video.currentTime + (key === 'arrowleft' ? -5 : 5)));
  }}>
    <span id={hintId} className="sr-only">空格播放或暂停，左右方向键前后跳转五秒，M 静音，F 全屏</span>
    <button type="button" aria-label={state.paused ? '播放视频' : '暂停视频'} onClick={() => void toggle()} disabled={!state.duration}>{state.paused ? <Play weight="fill"/> : <Pause weight="fill"/>}</button>
    <time className="playback-time">{clock(state.time)}<span> / {clock(state.duration)}</span></time>
    <input className="playback-seek" type="range" aria-label="视频播放位置" aria-valuetext={`${clock(state.time)}，共 ${clock(state.duration)}`} min={0} max={state.duration || 1} step={.05} value={state.time} disabled={!state.duration} onChange={event => { const video = videoRef.current; if (video) { video.pause(); video.currentTime = Number(event.target.value); } }} style={{ '--played': `${state.duration ? state.time / state.duration * 100 : 0}%` } as React.CSSProperties}/>
    <SelectControl aria-label="播放速度" value={state.rate} onChange={event => { if (videoRef.current) videoRef.current.playbackRate = Number(event.target.value); }}>{[.5, 1, 1.5, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}</SelectControl>
    <button type="button" aria-label={state.muted || state.volume === 0 ? '开启视频声音' : '静音视频'} onClick={() => { const video = videoRef.current; if (video) { video.muted = !video.muted; if (video.volume === 0) { video.volume = .7; video.muted = false; } } }}>{state.muted || state.volume === 0 ? <SpeakerSlash/> : <SpeakerHigh/>}</button>
    <button type="button" aria-label="全屏播放" onClick={() => void fullscreen()}><ArrowsOut/></button>
    {error ? <p className="playback-error" role="alert">{error}</p> : null}
  </div>;
}
