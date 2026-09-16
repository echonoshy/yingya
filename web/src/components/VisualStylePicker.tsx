import { useState } from "react";
import { ArrowRight, Check, Palette, Sparkle } from "@phosphor-icons/react";
import { ActionDialog } from "./ActionDialog";
import { findVisualStyle, stylePreviewPath, visualStyles } from "../visualStyles";
import "./visualStyles.css";

export function VisualStylePicker({ value, onChange, disabled = false }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = findVisualStyle(value);
  return <section className="visual-style-entry" aria-label="视频视觉风格">
    <div className="visual-style-summary"><Palette size={20}/><div><b>视觉风格</b><span>{selected ? selected.name : "根据内容推荐"}</span></div></div>
    <button type="button" className="visual-style-open" disabled={disabled} onClick={() => setOpen(true)}>{selected ? "查看与更换" : "看效果，选风格"}<ArrowRight/></button>
    {open ? <StyleDialog value={value} onChange={id => { onChange(id); setOpen(false); }} onClose={() => setOpen(false)}/> : null}
  </section>;
}

function StyleDialog({ value, onChange, onClose }: { value: string; onChange: (id: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(value);
  const selected = findVisualStyle(draft);
  return <ActionDialog title="选择视觉风格" className="visual-style-dialog" onClose={onClose}>
    <p className="visual-style-intro">看同一段内容的不同表达。点选后可在下方播放 6 秒示例，配色、排版与节奏会带入制作。</p>
    <div className="visual-style-options" role="group" aria-label="可选视觉风格">
      <button type="button" className="visual-style-auto" aria-pressed={draft === "auto"} onClick={() => setDraft("auto")}><Sparkle/><span><b>根据内容推荐</b><small>由映芽选择合适的起点，保留你提供的品牌要求。</small></span>{draft === "auto" ? <Check aria-label="已选择"/> : null}</button>
      <div className="visual-style-grid">{visualStyles.map(style => <button key={style.id} type="button" className="visual-style-card" aria-label={`选择${style.name}`} aria-pressed={draft === style.id} onClick={() => setDraft(style.id)}>
        <img src={stylePreviewPath(style, "poster.jpg")} alt={`${style.name}风格：整理想法、展开重点、传递价值`} width="640" height="360" loading="lazy"/>
        <span className="visual-style-card-copy"><span><b>{style.name}</b>{draft === style.id ? <Check aria-label="已选择"/> : null}</span><small>{style.description}</small></span>
      </button>)}</div>
    </div>
    {selected ? <section className="visual-style-detail" aria-label={`${selected.name}效果预览`}>
      <video key={selected.id} controls playsInline preload="metadata" poster={stylePreviewPath(selected, "poster.jpg")} src={stylePreviewPath(selected, "preview.mp4")} aria-label={`${selected.name}动态预览`}/>
      <div><h3>{selected.name}</h3><p>{selected.tags.join(" · ")}</p><ul>{selected.rules.map(rule => <li key={rule}>{rule}</li>)}</ul><small>{selected.inspiration}。原创示例用于参考，实际编排取决于你的内容与素材。</small></div>
    </section> : <p className="visual-style-auto-note">也可以先选一个喜欢的效果，之后用对话调整。选择会记住，下次无需从头开始。</p>}
    <footer className="visual-style-dialog-footer"><span>{selected ? `本次选择：${selected.name}` : "本次选择：根据内容推荐"}</span><button className="primary-button" type="button" onClick={() => onChange(draft)}>使用{selected ? "这个风格" : "内容推荐"}<ArrowRight/></button></footer>
  </ActionDialog>;
}

export function ProjectVisualStyle({ style }: { style?: { id: string; version: number; name: string } | null }) {
  const [open, setOpen] = useState(false);
  if (!style) return null;
  return <div className="project-visual-style"><button type="button" onClick={() => setOpen(true)}><Palette/>起始风格 · {style.name}</button>
    {open ? <ActionDialog title={`起始风格 · ${style.name}`} className="project-style-dialog" onClose={() => setOpen(false)}>
      <video controls playsInline preload="metadata" poster={stylePreviewPath(style, "poster.jpg")} src={stylePreviewPath(style, "preview.mp4")} aria-label={`${style.name}动态预览`}/>
      <p>项目已保存这个风格的配色、排版与节奏规范。你可以在对话中提出调整，后续制作会以你确认的新要求为准。</p>
    </ActionDialog> : null}
  </div>;
}
