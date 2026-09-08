import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Copy, Pause, Play, Plus, X } from '@phosphor-icons/react';
import { categories, examples, posterPath, videoPath, type Category, type VideoExample } from './examples';
import './marketing.css';

const sourceUrl = 'https://hyperframes.heygen.com/examples';

function Brand() {
  return <a className="marketing-brand" href="/" aria-label="映芽首页"><img src="/brand/yingya-ghost.png" alt="" width="40" height="40" /><span>映芽</span></a>;
}

function HeroReel({ onOpen, suspended }: { onOpen: (example: VideoExample) => void; suspended: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const allowPlay = useRef(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let visible = false;
    const sync = () => {
      if (visible && !document.hidden && allowPlay.current && !suspendedRef.current) void video.play().catch(() => {});
      else video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); }, { threshold: 0.25 });
    observer.observe(video);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onPreferenceChange = () => { allowPlay.current = !reduced.matches; sync(); };
    reduced.addEventListener('change', onPreferenceChange);
    document.addEventListener('visibilitychange', sync);
    return () => { observer.disconnect(); reduced.removeEventListener('change', onPreferenceChange); document.removeEventListener('visibilitychange', sync); video.pause(); };
  }, []);
  useEffect(() => { if (suspended) videoRef.current?.pause(); }, [suspended]);
  function togglePlayback() {
    const video = videoRef.current;
    if (!video) return;
    allowPlay.current = video.paused;
    if (video.paused) void video.play().catch(() => setFailed(true));
    else video.pause();
  }
  return <div className="marketing-reel">
    <div className="marketing-filmstrip">
      <button className="marketing-side-film" onClick={() => onOpen(examples[1])} aria-label="播放动态文字示例">
        <img src={posterPath('yingya-type')} alt="动态文字作品画面" /><span><Play weight="fill" /> 动态文字</span>
      </button>
      <div className="marketing-main-film">
        <video ref={videoRef} src={videoPath('yingya-brand')} poster={posterPath('yingya-brand')} muted loop playsInline preload="metadata" aria-label="映芽原创品牌动效演示，无音轨" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setFailed(true)} />
        <div className="marketing-film-controls">
          <button onClick={togglePlayback} disabled={failed} aria-label={playing ? '暂停品牌演示' : '播放品牌演示'}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}<span>{failed ? '视频暂时无法播放' : playing ? '暂停演示' : '播放演示'}</span></button>
          <button onClick={() => { allowPlay.current = false; videoRef.current?.pause(); onOpen(examples[4]); }} aria-label="打开品牌短片播放器"><ArrowUpRight /><span>查看短片</span></button>
        </div>
      </div>
      <button className="marketing-side-film" onClick={() => onOpen(examples[0])} aria-label="播放产品演示示例">
        <img src={posterPath('product-promo')} alt="产品演示作品画面" /><span><Play weight="fill" /> 产品演示</span>
      </button>
    </div>
    <p className="marketing-reel-caption">品牌短片 · 动态排版与素材编排</p>
  </div>;
}

function Showcase({ onOpen }: { onOpen: (example: VideoExample) => void }) {
  const [category, setCategory] = useState<Category>('全部');
  const shown = examples.filter(example => category === '全部' || example.category === category);
  return <section className="marketing-section marketing-showcase" id="showcase" aria-labelledby="showcase-title">
    <div className="marketing-section-heading"><h2 id="showcase-title">给每一种内容，<br className="marketing-mobile-break" />一个好看的开场。</h2><p>产品演示、知识讲解、数据故事。找到适合你的表达。</p></div>
    <div className="marketing-filters" role="group" aria-label="筛选作品类型">{categories.map(value => <button key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</button>)}</div>
    <p className="marketing-sr-only" role="status">{category}，共 {shown.length} 个示例</p>
    <div className="marketing-gallery">{shown.map(example => <button className="marketing-example" key={example.id} onClick={() => onOpen(example)} aria-label={`播放：${example.title}`}>
      <div className="marketing-example-image"><img src={posterPath(example.id)} alt="" width="960" height="540" loading="lazy" /><span className="marketing-play-icon"><Play weight="fill" /></span></div>
      <div className="marketing-example-caption"><h3>{example.title}</h3><ArrowUpRight /></div><p>{example.description}</p>
    </button>)}</div>
    <p className="marketing-source">中文品牌与文字短片为映芽原创演示，其余为 <a href={sourceUrl} target="_blank" rel="noreferrer">HyperFrames 官方示例<ArrowUpRight /></a>。仅作效果参考。</p>
  </section>;
}

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
    <div className="marketing-dialog-body"><h3>你可以这样开始</h3><p className="marketing-example-prompt">{example.prompt}</p><div className="marketing-dialog-actions"><button className="marketing-secondary" onClick={() => void copyPrompt()}>{copied ? <Check /> : <Copy />}{copied ? '已复制需求' : '复制创作需求'}</button><a className="marketing-primary" href="/app">进入工作台<ArrowRight /></a></div><p className="marketing-dialog-note" role="status">{copyError ? '复制未成功，请选中上方文字手动复制。' : copied ? '需求已复制，进入工作台后粘贴，并补充你的内容或素材。' : '效果示例供参考；实际作品将根据你的内容与素材制作。'}</p></div>
  </dialog>;
}

