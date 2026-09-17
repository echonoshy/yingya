import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowsClockwise, CaretRight, Check, Cube, Images, Info, MagnifyingGlass, Pause, Play, SlidersHorizontal, X } from "@phosphor-icons/react";
import { capabilities, categories, variantKeys, capabilityExamples, type Capability } from "../capabilities";
import { presentationSchema, type PresentationChoice } from "../presentation";

export function CapabilityGallery({ selectedId, onOpen, onChoose }: { onChoose: (choice: PresentationChoice) => void; selectedId?: string; onOpen: (item: Capability, button: HTMLButtonElement) => void }) {
  const [category, setCategory] = useState("全部"), [query, setQuery] = useState(""), [searchOpen, setSearchOpen] = useState(false);
  const filtered = capabilities.filter(item => (category === "全部" || (item.categories as readonly string[]).includes(category)) && `${item.name} ${item.description} ${item.provider} ${item.requirement} ${item.uses}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="cap-explore" aria-labelledby="explore-title">
    <header className="cap-section-heading"><div><h2 id="explore-title">看看可以怎么做</h2><p>先看效果，也可以直接选用；每种方式都能换成你的内容。</p></div><button type="button" onClick={() => { setSearchOpen(!searchOpen); setQuery(""); }} aria-expanded={searchOpen}>{searchOpen ? "收起搜索" : "搜索效果"}<MagnifyingGlass/></button></header>
    {searchOpen ? <label className="cap-search"><MagnifyingGlass/><input autoFocus type="search" placeholder="搜索效果、用途或能力来源" value={query} onChange={event => setQuery(event.target.value)} aria-label="搜索表现方式"/></label> : null}
    <div className="cap-filters" role="group" aria-label="按用途筛选">{categories.map(item => <button type="button" key={item} className={category === item ? "selected" : ""} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
    <div className="cap-grid">{filtered.map(item => <article className="cap-card-item" key={item.id}><button type="button" className={`cap-card ${selectedId === item.id ? "selected" : ""}`} key={item.id} onClick={event => onOpen(item, event.currentTarget)} aria-label={`查看${item.name}`} aria-pressed={selectedId === item.id}><div className="cap-card-image"><img src={item.image} alt={item.alt} loading="lazy"/><span className="cap-card-example">{item.id === "model-stage" || item.id === "infographic" ? <Images/> : <Play weight="fill"/>}{item.id === "model-stage" ? "概念图" : item.id === "infographic" ? "布局示意" : "示例"}</span>{selectedId === item.id ? <span className="cap-selected-check"><Check weight="bold"/></span> : null}</div><h3>{item.name}</h3><p>{item.description}</p><small>准备：{item.requirement}</small></button><div className="cap-card-actions"><span>{item.id === "infographic" ? "布局参考" : item.id === "model-stage" || item.id === "number-compare" ? item.meta : "可直接使用"} · {item.provider}</span><button type="button" aria-label={`直接使用${item.name}`} onClick={() => onChoose(presentationSchema.parse({ capabilityId: item.id, variant: variantKeys[item.id][0] }))}>使用<ArrowRight/></button></div></article>)}</div>
    {!filtered.length ? <div className="cap-empty" role="status"><MagnifyingGlass/><b>没有找到这个效果</b><p>试试“流程”“3D”或“Baoyu”。</p><button type="button" onClick={() => { setQuery(""); setCategory("全部"); }}>查看全部效果</button></div> : null}
  </section>;
}

function EffectPreview({ capability, variant }: { capability: Capability; variant: number }) {
  const [live, setLive] = useState(false), [ready, setReady] = useState(false), [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [error, setError] = useState(""), [width, setWidth] = useState(0);
  const container = useRef<HTMLDivElement>(null), frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => { const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width)); if (container.current) observer.observe(container.current); return () => observer.disconnect(); }, []);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "demo-ready") { setReady(true); setError(""); }
      if (event.data?.type === "demo-state" && Number.isFinite(event.data.time)) { setTime(Math.max(0, Math.min(6, event.data.time))); setPlaying(Boolean(event.data.playing)); }
      if (event.data?.type === "demo-error") { setError("示例未能载入，请重试或选择其他效果。"); setPlaying(false); }
    }
    window.addEventListener("message", receive); return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    if (!live || ready || error) return;
    const timer = window.setTimeout(() => setError("示例加载超时，请重试。"), 20000);
    return () => window.clearTimeout(timer);
  }, [live, ready, error]);
  function send(action: string, value?: number) { frame.current?.contentWindow?.postMessage({ type: "demo-control", action, value }, location.origin); }
  function play() { if (!live) { setLive(true); setReady(false); setTime(0); return; } send(playing ? "pause" : "play"); }
  return <div className="cap-effect-preview"><div className="cap-preview-stage" ref={container}>
    {live ? <iframe ref={frame} title={`${capability.name}组件运行示例`} tabIndex={-1} src={`/capabilities/v1/demo/index.html?component=${capability.id}&variant=${variant}`} style={{ transform: `scale(${width / 1280})` }}/> : <img src={capability.image} alt={capability.alt}/>}
    {!live && capability.id === "model-stage" ? <span className="cap-example-tag">概念效果图</span> : null}
    {live && !ready && !error ? <span className="cap-preview-loading" role="status">正在载入组件…</span> : null}
  </div>{capability.id === "infographic" ? <p className="cap-preview-note"><Info/>静态布局参考，实际动画根据内容编排。</p> : <><div className="cap-player-controls"><button type="button" className="cap-icon" onClick={play} disabled={Boolean(error) || (live && !ready)} aria-label={playing ? "暂停示例" : "播放示例"}>{playing ? <Pause weight="fill"/> : <Play weight="fill"/>}</button><span className="cap-time">00:{String(Math.floor(time)).padStart(2, "0")} / 00:06</span><input type="range" min="0" max="6" step="0.05" value={time} disabled={!ready || Boolean(error)} onChange={event => { const next = Number(event.target.value); setTime(next); setPlaying(false); send("seek", next); }} aria-label="示例播放位置"/><button type="button" className="cap-icon" aria-label="重新播放示例" disabled={!ready || Boolean(error)} onClick={() => { send("seek", 0); send("play"); }}><ArrowsClockwise/></button></div>{capability.id === "model-stage" ? <p className="cap-preview-note">播放时使用几何模型；耳机为概念图。</p> : null}</>}
    {error ? <p className="cap-error" role="alert">{error}<button type="button" onClick={() => { setLive(false); setReady(false); setPlaying(false); setError(""); }}>重试</button></p> : null}
  </div>;
}

export function CapabilityDetails({ capability, onClose, onChoose }: { capability: Capability; onClose: () => void; onChoose: (choice: PresentationChoice) => void }) {
  const [variant, setVariant] = useState(0);
  const [narrow, setNarrow] = useState(() => matchMedia("(max-width: 1099px)").matches);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const media = matchMedia("(max-width: 1099px)"); const sync = () => setNarrow(media.matches);
    media.addEventListener("change", sync); return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!narrow) return;
    dialog.current?.showModal();
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [narrow]);
  const contents = <><header className="cap-detail-top"><b>表现方式</b><button type="button" className="cap-icon" aria-label="关闭表现方式详情" onClick={onClose}><X/></button></header><div className="cap-detail-scroll"><div className="cap-detail-heading"><h2>{capability.name}</h2><p>{capability.summary}</p></div><EffectPreview key={`${capability.id}-${variant}`} capability={capability} variant={variant}/><section className="cap-detail-section"><h3>可以怎样呈现</h3><div className="cap-variants">{capability.variants.map((item, index) => <button type="button" className={variant === index ? "selected" : ""} key={item} aria-pressed={variant === index} onClick={() => setVariant(index)}>{index === 0 ? <ArrowsClockwise/> : index === 1 ? <MagnifyingGlass/> : <SlidersHorizontal/>}<span>{item}</span>{variant === index ? <Check/> : <CaretRight/>}</button>)}</div></section><section className="cap-detail-section"><h3>开始前，准备这些</h3><div className="cap-requirement"><Cube/><div><b>{capability.requirement}</b><p>{capability.requirementHint}</p></div></div><p className="cap-boundary">{capability.boundary}</p></section><section className="cap-detail-section cap-example-request"><h3>可以这样描述</h3><p>{capabilityExamples[capability.id]}</p></section><section className="cap-detail-section cap-usecases"><h3>适合用于</h3><p>{capability.uses}</p></section><details className="cap-provenance"><summary>能力来源 · {capability.provider}<CaretRight/></summary><p>{capability.provenance}</p></details></div><footer className="cap-detail-footer"><button type="button" className="cap-primary" onClick={() => onChoose(presentationSchema.parse({ capabilityId: capability.id, variant: variantKeys[capability.id][variant] }))}>用这个方式创作<ArrowRight/></button><p>{capability.id === "model-stage" ? "选择后上传模型，再确认制作方案。" : "带入创作要求，再根据你的内容制定方案。"}</p></footer></>;
  return narrow ? <dialog ref={dialog} className="cap-detail cap-detail--dialog" aria-label="表现方式详情" onCancel={() => close.current()} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), summary"));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onClick={event => { if (event.target === event.currentTarget) close.current(); }}>{contents}</dialog> : <aside className="cap-detail" aria-label="表现方式详情" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>{contents}</aside>;
}
