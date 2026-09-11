import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, ArrowsClockwise, Check, FilmStrip, ImageSquare, Pause, Play, Plus, TextT, Timer, X } from '@phosphor-icons/react';
import { BrandLogo } from '../BrandLogo';
import { examples, featuredIntro, posterPath, videoPath, type VideoExample } from '../examples';
import './prototype.css';

const originalTitle = '去看看，更大的世界。';
const alternativeTitle = '下一站，山野之间。';
const startingPrompt = '用我提供的图片和品牌文案，制作一支 12 秒的品牌短片。用大画面开场，让文字随节奏出现，最后呈现品牌。先给出制作方案供我确认。';
const works = [examples.find(e => e.id === 'yingya-brand')!, examples.find(e => e.id === 'yingya-type')!, examples.find(e => e.id === 'website-story')!];
const workCopy = [
  ['图片 + 品牌文案', '让一组图片，有了故事。'],
  ['一句品牌主张', '让一句话，有了节奏。'],
  ['网页内容 + 截图', '让一个页面，动起来。'],
];

function InteractiveDemo({ onStart, suspended }: { onStart: (prompt: string) => void; suspended: boolean }) {
  const [large, setLarge] = useState(false);
  const [slow, setSlow] = useState(false);
  const [title, setTitle] = useState(originalTitle);
  const [draft, setDraft] = useState('');
  const [before, setBefore] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(2);
  const [status, setStatus] = useState('选一句修改，看看画面怎么变。');
  const duration = !before && slow ? 8 : 6;
  const changed = large || slow || title !== originalTitle;
  useEffect(() => { if (suspended) setPlaying(false); }, [suspended]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = 0;
    const tick = (time: number) => {
      if (previous) setElapsed(value => Math.min(duration, value + (time - previous) / 1000));
      previous = time;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const stopHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener('visibilitychange', stopHidden);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', stopHidden); };
  }, [playing, duration]);
  useEffect(() => { if (elapsed >= duration) setPlaying(false); }, [elapsed, duration]);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const stop = () => setPlaying(false);
    media.addEventListener('change', stop);
    return () => media.removeEventListener('change', stop);
  }, []);
  function modify(kind: 'size' | 'pace' | 'copy') {
    setBefore(false);
    setElapsed(2);
    setPlaying(false);
    if (kind === 'size') { setLarge(v => !v); setStatus(large ? '标题已恢复原大小。' : '标题放大了，画面与文案保持不变。'); }
    if (kind === 'pace') { setSlow(v => !v); setElapsed(2); setStatus(slow ? '已恢复 6 秒节奏。' : '画面多停留 2 秒。点击播放，感受慢一点的节奏。'); }
    if (kind === 'copy') { const next = title === alternativeTitle ? originalTitle : alternativeTitle; setTitle(next); setStatus(`文案已换成“${next}”`); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setTitle(draft.trim()); setBefore(false); setElapsed(2); setPlaying(false); setStatus('已换上你的文案，字号和节奏都保留。'); setDraft('');
  }
  function reset() { setLarge(false); setSlow(false); setTitle(originalTitle); setBefore(false); setPlaying(false); setElapsed(2); setStatus('已恢复原版，可以换一种改法。'); }
  const shownTitle = before ? originalTitle : title;
  const phase = elapsed < duration * .72 ? 'opening' : 'closing';
  return <section id="try-it" className="hp-demo" aria-label="一句话修改画面的交互演示">
    <div className="hp-demo-bar"><span><FilmStrip size={18} /> 山野之间 · 品牌短片</span><span className="hp-demo-tag">交互演示</span></div>
    <div className="hp-demo-body">
      <div className="hp-director">
        <span className="hp-eyebrow">你来做一次导演</span>
        <h2>动动嘴，<br />画面就不一样。</h2>
        <p>点一句试试，<br className="hp-desktop-break" />把这支短片改成你喜欢的样子。</p>
        <div className="hp-commands">
          <button onClick={() => modify('size')} aria-pressed={large}><TextT /><span>标题大一点</span>{large ? <Check /> : <ArrowUpRight />}</button>
          <button onClick={() => modify('pace')} aria-pressed={slow}><Timer /><span>节奏慢一点</span>{slow ? <Check /> : <ArrowUpRight />}</button>
          <button onClick={() => modify('copy')} aria-pressed={title !== originalTitle}><ArrowsClockwise /><span>换一句文案</span>{title !== originalTitle ? <Check /> : <ArrowUpRight />}</button>
        </div>
        <form onSubmit={submit} className="hp-title-form"><label htmlFor="hp-title-input">也可以，写下你自己的标题</label><div><input id="hp-title-input" value={draft} onChange={e => setDraft(e.target.value)} maxLength={24} placeholder="比如：周末，去山里。" /><button type="submit" disabled={!draft.trim()} aria-label="应用我的标题" title="应用我的标题"><ArrowRight /></button></div></form>
        <p className="hp-demo-disclosure">预设效果演示，无需登录。</p>
      </div>
      <div className="hp-preview">
        <div className="hp-preview-top"><span><span className="hp-status-dot" /> {before ? '原版画面' : changed ? '修改后的画面' : '原版画面'}</span><div className="hp-compare" aria-label="对比修改效果"><button aria-pressed={!before} onClick={() => setBefore(false)}>当前</button><button aria-pressed={before} onClick={() => { setBefore(true); setElapsed(v => Math.min(v, 6)); }}>原版</button></div></div>
        <div className={`hp-stage ${large && !before ? 'hp-stage-large' : ''}`} data-phase={phase}>
          <img src="/marketing/posters/yingya-landscape.jpg" alt="日落时分，站在山巅眺望云海的人" fetchPriority="high" />
          <div className="hp-film-brand"><span>山野之间</span><span>给每一次出发</span></div>
          <div className="hp-film-title" key={phase} style={{ opacity: elapsed < .5 ? .3 + elapsed * 1.4 : 1 }}><span>{phase === 'closing' ? '让想法，有画面。' : shownTitle}</span><small>{phase === 'closing' ? '映芽 · 用对话完成动画视频' : '把日常留在身后，把自己交给山野。'}</small></div>
          <div className="hp-film-footer"><span>一组图片，也能讲一个故事。</span><span>{phase === 'closing' ? '02' : '01'} / 02</span></div>
        </div>
        <div className="hp-player"><button aria-label={playing ? '暂停演示预览' : '播放演示预览'} onClick={() => { if (elapsed >= duration) setElapsed(0); setPlaying(v => !v); }}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><span>{Math.floor(elapsed).toString().padStart(2, '0')} / {duration.toString().padStart(2, '0')} 秒</span><input aria-label="演示播放进度" type="range" min="0" max={duration} step="0.05" value={elapsed} onChange={e => { setElapsed(Number(e.target.value)); setPlaying(false); }} /><button aria-label="恢复所有修改" title="恢复所有修改" onClick={reset}><ArrowsClockwise /></button></div>
        <div className="hp-feedback" role="status"><Check size={16} /><span>{status}</span></div>
      </div>
    </div>
    <div className="hp-demo-bottom"><span>你的内容，也可以这样做。</span><button onClick={() => onStart(`${startingPrompt}${title !== originalTitle ? `片中标题使用“${title}”。` : ''}${large ? '使用醒目的大标题。' : ''}${slow ? '画面多停留两秒，节奏舒缓。' : ''}`)}>用我的内容开始 <ArrowRight /></button></div>
  </section>;
}

