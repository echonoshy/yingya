import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Copy, GithubLogo, Play, X } from '@phosphor-icons/react';
import { featuredIntro, posterPath, videoPath, type VideoExample } from './examples';
import { BrandLogo as Brand } from './BrandLogo';
import { MotionGallery } from './MotionGallery';
import { WorkflowShowcase } from './WorkflowShowcase';
import { HeroPlayground } from './HeroPlayground';
import './marketing.css';
import './workshopHome.css';

function ExampleDialog({ example, onClose }: { example: VideoExample; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [mediaError, setMediaError] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    const pauseWhenHidden = () => { if (document.hidden) videoRef.current?.pause(); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => { document.removeEventListener('visibilitychange', pauseWhenHidden); dialog?.close(); if (previousFocus instanceof HTMLElement) previousFocus.focus({ preventScroll: true }); };
  }, []);
  async function copyPrompt() {
    try { await navigator.clipboard.writeText(example.prompt); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  }
  return <dialog ref={dialogRef} className="marketing-dialog" aria-labelledby="example-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>
    <header><div><p>{example.category} · {example.source}</p><h2 id="example-title">{example.title}</h2></div><button className="marketing-close" onClick={onClose} aria-label="关闭示例" autoFocus><X /></button></header>
    <video ref={videoRef} src={videoPath(example.id)} poster={posterPath(example.id)} controls autoPlay playsInline preload="metadata" aria-label={example.title} onError={() => setMediaError(true)} />
    {mediaError ? <p className="marketing-media-error" role="alert">视频暂时无法播放，请稍后重试。你仍可复制下方创作需求。</p> : null}
    <div className="marketing-dialog-body"><h3>创作需求</h3><p className="marketing-example-prompt">{example.prompt}</p><div className="marketing-dialog-actions"><button className="marketing-secondary" onClick={() => void copyPrompt()}>{copied ? <Check /> : <Copy />}{copied ? '已复制需求' : '复制创作需求'}</button><a className="marketing-primary" href="/app">进入工作台<ArrowRight /></a></div><p className="marketing-dialog-note" role="status">{copyError ? '复制未成功，请选中上方文字手动复制。' : copied ? '需求已复制，进入工作台后粘贴，并补充你的内容或素材。' : '效果示例供参考；实际作品将根据你的内容与素材制作。'}</p></div>
  </dialog>;
}


export function MarketingPage() {
  const [selected, setSelected] = useState<VideoExample | null>(null);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return <div className="marketing-page workshop-home">
    <a className="marketing-skip" href="#main-content">跳到主要内容</a>
    <header className="marketing-header"><div className="marketing-header-inner"><Brand /><a className="marketing-github" href="https://github.com/echonoshy/yingya" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看映芽源码"><GithubLogo weight="fill" /><span>GitHub</span></a><a className="marketing-login" href="/app">登录</a></div></header>
    <main id="main-content" tabIndex={-1}>
      <section className="marketing-hero" aria-labelledby="marketing-title">
        <div className="marketing-hero-copy"><h1 id="marketing-title" aria-label="对话式视频制作">{Array.from("对话式视频制作").map((character, index) => <span key={index} aria-hidden="true">{character}</span>)}</h1><div className="marketing-hero-actions"><a className="marketing-primary" href="/app">开始创作<ArrowRight /></a><button className="marketing-secondary workshop-watch" onClick={() => setSelected(featuredIntro)}><Play weight="fill" />观看演示</button></div></div>
        <div className="studio-marketing-art"><HeroPlayground/></div>
      </section>
      <MotionGallery onOpen={setSelected} suspended={Boolean(selected)} reduced={reduced} />
      <WorkflowShowcase />
    </main>
    <footer className="workshop-footer"><div><Brand /><span aria-hidden="true">|</span><a className="marketing-github" href="https://github.com/echonoshy/yingya" target="_blank" rel="noopener noreferrer"><GithubLogo weight="fill" />GitHub</a></div></footer>
    {selected ? <ExampleDialog key={selected.id} example={selected} onClose={() => setSelected(null)} /> : null}
  </div>;
}
