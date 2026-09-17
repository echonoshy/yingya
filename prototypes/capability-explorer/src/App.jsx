import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp, ArrowsClockwise, CaretDown, CaretRight, Check, CheckCircle, Cube, DownloadSimple, FilmSlate, FolderSimple, Images, Info, MagnifyingGlass, Pause, Play, Plus, SlidersHorizontal, UploadSimple, UserCircle, X } from '@phosphor-icons/react';
import { capabilities, categories } from './capabilities';

function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; ref.current.showModal(); return () => previous?.focus(); }, []);
  return <dialog ref={ref} className="cap-modal" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><header><h2>{title}</h2><button className="cap-icon" aria-label="关闭弹窗" onClick={onClose}><X /></button></header>{children}</dialog>;
}

function EffectPreview({ capability, variant }) {
  const [live, setLive] = useState(false), [ready, setReady] = useState(false), [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [error, setError] = useState(''), [width, setWidth] = useState(0);
  const container = useRef(null), frame = useRef(null);
  useEffect(() => { const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width)); observer.observe(container.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    function receive(event) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === 'demo-ready') { setReady(true); setError(''); }
      if (event.data?.type === 'demo-state') { setTime(event.data.time); setPlaying(event.data.playing); }
      if (event.data?.type === 'demo-error') { setError('示例未能载入，请重试或选择其他效果。'); setPlaying(false); }
    }
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, []);
  function send(action, value) { frame.current?.contentWindow?.postMessage({ type: 'demo-control', action, value }, location.origin); }
  function play() { if (!live) { setLive(true); setReady(false); setTime(0); return; } send(playing ? 'pause' : 'play'); }
  return <div className="cap-effect-preview"><div className="cap-preview-stage" ref={container}>
    {live ? <iframe ref={frame} title={`${capability.name}组件运行示例`} src={`/demo/index.html?component=${capability.id}&variant=${variant}`} style={{ transform: `scale(${width / 1280})` }} /> : <img src={capability.image} alt={capability.alt} />}
    {!live && capability.id === 'model-stage' ? <span className="cap-example-tag">概念效果图</span> : null}
    {live && !ready && !error ? <span className="cap-preview-loading" role="status">正在载入组件…</span> : null}
  </div>{capability.id === 'infographic' ? <p className="cap-preview-note"><Info />静态布局参考，实际动画根据内容编排。</p> : <><div className="cap-player-controls"><button className="cap-icon" onClick={play} disabled={live && !ready && !error} aria-label={playing ? '暂停示例' : '播放示例'}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button><span className="cap-time">00:{String(Math.floor(time)).padStart(2, '0')} / 00:06</span><input type="range" min="0" max="6" step="0.05" value={time} disabled={!ready} onChange={event => send('seek', Number(event.target.value))} aria-label="示例播放位置" /><button className="cap-icon" aria-label="重新播放示例" disabled={!ready} onClick={() => { send('seek', 0); send('play'); }}><ArrowsClockwise /></button></div>{capability.id === 'model-stage' ? <p className="cap-preview-note">播放时使用仓库的几何模型；耳机为概念图。</p> : null}</>}
  {error ? <p className="cap-error" role="alert">{error}<button onClick={() => { setLive(false); setError(''); }}>重试</button></p> : null}</div>;
}