type Overlay = { kind: 'video'; example: VideoExample } | { kind: 'start'; prompt: string };
function PrototypeDialog({ value, onClose, onStart }: { value: Overlay; onClose: () => void; onStart: (prompt: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [prompt, setPrompt] = useState(value.kind === 'start' ? value.prompt : '');
  const [planned, setPlanned] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);
  async function copy() { try { await navigator.clipboard.writeText(prompt); setNotice('需求已复制。进入工作台后粘贴即可继续。'); } catch { setNotice('无法访问剪贴板，请选中上方需求手动复制。'); } }
  return <dialog ref={ref} className="hp-dialog" aria-labelledby="hp-dialog-title" onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <header><div><span className="hp-eyebrow">{value.kind === 'video' ? value.example.source : '从你的内容开始'}</span><h2 id="hp-dialog-title">{value.kind === 'video' ? value.example.title : planned ? '先把制作方案，说清楚。' : '你的下一支作品，想讲什么？'}</h2></div><button className="hp-icon-button" onClick={onClose} aria-label="关闭弹窗"><X /></button></header>
    {value.kind === 'video' ? <><video src={videoPath(value.example.id)} poster={posterPath(value.example.id)} controls autoPlay playsInline aria-label={value.example.title} onError={() => setNotice('视频暂时无法播放，仍可使用下方创作思路。')} /><div className="hp-dialog-content"><p>{value.example.description}</p><p className="hp-prompt-quote">{value.example.prompt}</p><button className="hp-primary" onClick={() => onStart(value.example.prompt)}>用这个思路创作 <ArrowRight /></button></div></> : <div className="hp-dialog-content"><p className="hp-demo-disclosure">创作入口原型 · 不会提交制作任务</p><label className="hp-prompt-label" htmlFor="hp-create-prompt">创作需求</label><textarea id="hp-create-prompt" value={prompt} onChange={e => { setPrompt(e.target.value); setPlanned(false); }} placeholder="介绍一下你的内容、用途和想要的感觉…" rows={5} />{planned ? <><ol className="hp-plan"><li><strong>先整理内容</strong><span>补充文案、图片或网页，确认需要表达的重点。</span></li><li><strong>再确认方案</strong><span>一起确定开场、内容顺序与结尾，确认后再制作。</span></li><li><strong>预览，再改到满意</strong><span>直接说出文字、画面与节奏的修改，最后导出成片。</span></li></ol><div className="hp-dialog-actions"><button className="hp-secondary" onClick={() => void copy()}>复制创作需求</button><a className="hp-primary" href="/app">进入工作台 <ArrowRight /></a></div></> : <button className="hp-primary" disabled={!prompt.trim()} onClick={() => setPlanned(true)}>看看接下来怎么做 <ArrowRight /></button>}</div>}
    <p className="hp-dialog-notice" role="status">{notice}</p>
  </dialog>;
}

export function HomePrototype() {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  function open(value: Overlay) {
    if (!overlay && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    setOverlay(value);
  }
  const start = (prompt: string) => open({ kind: 'start', prompt });
  function close() {
    setOverlay(null);
    requestAnimationFrame(() => {
      const target = openerRef.current?.isConnected ? openerRef.current : startButtonRef.current;
      target?.focus({ preventScroll: true });
    });
  }
  useEffect(() => { const previous = document.title; document.title = '映芽 · 首页交互原型'; return () => { document.title = previous; }; }, []);
  return <div className="marketing-page hp-page"><a className="marketing-skip" href="#hp-main">跳到主要内容</a>
    <header className="hp-header"><div className="hp-container hp-header-inner"><BrandLogo /><nav aria-label="原型首页导航"><a href="#try-it">试着改一改</a><a href="#hp-works">作品灵感</a><a href="#hp-how">如何创作</a></nav><div className="hp-header-actions"><a href="/app">登录 <ArrowUpRight /></a><button className="hp-primary" onClick={() => start(startingPrompt)}>开始创作 <ArrowRight /></button></div></div></header>
    <main id="hp-main" tabIndex={-1}>
      <section className="hp-hero hp-container"><span className="hp-eyebrow">映芽 · 对话式动画视频制作</span><h1>把内容，做成会动的视频。<br /><span>再用一句话，改到你喜欢。</span></h1><p>文案、网页、图片，都能成为开场。<br className="hp-mobile-break" />你提供想法，映芽帮你编排成片。</p><div className="hp-hero-actions"><button ref={startButtonRef} className="hp-primary" onClick={() => start(startingPrompt)}>开始我的作品 <ArrowRight /></button><button className="hp-text-button" onClick={() => open({ kind: 'video', example: featuredIntro })}><Play weight="fill" /> 66 秒认识映芽</button></div><a className="hp-try-link" href="#try-it">先在下面，试着改一改 <ArrowDown size={15} /></a></section>
      <div className="hp-container"><InteractiveDemo onStart={start} suspended={Boolean(overlay)} /></div>
      <section id="hp-works" className="hp-container hp-works"><div className="hp-section-heading"><div><span className="hp-eyebrow">从这些灵感开始</span><h2>你手里的内容，<br className="hp-mobile-break" />还有另一种表达。</h2></div><p>看看作品，也想想你的下一支。</p></div><div className="hp-work-grid">{works.map((work, index) => <article className="hp-work" key={work.id}><button className="hp-work-cover" onClick={() => open({ kind: 'video', example: work })} aria-label={`播放：${work.title}`}><img src={posterPath(work.id)} alt={work.title} loading="lazy" width="960" height="540" /><span><Play weight="fill" /></span></button><div className="hp-work-meta"><span>{workCopy[index][0]}</span><small>{work.source === '映芽原创演示' ? '映芽原创' : '效果参考'}</small></div><h3>{workCopy[index][1]}</h3><button className="hp-work-start" onClick={() => start(work.prompt)}>用这个思路创作 <ArrowUpRight /></button></article>)}</div></section>
      <section id="hp-how" className="hp-how"><div className="hp-container"><div className="hp-section-heading"><div><span className="hp-eyebrow">创作的每一步，都由你决定</span><h2>有想法就开始。<br />有修改就直接说。</h2></div><p>从第一句需求，到最后一次调整，<br />作品始终掌握在你手里。</p></div><div className="hp-how-grid">{[['01', '带上你的内容', '一段文案、一个网页，或一组图片。告诉映芽，你想讲什么。'], ['02', '一起把画面做好', '先确认方案，再看预览。“这里放大一点”“让画面多停两秒”，直接说。'], ['03', '导出，也能继续', '满意后导出 MP4。项目会保留，下次有新想法，接着改。']].map(([n, title, copy]) => <div key={n}><span className="hp-step-number">{n}</span><h3>{title}</h3><p>{copy}</p></div>)}</div></div></section>
      <section className="hp-container hp-faq"><h2>开始前的小问题</h2><div>{[['需要会剪辑或写代码吗？', '不需要。你负责提供内容、确认方案与提出修改意见，映芽通过对话完成动画和素材编排。'], ['这里的演示，是实时生成的吗？', '首页交互使用预设效果，让你直接体验修改方式。真实作品会在工作台中，根据你的内容、素材与确认的方案制作。'], ['我可以做什么样的视频？', '产品演示、知识动画、数据故事和品牌短片都适合。以文字、图形、界面与已有素材的动画编排为主；实拍镜头需要提供相应素材。']].map(([q,a]) => <details key={q}><summary>{q}<Plus aria-hidden="true" /></summary><p>{a}</p></details>)}</div></section>
      <section className="hp-closing hp-container"><ImageSquare size={28} weight="light" /><h2>下一支作品，<br />从你的一个想法开始。</h2><button className="hp-primary" onClick={() => start('')}>说说我的想法 <ArrowRight /></button><p>确认方案 · 预览修改 · 导出成片</p></section>
    </main><footer className="hp-footer hp-container"><BrandLogo /><span>把内容，做成会动的视频。</span><a href="/">查看当前首页 <ArrowUpRight /></a></footer>
    {overlay ? <PrototypeDialog key={overlay.kind === 'video' ? overlay.example.id : 'start'} value={overlay} onClose={close} onStart={start} /> : null}
  </div>;
}
