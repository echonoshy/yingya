import { CaretRight, SlidersHorizontal } from "@phosphor-icons/react";
import { AssetRoleSelect } from "./AssetRoleSelect";
import { AssetPicker } from "./AssetPicker";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api } from "../api";
import type { AssetFolder, AssetLibraryItem, AssetRole, CreationRequirements } from "../types";
export const creationSettingsSchema = z.object({ duration: z.string(), audience: z.string(), style: z.string(), subtitles: z.string(), music: z.string(), audioMode: z.enum(["auto", "preserve", "narration", "replace", "mute"]).default("auto"), durationMode: z.enum(["target", "exact", "max"]).default("target") }).transform(value => ({ ...value, music: value.audioMode === "mute" ? "不添加配乐" : value.music, durationMode: value.duration.trim() ? value.durationMode : "target" as const }));
export const defaultCreationSettings = { duration: "", audience: "", style: "", subtitles: "", music: "", audioMode: "auto" as const, durationMode: "target" as const };
export type CreationSettingsValue = z.infer<typeof creationSettingsSchema>;
export function creationRequirements(settings: CreationSettingsValue): CreationRequirements {
  const duration = Number.parseFloat(settings.duration);
  return { ...(Number.isFinite(duration) ? { targetDurationSeconds: duration } : {}), durationMode: Number.isFinite(duration) ? settings.durationMode : "target",
    ...(settings.audience.trim() ? { audience: settings.audience.trim() } : {}), ...(settings.style.trim() ? { styleNotes: settings.style.trim() } : {}),
    subtitles: settings.subtitles === "中文字幕" ? "zh" : settings.subtitles === "中英双语字幕" ? "zh-en" : settings.subtitles === "不添加字幕" ? "none" : "auto",
    music: settings.audioMode === "mute" || settings.music === "不添加配乐" ? "off" : settings.music === "添加适合主题的配乐" ? "on" : "auto", audioMode: settings.audioMode };
}
export function creationBrief(settings: CreationSettingsValue) {
  return ([["目标时长", settings.duration], ["目标受众", settings.audience], ["补充视觉要求", settings.style], ["字幕", settings.subtitles], ["配乐", settings.music]]).filter(([, value]) => value.trim()).map(([name, value]) => `${name}：${value}`).join("；");
}
export function CreationSettings({ value, onChange, selectedIds, onSelect, roles, onRole, includeLibrary = true }: { includeLibrary?: boolean; value: CreationSettingsValue; onChange: (value: CreationSettingsValue) => void; selectedIds: string[]; onSelect: (value: string[]) => void; roles: Record<string, AssetRole>; onRole: (id: string, role: AssetRole) => void }) {
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !includeLibrary) return;
    let cancelled = false;
    setLoaded(false);
    void Promise.all([api.listAssetLibrary(), api.listAssetFolders()]).then(([library, folderList]) => { if (!cancelled) { setAssets(library.assets); setFolders(folderList); setError(""); setLoaded(true); } }).catch(() => { if (!cancelled) setError("素材库读取失败，请重新展开重试。"); });
    return () => { cancelled = true; };
  }, [open, includeLibrary]);
  const brief = creationBrief(value);
  return <details className="creation-settings" onToggle={event => setOpen(event.currentTarget.open)}><summary><SlidersHorizontal aria-hidden="true"/><span>{includeLibrary ? "创作设置与素材" : "创作设置"}{includeLibrary && selectedIds.length ? ` · 已选 ${selectedIds.length} 项素材` : ""}</span>{!includeLibrary ? <small className="creation-settings-preview">时长 · 字幕 · 配音 · 配乐</small> : null}<CaretRight className="creation-settings-chevron" aria-hidden="true"/></summary><div className="creation-setting-fields"><label>目标时长<select value={value.duration} onChange={event => onChange({ ...value, duration: event.target.value, durationMode: event.target.value ? value.durationMode : "target" })}><option value="">由创作内容决定</option>{["15 秒", "30 秒", "60 秒", "90 秒"].map(item => <option key={item}>{item}</option>)}</select></label><label>时长要求<select disabled={!value.duration} value={value.duration ? value.durationMode : "target"} onChange={event => onChange({ ...value, durationMode: event.target.value as CreationSettingsValue["durationMode"] })}><option value="target">大约此时长</option><option value="exact">精确此时长</option><option value="max">不超过此时长</option></select></label><label>音频处理<select value={value.audioMode} onChange={event => onChange({ ...value, audioMode: event.target.value as CreationSettingsValue["audioMode"], music: event.target.value === "mute" ? "不添加配乐" : value.music })}><option value="auto">先分析素材，再提出建议</option><option value="preserve">保留原声</option><option value="narration">保留原声并补充旁白</option><option value="replace">替换原声为新配音</option><option value="mute">静音</option></select></label><label>目标受众<input maxLength={120} value={value.audience} onChange={event => onChange({ ...value, audience: event.target.value })} placeholder="例如：第一次了解产品的人"/></label><label>补充视觉要求<input maxLength={120} value={value.style} onChange={event => onChange({ ...value, style: event.target.value })} placeholder="例如：保留品牌蓝色、减少转场"/></label><label>字幕<select value={value.subtitles} onChange={event => onChange({ ...value, subtitles: event.target.value })}><option value="">由创作内容决定</option><option>中文字幕</option><option>中英双语字幕</option><option>不添加字幕</option></select></label><label>配乐<select disabled={value.audioMode === "mute"} value={value.audioMode === "mute" ? "不添加配乐" : value.music} onChange={event => onChange({ ...value, music: event.target.value })}><option value="">由创作内容决定</option><option>添加适合主题的配乐</option><option>不添加配乐</option></select>{value.audioMode === "mute" ? <span>全片静音，不添加配乐。</span> : null}</label></div>{brief ? <p className="creation-brief">本次要求：{brief}</p> : null}{includeLibrary ? <fieldset className="creation-library"><legend>选择已有素材</legend>{error ? <p role="alert">{error}</p> : null}<AssetPicker assets={assets} folders={folders} selectedIds={selectedIds} onToggle={asset => onSelect(selectedIds.includes(asset.id) ? selectedIds.filter(id => id !== asset.id) : [...selectedIds, asset.id])}/><div className="selected-material-roles">{assets.filter(asset => selectedIds.includes(asset.id)).map(asset => <div key={asset.id}><span>{asset.sourceName || asset.prompt || "未命名素材"}</span><AssetRoleSelect name={asset.sourceName || asset.prompt || "未命名素材"} value={roles[`library:${asset.id}`]} onChange={role => onRole(`library:${asset.id}`, role)}/></div>)}</div>{loaded && !error && !assets.length ? <p>素材库暂无文件，可使用输入区的附件按钮上传。</p> : null}{loaded && selectedIds.some(id => !assets.some(asset => asset.id === id)) ? <button type="button" onClick={() => onSelect(selectedIds.filter(id => assets.some(asset => asset.id === id)))}>移除已不可用的素材选择</button> : null}</fieldset> : null}</details>;
}
