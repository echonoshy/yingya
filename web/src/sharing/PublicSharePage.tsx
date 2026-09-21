import { StudioArtwork } from "../components/StudioTheme";
import { useEffect, useState } from 'react';
import { ArrowClockwise, CircleNotch, LinkBreak, Play } from '@phosphor-icons/react';
import { publicSchema, shareDate, type PublicVideo } from './api';
import './sharing.css';

export function PublicSharePage() {
  const token = window.location.pathname.split('/')[2] || '';
  const [video, setVideo] = useState<PublicVideo | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [retry, setRetry] = useState(0), [playError, setPlayError] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setVideo(null); setError(''); setPlayError(false);
    void (async () => {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('分享不存在或已失效');
      const response = await fetch(`/api/public/shares/${token}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || '暂时无法打开分享，请稍后重试');
      const value = publicSchema.parse(body); if (!controller.signal.aborted) { setVideo(value); document.title = `${value.title} · 映芽`; }
    })().catch(error => { if (!controller.signal.aborted) setError(error instanceof DOMException && error.name === "TimeoutError" ? "分享读取超时，请重试" : error instanceof Error ? error.message : '暂时无法打开分享'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, retry]);
  return <div className="public-share"><header><a href="/" className="share-brand"><img src="/brand/yingya-ghost.png" alt=""/><b>映芽</b></a><div className="studio-share-brand"><StudioArtwork variant="workspace"/><span>视频分享</span></div></header><main>
    {loading ? <div className="public-share-state" role="status"><CircleNotch className="spin"/><h1>正在打开视频…</h1></div> : error ? <div className="public-share-state"><LinkBreak/><h1>暂时无法观看</h1><p role="alert">{error}</p><p>如果链接已过期或取消，请联系分享者获取新的链接。</p><button onClick={() => setRetry(value => value + 1)}><ArrowClockwise/>重新打开</button></div> : video ? <>
      <div className="public-share-heading"><h1>{video.title}</h1><p>{video.version} · {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}<span>{video.expiresAt ? `有效至 ${shareDate(video.expiresAt)}` : '长期有效'}</span></p></div>
      <div className="public-video-stage"><video key={retry} src={video.videoUrl} poster={video.posterUrl} controls playsInline preload="metadata" aria-label={video.title} onError={() => setPlayError(true)} style={{ aspectRatio: `${video.width} / ${video.height}` }}/></div>
      {playError ? <p className="share-error" role="alert">视频暂时无法播放，链接可能已失效或访问较多。<button onClick={() => setRetry(value => value + 1)}><ArrowClockwise/>重新加载</button></p> : <p className="public-play-hint"><Play/>点击播放，可使用播放器全屏观看。</p>}
    </> : null}
  </main><footer>用映芽，把内容做成会动的视频。<a href="/">了解映芽</a></footer></div>;
}