export function App() {
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 1099px)').matches);
  const [category, setCategory] = useState('全部'), [query, setQuery] = useState(''), [searchOpen, setSearchOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(() => matchMedia('(min-width: 1100px)').matches ? 'model-stage' : null), [variant, setVariant] = useState(0);
  const [applied, setApplied] = useState(null), [prompt, setPrompt] = useState(''), [ratio, setRatio] = useState('16:9'), [files, setFiles] = useState([]);
  const [modal, setModal] = useState(null), [notice, setNotice] = useState(''), [accountOpen, setAccountOpen] = useState(false), [formError, setFormError] = useState('');
  const composer = useRef(null), upload = useRef(null), detailRef = useRef(null), returnFocus = useRef(null);
  const selected = capabilities.find(item => item.id === selectedId), method = capabilities.find(item => item.id === applied?.id);
  const filtered = capabilities.filter(item => (category === '全部' || item.categories.includes(category)) && `${item.name} ${item.description} ${item.provider}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { const media = matchMedia('(max-width: 1099px)'); const sync = () => setNarrow(media.matches); media.addEventListener('change', sync); return () => media.removeEventListener('change', sync); }, []);
  useEffect(() => { if (!narrow || !selectedId) return; const previous = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = previous; }; }, [narrow, selectedId]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4200); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (!selectedId) return;
    if (matchMedia('(max-width: 1099px)').matches) detailRef.current?.querySelector('button')?.focus();
    function keyboard(event) {
      if (document.querySelector('dialog[open]')) return;
      if (event.key === 'Escape') closeDetails();
      if (event.key !== 'Tab' || !matchMedia('(max-width: 1099px)').matches) return;
      const controls = [...detailRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), summary, a[href]')];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
  }, [selectedId]);
  function closeDetails() { setSelectedId(null); requestAnimationFrame(() => returnFocus.current?.focus()); }
  function openDetails(item, event) { returnFocus.current = event.currentTarget; setSelectedId(item.id); setVariant(0); }
  function choose() {
    setApplied({ id: selected.id, variant, label: selected.variants[variant] }); setFormError(''); setSelectedId(null);
    setNotice(`已选择「${selected.name}」，${selected.id === 'model-stage' ? '请添加模型并描述制作要求' : '可以继续补充内容'}`);
    requestAnimationFrame(() => { composer.current?.focus(); composer.current?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); });
  }
  function addFiles(list) {
    const additions = Array.from(list ?? []); setFiles(current => [...current, ...additions.filter(file => !current.some(item => item.name === file.name && item.size === file.size))]); setFormError('');
    if (additions.length) setNotice(`已添加 ${additions.length} 个本地文件，仅在此预览中使用`);
  }
  function prepare(event) {
    event.preventDefault();
    if (!prompt.trim() && !files.length) { setFormError('请描述要制作的内容，或添加素材。'); composer.current?.focus(); return; }
    if (applied?.id === 'model-stage' && !files.some(file => /\.glb$/i.test(file.name))) { setFormError('3D 展示需要已有模型，请先添加 GLB 文件；也可以移除制作方式，继续描述想法。'); return; }
    setFormError(''); setModal('plan');
  }
  function saveBrief() {
    const brief = { prototype: true, submitted: false, prompt: prompt.trim(), aspectRatio: ratio, capability: applied ? { id: applied.id, name: method.name, treatment: applied.label, source: method.provider } : null, files: files.map(file => ({ name: file.name, size: file.size })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = '映芽-创作要求预览.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('创作要求已下载，未提交生成任务');
  }
  function reset() { setPrompt(''); setApplied(null); setFiles([]); setFormError(''); setModal(null); setSelectedId(null); setCategory('全部'); setQuery(''); composer.current?.focus(); }
  return <div className={`cap-app ${selected ? 'cap-app--detail' : ''}`}>
    <aside className="cap-nav" inert={narrow && Boolean(selected)}><a className="cap-brand" href="#" onClick={event => { event.preventDefault(); reset(); }} aria-label="映芽创作首页"><img src="/assets/yingya-ghost.png" alt="" /><b>映芽</b></a><button className="cap-new cap-primary" onClick={reset}><Plus />新建视频</button><nav aria-label="主要导航"><button className="cap-nav-active" aria-current="page" onClick={() => { setModal(null); setCategory('全部'); }}><FilmSlate />视频创作</button><button onClick={() => setModal('library')}><Images />素材工坊</button></nav><div className="cap-account"><span className="cap-prototype-label">独立交互预览</span>{accountOpen ? <div className="cap-account-popover"><b>预览模式</b><p>可以体验界面和组件，不会创建线上任务。</p></div> : null}<button aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><UserCircle weight="fill" /><span>创作账号</span><CaretRight /></button></div></aside>
    <main className="cap-main" inert={narrow && Boolean(selected)}><header className="cap-home-heading"><h1>把内容，做成会动的视频。</h1><p>从素材出发，也可以先选一种表现方式。</p></header>
      <form className="cap-composer" onSubmit={prepare} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
        {method ? <div className="cap-method-chip"><Cube /><span>制作方式：{method.name} · {applied.label}</span><button type="button" aria-label="移除制作方式" onClick={() => { setApplied(null); setFormError(''); }}><X /></button></div> : null}
        <label className="cap-sr" htmlFor="creation-prompt">描述你想制作的视频</label><textarea id="creation-prompt" ref={composer} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述你想制作的视频，或先上传素材…" />
        {files.length ? <div className="cap-file-chips">{files.map((file, index) => <span key={`${file.name}-${index}`}><FolderSimple /><span title={file.name}>{file.name}</span><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X /></button></span>)}</div> : null}
        <div className="cap-composer-toolbar"><div><button type="button" onClick={() => upload.current?.click()}><UploadSimple /><span>上传素材</span></button><button type="button" aria-label="从素材库选择" onClick={() => setModal('library')}><FolderSimple /><span>从素材库选择</span></button></div><div><label className="cap-ratio"><span className="cap-sr">视频画幅</span><select value={ratio} onChange={event => setRatio(event.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option></select><CaretDown /></label><button className="cap-send cap-primary" type="submit" aria-label="预览制作方案" disabled={!prompt.trim() && !files.length}><ArrowUp /></button></div></div><input type="file" ref={upload} multiple hidden onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
      </form>{formError ? <p className="cap-error" role="alert">{formError}</p> : null}<ol className="cap-workflow" aria-label="制作流程"><li>确认方案<ArrowRight /></li><li>预览与修改<ArrowRight /></li><li>导出成片</li></ol>
      <section className="cap-explore" aria-labelledby="explore-title"><header className="cap-section-heading"><div><h2 id="explore-title">看看可以怎么做</h2><p>先看效果，再换成你的内容。</p></div><button onClick={() => { setSearchOpen(!searchOpen); setCategory('全部'); setQuery(''); }} aria-expanded={searchOpen}>{searchOpen ? '收起搜索' : '查看更多'}<CaretRight /></button></header>
        {searchOpen ? <label className="cap-search"><MagnifyingGlass /><input autoFocus type="search" placeholder="搜索效果、用途或能力来源" value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索表现方式" /></label> : null}
        <div className="cap-filters" role="group" aria-label="按用途筛选">{categories.map(item => <button key={item} className={category === item ? 'selected' : ''} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="cap-grid">{filtered.map(item => <button className={`cap-card ${selectedId === item.id ? 'selected' : ''}`} key={item.id} onClick={event => openDetails(item, event)} aria-label={`查看${item.name}`} aria-pressed={selectedId === item.id}><div className="cap-card-image"><img src={item.image} alt={item.alt} /><span className="cap-card-example">{item.id === 'model-stage' || item.id === 'infographic' ? <Images /> : <Play weight="fill" />}{item.id === 'model-stage' ? '概念图' : item.id === 'infographic' ? '布局示意' : '示例'}</span>{selectedId === item.id ? <span className="cap-selected-check"><Check weight="bold" /></span> : null}</div><h3>{item.name}</h3><p>{item.description}</p><small>{item.meta} · {item.provider}</small></button>)}</div>
        {!filtered.length ? <div className="cap-empty"><MagnifyingGlass /><b>没有找到这个效果</b><p>试试“流程”“3D”或“Baoyu”。</p><button onClick={() => { setQuery(''); setCategory('全部'); }}>查看全部效果</button></div> : null}
      </section><section className="cap-recent"><h2>最近项目</h2><button onClick={() => setModal('recent')}>查看全部<CaretRight /></button></section>
    </main>
    {selected ? <><button className="cap-detail-backdrop" aria-label="关闭表现方式遮罩" tabIndex={-1} onClick={closeDetails} /><aside ref={detailRef} className="cap-detail" role={narrow ? "dialog" : undefined} aria-modal={narrow ? true : undefined} aria-label="表现方式详情"><header className="cap-detail-top"><b>表现方式</b><button className="cap-icon" aria-label="关闭表现方式详情" onClick={closeDetails}><X /></button></header><div className="cap-detail-scroll"><div className="cap-detail-heading"><h2>{selected.name}</h2><p>{selected.summary}</p></div><EffectPreview key={`${selected.id}-${variant}`} capability={selected} variant={variant} /><section className="cap-detail-section"><h3>可以怎样呈现</h3><div className="cap-variants">{selected.variants.map((item, index) => <button className={variant === index ? 'selected' : ''} key={item} aria-pressed={variant === index} onClick={() => setVariant(index)}>{index === 0 ? <ArrowsClockwise /> : index === 1 ? <MagnifyingGlass /> : <SlidersHorizontal />}<span>{item}</span>{variant === index ? <Check /> : <CaretRight />}</button>)}</div></section><section className="cap-detail-section"><h3>开始前，准备这些</h3><div className="cap-requirement"><Cube /><div><b>{selected.requirement}</b><p>{selected.requirementHint}</p></div></div><p className="cap-boundary">{selected.boundary}</p></section><section className="cap-detail-section cap-usecases"><h3>适合用于</h3><p>{selected.uses}</p></section><details className="cap-provenance"><summary>能力来源 · {selected.provider}<CaretRight /></summary><p>{selected.provenance}</p></details></div><footer className="cap-detail-footer"><button className="cap-primary" onClick={choose}>用这个方式创作<ArrowRight /></button><p>{selected.id === 'model-stage' ? '选择后上传模型，再确认制作方案。' : '带入创作要求，再根据你的内容制定方案。'}</p></footer></aside></> : null}
    {notice ? <div className="cap-toast" role="status"><CheckCircle /><span>{notice}</span></div> : null}
    {modal === 'library' ? <Modal title="预览素材库" onClose={() => setModal(null)}><div className="cap-modal-body"><p>这里仅显示本次添加的本地文件，不会读取或上传到线上素材库。</p>{files.length ? <ul className="cap-local-files">{files.map((file, index) => <li key={`${file.name}-${index}`}><FolderSimple /><span>{file.name}</span><small>{file.size < 1024 ? `${file.size} B` : `${Math.round(file.size / 1024)} KB`}</small><Check /></li>)}</ul> : <div className="cap-empty"><FolderSimple /><b>还没有添加素材</b><p>上传图片、文案，或用于 3D 展示的模型。</p></div>}<button className="cap-primary" onClick={() => upload.current?.click()}><UploadSimple />添加本地素材</button></div></Modal> : null}
    {modal === 'recent' ? <Modal title="最近项目" onClose={() => setModal(null)}><div className="cap-modal-body cap-empty"><FilmSlate /><b>这是独立预览空间</b><p>线上项目保持原样。你可以在这里体验选效果、添加素材和预览制作方案。</p><button className="cap-primary" onClick={() => { setModal(null); composer.current?.focus(); }}>开始体验<ArrowRight /></button></div></Modal> : null}
    {modal === 'plan' ? <Modal title="制作方案预览" onClose={() => setModal(null)}><div className="cap-modal-body"><p className="cap-plan-note"><Info />交互演示 · 未调用 AI，未提交生成任务</p><dl className="cap-plan"><dt>创作内容</dt><dd>{prompt.trim() || '分析已添加的素材，组织成视频。'}</dd><dt>表现方式</dt><dd>{method ? `${method.name} · ${applied.label}` : '由内容决定'}{method ? <small>来源：{method.provider}</small> : null}</dd><dt>视频画幅</dt><dd>{ratio}</dd><dt>已选素材</dt><dd>{files.length ? files.map(file => file.name).join('、') : '未添加，可在方案确认前补充'}</dd></dl><p className="cap-plan-help">正式接入时，所选方式会作为创作要求交给助手，进一步安排镜头与制作方案。</p><div className="cap-modal-actions"><button onClick={() => setModal(null)}>返回调整</button><button className="cap-primary" onClick={saveBrief}><DownloadSimple />保存创作要求</button></div></div></Modal> : null}
  </div>;
}