const workflowSteps = [
  { title: '说说你想做什么', text: '提供文案、网页或素材，告诉映芽用途、画幅和风格。', user: '用这些图片，做一支 12 秒的品牌短片。', reply: '先用大画面开场，再用三句标题推进，最后呈现品牌。', label: '先把想法，说清楚。' },
  { title: '确认方案，预览修改', text: '先确认制作方案，再看动态预览。想改哪里，直接说。', user: '把第二幕的标题放大，画面多停留 2 秒。', reply: '好的，保留其他画面，调整这一幕。', label: '让想法，有画面。' },
  { title: '导出成片，继续创作', text: '确认满意后导出 MP4。保留项目，下次接着修改。', user: '这个版本可以了，导出成片。', reply: '确认导出设置后即可渲染。项目会保留，随时回来继续创作。', label: '把好内容，带给更多人。' },
];
function Workflow() {
  const [step, setStep] = useState(1);
  const active = workflowSteps[step];
  return <section className="marketing-workflow" id="workflow" aria-labelledby="workflow-title"><div className="marketing-workflow-inner">
    <div><h2 id="workflow-title">从一句想法，<br />到一支作品。</h2><div className="marketing-steps" role="group" aria-label="了解制作步骤">{workflowSteps.map((item, index) => <button key={item.title} aria-pressed={index === step} onClick={() => setStep(index)}><span className="marketing-step-number">{index + 1}</span><span><strong>{item.title}</strong><span>{item.text}</span></span></button>)}</div></div>
    <div className="marketing-conversation" aria-live="polite"><div className="marketing-conversation-label">对话修改示意</div><p className="marketing-message-user">{active.user}</p><div className="marketing-message-assistant"><img src="/brand/yingya-ghost.png" width="30" height="30" alt="映芽" /><p>{active.reply}</p></div><div className="marketing-workflow-preview"><img src="/marketing/posters/yingya-landscape.jpg" alt="品牌短片的日落山景画面" width="960" height="540" loading="lazy" /><strong key={step}>{active.label}</strong></div></div>
  </div></section>;
}

const faqs = [
  ['我需要会剪辑或写代码吗？', '不需要。你负责提供内容、确认方案和提出修改意见，映芽通过对话完成动画与素材编排。比如“把标题放大”“这个画面多停留 2 秒”，都可以直接说。'],
  ['可以制作哪些类型的视频？', '适合产品演示、知识动画、数据故事、品牌短片和网页内容介绍。以文字、图形、界面和已有素材的动画编排为主；需要实拍镜头时，请提供相应的视频素材。'],
  ['做完之后还能修改吗？', '可以。项目和草稿版本会保留，你可以回来修改文字、替换素材、调整节奏，再预览和导出新的成片。'],
];
export function MarketingPage() {
  const [selected, setSelected] = useState<VideoExample | null>(null);
  return <div className="marketing-page">
    <a className="marketing-skip" href="#main-content">跳到主要内容</a>
    <header className="marketing-header"><div className="marketing-header-inner"><Brand /><nav aria-label="首页导航"><a href="#showcase">作品灵感</a><a href="#workflow">制作流程</a><a href="#faq">常见问题</a></nav><a className="marketing-login" href="/app">登录<ArrowUpRight /></a></div></header>
    <main id="main-content" tabIndex={-1}><section className="marketing-hero" aria-labelledby="marketing-title"><div className="marketing-hero-copy"><h1 id="marketing-title">把内容，<br className="marketing-mobile-break" />做成会动的视频。</h1><p>文案、网页、素材。交给映芽，用对话完成动画视频。</p><div className="marketing-hero-actions"><a className="marketing-primary" href="/app">开始创作<ArrowRight /></a><a className="marketing-text-link" href="#showcase"><Play weight="fill" />看看作品</a></div></div><HeroReel onOpen={setSelected} suspended={Boolean(selected)} /></section>
      <Showcase onOpen={setSelected} /><Workflow />
      <section className="marketing-section marketing-faq" id="faq" aria-labelledby="faq-title"><h2 id="faq-title">开始之前，<br className="marketing-mobile-break" />你可能想问</h2><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<Plus /></summary><p>{answer}</p></details>)}</div></section>
      <section className="marketing-closing"><h2>你的下一个作品，<br className="marketing-mobile-break" />从这里开始。</h2><a className="marketing-primary" href="/app">开始创作<ArrowRight /></a></section>
    </main>
    <footer className="marketing-footer"><Brand /><p>把内容，做成会动的视频。</p><a href={sourceUrl} target="_blank" rel="noreferrer">探索 HyperFrames<ArrowUpRight /></a></footer>
    {selected ? <ExampleDialog key={selected.id} example={selected} onClose={() => setSelected(null)} /> : null}
  </div>;
}
