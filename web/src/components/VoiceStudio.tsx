import { VoiceAudioInput } from "./VoiceAudioInput";
import { Check, CircleNotch, MagicWand, Play, SpeakerHigh, UploadSimple } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { UploadedVoice } from "../types";

const voiceIdeas = [
  ["温暖叙述", "温暖可信的青年女声，语速舒缓，吐字清晰，适合品牌故事和生活方式内容"],
  ["清晰讲解", "沉稳清晰的青年男声，语速适中，逻辑感强，适合知识讲解和产品演示"],
  ["活力推广", "明亮有活力的年轻女声，节奏轻快但不夸张，适合短视频推广"],
] as const;

export function VoiceStudio({ value, onChange, compact = false }: { value: string; onChange: (voiceId: string) => void; compact?: boolean }) {
  const [voices, setVoices] = useState<string[]>(["default"]);
  const [uploaded, setUploaded] = useState<UploadedVoice[]>([]);
  const [mode, setMode] = useState<"design" | "clone">("design");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [previewing, setPreviewing] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [previewText, setPreviewText] = useState("你好，我是映芽为下一支视频选定的声音");
  const [name, setName] = useState("");
  const [description, setDescription] = useState<string>(voiceIdeas[0][1]);
  const [refText, setRefText] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [created, setCreated] = useState("");
  const submitting = useRef(false);
  const previewPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { const result = await api.listVoices(); setVoices(result.voices.length ? result.voices : ["default"]); setUploaded(result.uploaded_voices); }
    catch (reason) { setLoadError(reason instanceof Error ? reason.message : "音色库读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const metadata = useMemo(() => new Map(uploaded.map(item => [item.name.toLocaleLowerCase(), item])), [uploaded]);
  async function preview(voiceId: string) {
    if (previewPending.current) return;
    previewPending.current = true; setPreviewing(voiceId); setError("");
    try {
      const blob = await api.previewVoice(voiceId, previewText.trim() || undefined);
      if (mounted.current) setAudioUrl(URL.createObjectURL(blob));
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "试听生成失败"); }
    finally { previewPending.current = false; if (mounted.current) setPreviewing(""); }
  }
  async function create() {
    if (submitting.current || !name.trim() || (mode === "design" ? description.trim().length < 4 : !refText.trim() || !audio || audioBusy || !authorized)) return;
    submitting.current = true; setWorking(mode); setError(""); setCreated("");
    try {
      const result = mode === "design"
        ? await api.designVoice({ name: name.trim(), description: description.trim() })
        : await api.cloneVoice({ name: name.trim(), description: description.trim(), refText: refText.trim(), audio: audio!, authorized });
      if (!mounted.current) return;
      setVoices(current => [...new Set([...current, result.name])]);
      setUploaded(current => [result, ...current.filter(voice => voice.name !== result.name)]);
      setCreated(`音色“${result.name}”已保存，可在音色列表试听`);
      setName(""); setRefText(""); setAudio(null); setAuthorized(false); await load();
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "音色创建失败"); }
    finally { submitting.current = false; if (mounted.current) setWorking(""); }
  }

  return <div className={`asset-studio-grid voice-studio ${compact ? "voice-studio--compact" : ""}`}>
    <section className="asset-creator">
      <header><h2>创建音色</h2></header>
      <div className="asset-mode-tabs" role="group" aria-label="音色创建方式"><button type="button" disabled={Boolean(working)} aria-pressed={mode === "design"} className={mode === "design" ? "active" : ""} onClick={() => setMode("design")}><MagicWand/>描述生成</button><button type="button" disabled={Boolean(working)} aria-pressed={mode === "clone"} className={mode === "clone" ? "active" : ""} onClick={() => setMode("clone")}><UploadSimple/>克隆音色</button></div>
      <label><span>音色名称</span><input disabled={Boolean(working)} value={name} maxLength={32} onChange={event => setName(event.target.value)} placeholder="例如：品牌讲述者"/></label>
      {mode === "design" ? <>
        <label><span>声音描述</span><textarea disabled={Boolean(working)} value={description} maxLength={200} onChange={event => setDescription(event.target.value)} placeholder="年龄、音色、语速、情绪与适用场景"/></label>
        <div className="voice-ideas">{voiceIdeas.map(([label, idea]) => <button key={label} type="button" disabled={Boolean(working)} onClick={() => setDescription(idea)}>{label}</button>)}</div>
      </> : <>
        <VoiceAudioInput value={audio} onChange={setAudio} disabled={Boolean(working)} onBusyChange={setAudioBusy}/>
        <label><span>参考音频原文</span><textarea disabled={Boolean(working)} value={refText} maxLength={500} onChange={event => setRefText(event.target.value)} placeholder="逐字填写音频里说出的内容"/></label>
        <label><span>音色说明（可选）</span><input disabled={Boolean(working)} value={description} maxLength={200} onChange={event => setDescription(event.target.value)}/></label>
        <label className="voice-consent"><input type="checkbox" disabled={Boolean(working)} checked={authorized} onChange={event => setAuthorized(event.target.checked)}/><span>我确认已获得声音所有者授权，并同意将此声音用于合成</span></label>
      </>}
      <button className="asset-primary" type="button" disabled={!name.trim() || (mode === "design" ? description.trim().length < 4 : !refText.trim() || !audio || audioBusy || !authorized) || Boolean(working)} onClick={() => void create()}>{working ? <CircleNotch className="spin"/> : mode === "design" ? <MagicWand/> : <UploadSimple/>}{working ? "正在创建" : "创建音色"}</button>
      {created ? <p className="draft-save-status" role="status">{created}</p> : null}
      {error ? <p className="asset-error" role="alert">{error}</p> : null}
    </section>
    <section className="asset-library" aria-busy={loading}>
      <header><div><h2>音色</h2></div><span>{voices.length}</span></header>
      {loadError ? <div className="voice-library-error" role="alert"><p>音色库暂时未能加载：{loadError}</p><button type="button" disabled={loading} onClick={() => void load()}>重新加载音色</button></div> : null}
      <label className="preview-copy"><span>试听文案</span><input value={previewText} onChange={event => setPreviewText(event.target.value)} maxLength={120}/></label>
      <div className="studio-voice-list">{voices.map(voice => {
        const detail = metadata.get(voice.toLocaleLowerCase()); const label = voice === "default" ? "默认音色" : detail?.name ?? voice; const selected = value.toLocaleLowerCase() === voice.toLocaleLowerCase();
        return <article className={selected ? "selected" : ""} key={voice}><span className="voice-avatar"><SpeakerHigh/></span><div><b>{label}</b>{voice !== "default" ? <small>{detail?.speaker_description || "已保存的音色"}</small> : null}</div><button className="voice-preview" type="button" aria-label={`试听 ${label}`} disabled={Boolean(previewing)} onClick={() => void preview(voice)}>{previewing === voice ? <CircleNotch className="spin"/> : <Play weight="fill"/>}</button><button className="voice-select" type="button" disabled={selected} onClick={() => onChange(voice)}>{selected ? <><Check/>新项目默认</> : "设为默认"}</button></article>;
      })}{loading ? <p className="asset-loading"><CircleNotch className="spin"/>正在读取音色…</p> : null}</div>
      {audioUrl ? <audio className="studio-voice-audio" src={audioUrl} controls autoPlay/> : !loading && !loadError ? <div className="voice-listen-state"><p>{previewing ? '正在准备试听…' : '试听已保存的音色'}</p><small>填写试听文案，点击音色旁的播放按钮</small></div> : null}
    </section>
  </div>;
}
