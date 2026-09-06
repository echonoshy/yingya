import { useEffect, useState } from "react";
import { z } from "zod";
import { api } from "../api";
import type { AssetLibraryItem } from "../types";
export const creationSettingsSchema = z.object({ duration: z.string(), audience: z.string(), style: z.string(), subtitles: z.string(), music: z.string() });
export const defaultCreationSettings = { duration: "", audience: "", style: "", subtitles: "", music: "" };
export type CreationSettingsValue = z.infer<typeof creationSettingsSchema>;
export function creationBrief(settings: CreationSettingsValue) {
  return ([["目标时长", settings.duration], ["目标受众", settings.audience], ["视觉风格", settings.style], ["字幕", settings.subtitles], ["配乐", settings.music]]).filter(([, value]) => value.trim()).map(([name, value]) => `${name}：${value}`).join("；");
}
export function CreationSettings({ value, onChange, selectedIds, onSelect }: { value: CreationSettingsValue; onChange: (value: CreationSettingsValue) => void; selectedIds: string[]; onSelect: (value: string[]) => void }) {
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoaded(false);
    void api.listAssetLibrary().then(library => { if (!cancelled) { setAssets(library.assets); setError(""); setLoaded(true); } }).catch(() => { if (!cancelled) setError("素材库读取失败，请重新展开重试。"); });
    return () => { cancelled = true; };
  }, [open]);
  const brief = creationBrief(value);
  return <details className="creation-settings" onToggle={event => setOpen(event.currentTarget.open)}><summary>创作设置与素材{selectedIds.length ? ` · 已选 ${selectedIds.length} 项素材` : ""}</summary><div className="creation-setting-fields"><label>目标时长<select value={value.duration} onChange={event => onChange({ ...value, duration: event.target.value })}><option value="">由创作内容决定</option>{["15 秒", "30 秒", "60 秒", "90 秒"].map(item => <option key={item}>{item}</option>)}</select></label><label>目标受众<input maxLength={120} value={value.audience} onChange={event => onChange({ ...value, audience: event.target.value })} placeholder="例如：第一次了解产品的人"/></label><label>视觉风格<input maxLength={120} value={value.style} onChange={event => onChange({ ...value, style: event.target.value })} placeholder="例如：明亮、简洁的课堂风"/></label><label>字幕<select value={value.subtitles} onChange={event => onChange({ ...value, subtitles: event.target.value })}><option value="">由创作内容决定</option><option>中文字幕</option><option>中英双语字幕</option><option>不添加字幕</option></select></label><label>配乐<select value={value.music} onChange={event => onChange({ ...value, music: event.target.value })}><option value="">由创作内容决定</option><option>添加适合主题的配乐</option><option>不添加配乐</option></select></label></div>{brief ? <p className="creation-brief">本次要求：{brief}</p> : null}<fieldset className="creation-library"><legend>选择素材库参考文件</legend>{error ? <p role="alert">{error}</p> : null}{assets.map(asset => <label key={asset.id}><input type="checkbox" checked={selectedIds.includes(asset.id)} onChange={event => onSelect(event.target.checked ? [...selectedIds, asset.id] : selectedIds.filter(id => id !== asset.id))}/><span>{asset.sourceName || asset.prompt || "未命名素材"}</span></label>)}{loaded && !error && !assets.length ? <p>素材库暂无文件，可使用输入区的附件按钮上传。</p> : null}{loaded && selectedIds.some(id => !assets.some(asset => asset.id === id)) ? <button type="button" onClick={() => onSelect(selectedIds.filter(id => assets.some(asset => asset.id === id)))}>移除已不可用的素材选择</button> : null}</fieldset></details>;
}
