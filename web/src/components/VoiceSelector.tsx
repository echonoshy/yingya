import { Check, CircleNotch, MagicWand, Play, SpeakerHigh, UploadSimple, Waveform, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { UploadedVoice } from "../types";

const voiceIdeas = [
  ["温暖叙述", "温暖可信的青年女声，语速舒缓，吐字清晰，适合品牌故事和生活方式内容"],
  ["清晰讲解", "沉稳清晰的青年男声，语速适中，逻辑感强，适合知识讲解和产品演示"],
  ["活力推广", "明亮有活力的年轻女声，节奏轻快但不夸张，适合短视频推广"],
] as const;

type CreateMode = "list" | "design" | "clone";

export function VoiceSelector({ value, onChange, disabled = false }: { value: string; onChange: (voiceId: string) => void | Promise<void>; disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CreateMode>("list");
  const [voices, setVoices] = useState<string[]>(["default"]);
  const [uploaded, setUploaded] = useState<UploadedVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [previewing, setPreviewing] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState<string>(voiceIdeas[0][1]);
  const [refText, setRefText] = useState("");
  const [audio, setAudio] = useState<File | null>(null);
  const [authorized, setAuthorized] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api.listVoices();
      setVoices(result.voices.length ? result.voices : ["default"]);
      setUploaded(result.uploaded_voices);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "音色库读取失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [load, open]);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const metadata = useMemo(() => new Map(uploaded.map(item => [item.name.toLocaleLowerCase(), item])), [uploaded]);
  const currentName = value === "default" ? "默认音色" : uploaded.find(item => item.name.toLocaleLowerCase() === value.toLocaleLowerCase())?.name ?? value;

  async function choose(voiceId: string) {
    setWorking(voiceId); setError("");
    try { await onChange(voiceId); setMode("list"); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "音色设置失败"); }
    finally { setWorking(""); }
  }

  async function preview(voiceId: string) {
    setPreviewing(voiceId); setError("");
    try {
      const blob = await api.previewVoice(voiceId);
      setAudioUrl(current => { if (current) URL.revokeObjectURL(current); return URL.createObjectURL(blob); });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "试听生成失败"); }
    finally { setPreviewing(""); }
  }

  async function createDesign() {
    if (!name.trim() || !description.trim()) return;
    setWorking("design"); setError("");
    try {
      const created = await api.designVoice({ name: name.trim(), description: description.trim() });
      await load(); await choose(created.name); setName("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "音色生成失败"); }
    finally { setWorking(""); }
  }

  async function createClone() {
    if (!name.trim() || !refText.trim() || !audio || !authorized) return;
    setWorking("clone"); setError("");
    try {
      const created = await api.cloneVoice({ name: name.trim(), description: description.trim(), refText: refText.trim(), audio, authorized });
      await load(); await choose(created.name); setName(""); setRefText(""); setAudio(null); setAuthorized(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "克隆音色创建失败"); }
    finally { setWorking(""); }
  }

  return <div className="voice-selector" ref={root}>
    <button type="button" className="voice-trigger" disabled={disabled} onClick={() => { setOpen(current => !current); setMode("list"); }} aria-haspopup="dialog" aria-expanded={open} title={disabled ? "当前任务完成后可更换音色" : `旁白音色：${currentName}`}>
      <Waveform/><span>{currentName}</span><i>⌄</i>
    </button>
    {open ? <section className="voice-menu" role="dialog" aria-label="项目旁白音色">
      <header><div><small>项目旁白</small><b>{mode === "list" ? "选择旁白音色" : mode === "design" ? "生成新音色" : "克隆参考音色"}</b></div><button type="button" aria-label="关闭音色库" onClick={() => setOpen(false)}><X/></button></header>
      {mode === "list" ? <>
        <div className="voice-list">
          {voices.map(voice => {
            const detail = metadata.get(voice.toLocaleLowerCase());
            const label = voice === "default" ? "默认音色" : detail?.name ?? voice;
            return <div className={`voice-row ${value.toLocaleLowerCase() === voice.toLocaleLowerCase() ? "active" : ""}`} key={voice}>
              <button type="button" className="voice-choice" disabled={Boolean(working)} onClick={() => void choose(voice)}>
                <span><SpeakerHigh/></span><div><b>{label}</b><small>{detail?.speaker_description ?? (voice === "default" ? "VoxCPM2 基础音色" : "已保存的项目音色")}</small></div>{value.toLocaleLowerCase() === voice.toLocaleLowerCase() ? <Check/> : null}
              </button>
              <button type="button" className="voice-preview" aria-label={`试听 ${label}`} disabled={Boolean(previewing)} onClick={() => void preview(voice)}>{previewing === voice ? <CircleNotch className="spin"/> : <Play weight="fill"/>}</button>
            </div>;
          })}
          {loading ? <div className="voice-loading"><CircleNotch className="spin"/>正在读取音色…</div> : null}
        </div>
        {audioUrl ? <audio className="voice-audio" src={audioUrl} controls autoPlay/> : null}
        <div className="voice-create-actions"><button type="button" onClick={() => setMode("design")}><MagicWand/>描述生成</button><button type="button" onClick={() => setMode("clone")}><UploadSimple/>上传克隆</button></div>
      </> : <div className="voice-editor">
        <div className="voice-mode-tabs"><button type="button" className={mode === "design" ? "active" : ""} onClick={() => setMode("design")}>描述生成</button><button type="button" className={mode === "clone" ? "active" : ""} onClick={() => setMode("clone")}>上传克隆</button></div>
        <label><span>音色名称</span><input value={name} maxLength={32} onChange={event => setName(event.target.value)} placeholder="例如：温暖女声"/></label>
        {mode === "design" ? <>
          <label><span>声音描述</span><textarea value={description} maxLength={200} onChange={event => setDescription(event.target.value)} placeholder="描述年龄、音色、语速、情绪与适用场景"/></label>
          <div className="voice-ideas">{voiceIdeas.map(([label, idea]) => <button type="button" key={label} onClick={() => setDescription(idea)}>{label}</button>)}</div>
          <p>映芽会先生成一段固定声音样本，再保存为可复用音色。后续旁白不会重新设计声音。</p>
          <button type="button" className="voice-create-primary" disabled={!name.trim() || description.trim().length < 4 || Boolean(working)} onClick={() => void createDesign()}>{working === "design" ? <CircleNotch className="spin"/> : <MagicWand/>}{working === "design" ? "正在生成并固化音色…" : "生成并使用这个音色"}</button>
        </> : <>
          <label><span>参考音频</span><input type="file" accept="audio/*" onChange={event => setAudio(event.target.files?.[0] ?? null)}/><small>1–30 秒、10 MB 以内的清晰单人声音</small></label>
          <label><span>参考音频原文</span><textarea value={refText} maxLength={500} onChange={event => setRefText(event.target.value)} placeholder="逐字填写音频中说出的内容，可显著提高相似度"/></label>
          <label><span>音色说明（可选）</span><input value={description} maxLength={200} onChange={event => setDescription(event.target.value)} placeholder="例如：沉稳、清晰、适合知识讲解"/></label>
          <label className="voice-consent"><input type="checkbox" checked={authorized} onChange={event => setAuthorized(event.target.checked)}/><span>我确认已获得声音所有者授权，并同意将此声音用于合成。</span></label>
          <button type="button" className="voice-create-primary" disabled={!name.trim() || !refText.trim() || !audio || !authorized || Boolean(working)} onClick={() => void createClone()}>{working === "clone" ? <CircleNotch className="spin"/> : <UploadSimple/>}{working === "clone" ? "正在保存音色…" : "创建并使用克隆音色"}</button>
        </>}
        <button type="button" className="voice-back" onClick={() => setMode("list")}>返回音色列表</button>
      </div>}
      {error ? <p className="voice-error" role="alert">{error}</p> : null}
    </section> : null}
  </div>;
}
