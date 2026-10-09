import { createClientRequestId } from "../requestId";
import type { VoiceJob } from "../schemas";
import type { JobList } from "../hooks/useAssetJobs";
import { GenerationStatus } from "./ImageGeneration";
import { ArrowClockwise, Check, CircleNotch, DownloadSimple, MagicWand, MagnifyingGlass, Pause, PencilSimple, Play, SpeakerHigh, Trash, UploadSimple } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { api } from "../api";
import { useSavedState } from "../hooks/useSavedState";
import { useDraftFiles } from "../hooks/useDraftFiles";
import type { UploadedVoice } from "../types";
import { ActionDialog } from "./ActionDialog";
import { VoiceAudioInput } from "./VoiceAudioInput";
import "./voice-studio.css";

const ideas = [["温暖叙述", "温暖可信的青年女声，语速舒缓，吐字清晰，适合品牌故事和生活方式内容"], ["清晰讲解", "沉稳清晰的青年男声，语速适中，适合知识讲解和产品演示"], ["活力推广", "明亮有活力的年轻女声，节奏轻快，适合短视频推广"]] as const;
const draftSchema = z.object({ mode: z.enum(["design", "clone"]), designName: z.string(), cloneName: z.string(), description: z.string(), cloneDescription: z.string(), refText: z.string(), previewText: z.string() });
const emptyDraft = { mode: "design" as const, designName: "", cloneName: "", description: ideas[0][1] as string, cloneDescription: "", refText: "", previewText: "你好，我是映芽为下一支视频选定的声音。" };
const labelFor = (voice: UploadedVoice) => voice.display_name || voice.name;
const sourceFor = (voice?: UploadedVoice) => !voice ? "内置音色" : voice.consent === "generated-by-voxcpm2" ? "描述生成" : "克隆音色";

export function VoiceStudio({ value, onChange, active = true, jobs, retry, onTasks }: { value: string; onChange: (voiceId: string) => void; active?: boolean; jobs: JobList<VoiceJob>; retry: { job: VoiceJob } | null; onTasks: () => void }) {
  const [voices, setVoices] = useState<string[]>([]);
  const [uploaded, setUploaded] = useState<UploadedVoice[]>([]);
  const [draft, setDraft, draftSaved] = useSavedState("yingya-voice-studio-draft", draftSchema, emptyDraft);
  const [files, setFiles, fileStatus] = useDraftFiles("yingya-voice-reference");
  const createRef = useRef<HTMLFormElement>(null);
  function showCreate() { createRef.current?.scrollIntoView({ block: "nearest" }); createRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }); }
  const [pending, setPending] = useSavedState("yingya-voice-pending", z.object({ key: z.string(), id: z.string() }).nullable(), null);
  const [currentId, setCurrentId] = useSavedState("yingya-voice-current-job", z.string(), "");
  const currentJob = jobs.jobs.find(job => job.id === currentId);
  const completedRevision = jobs.jobs.filter(job => job.status === "completed").map(job => job.id).join(",");
  useEffect(() => { if (active) void load(); }, [completedRevision]);
  useEffect(() => {
    if (!retry) return;
    const job = retry.job;
    let cancelled = false;
    setDraft(current => ({ ...current, mode: job.mode, ...(job.mode === "design" ? { designName: job.name, description: job.description } : { cloneName: job.name, cloneDescription: job.description, refText: job.refText }) }));
    setAuthorized(false); setPending(null); setCreateError(""); setCurrentId(job.id); showCreate();
    if (job.mode === "clone") {
      setFiles([]); setWorking(true);
      void api.voiceJobReference(job.id).then(blob => { if (!cancelled) setFiles([new File([blob], job.referenceName || "reference.wav", { type: job.referenceMime || blob.type })]); }).catch(() => { if (!cancelled) setCreateError("参考音频暂时无法读取，请重新选择音频。"); }).finally(() => { if (!cancelled) setWorking(false); });
    }
    return () => { cancelled = true; };
  }, [retry]);
  const [authorized, setAuthorized] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createError, setCreateError] = useState("");
  const [createNotice, setCreateNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("全部");
  const [previewing, setPreviewing] = useState("");
  const [clip, setClip] = useState<{ id: string; label: string; url: string } | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [management, setManagement] = useState<{ voice: UploadedVoice; kind: "edit" | "delete" } | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [manageError, setManageError] = useState("");
  const [managing, setManaging] = useState(false);
  const mutationPending = useRef(false), previewPending = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip?.url]);
  useEffect(() => { if (!active) audioRef.current?.pause(); }, [active]);
  const load = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { const result = await api.listVoices(); if (mounted.current) { setVoices(result.voices); setUploaded(result.uploaded_voices); } }
    catch (reason) { if (mounted.current) setLoadError(reason instanceof Error ? reason.message : "音色库读取失败"); }
    finally { if (mounted.current) setLoading(false); }
  }, []);
  useEffect(() => { if (active) void load(); }, [load, active]);
  useEffect(() => {
    if (!loading && !loadError && voices.length && value !== "default" && !voices.some(id => id.toLowerCase() === value.toLowerCase())) onChange("default");
  }, [loading, loadError, voices, value, onChange]);
  const metadata = useMemo(() => new Map(uploaded.map(v => [v.name.toLowerCase(), v])), [uploaded]);
  const name = draft.mode === "design" ? draft.designName : draft.cloneName;
  const description = draft.mode === "design" ? draft.description : draft.cloneDescription;
  const reserved = ["default", "yingya-default-narrator", "默认音色"].includes(name.trim().toLowerCase());
  const duplicate = reserved || uploaded.some(v => labelFor(v).toLowerCase() === name.trim().toLowerCase());
  const validName = name.trim().length > 0 && !/[\/\\\0]/.test(name);
  const canCreate = validName && !duplicate && !loading && !loadError && !working && (draft.mode === "design" ? description.trim().length >= 4 : draft.refText.trim() && files[0] && !audioBusy && authorized && fileStatus !== "loading");
  const shown = voices.filter(id => {
    const v = metadata.get(id.toLowerCase()), label = id === "default" ? "默认音色" : v ? labelFor(v) : id;
    return (filter === "全部" || sourceFor(v) === filter) && `${label} ${v?.speaker_description || ""}`.toLowerCase().includes(query.trim().toLowerCase());
  });
  async function preview(id: string, label: string) {
    if (previewPending.current) return;
    if (clip?.id === id && audioRef.current) { if (audioRef.current.paused) void audioRef.current.play().catch(() => setError("请在播放器中点击播放")); else audioRef.current.pause(); return; }
    if (!draft.previewText.trim()) { setError("请填写试听文案"); return; }
    previewPending.current = true; audioRef.current?.pause(); setPreviewing(id); setError("");
    try { const blob = await api.previewVoice(id, draft.previewText.trim()); if (mounted.current) setClip({ id, label, url: URL.createObjectURL(blob) }); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "试听失败，请重试"); }
    finally { previewPending.current = false; if (mounted.current) setPreviewing(""); }
  }
  async function create() {
    if (!canCreate || mutationPending.current) return;
    mutationPending.current = true; setWorking(true); setCreateError(""); setCreateNotice("");
    try {
      const input = { mode: draft.mode, name: name.trim(), description: description.trim(), ...(draft.mode === "clone" ? { refText: draft.refText.trim(), audio: files[0], authorized } : {}) };
      const key = JSON.stringify({ ...input, audio: input.audio ? [input.audio.name, input.audio.size, input.audio.lastModified] : null });
      const request = pending?.key === key ? pending : { key, id: createClientRequestId() };
      setPending(request);
      const job = await api.createVoiceJob({ ...input, clientRequestId: request.id });
      if (!mounted.current) return;
      jobs.accept(job); setCurrentId(job.id); setPending(null);
      setCreateNotice(job.status === "running" ? `“${job.name}”已提交，离开页面后会继续创建。` : job.status === "completed" ? `已保存“${job.name}”，可以在音色库试听。` : "创建未完成，请查看下方原因并重试。");
      setQuery(""); setFilter("全部");
      if (job.status !== "failed") {
        setDraft(current => ({ ...current, ...(draft.mode === "design" ? { designName: "" } : { cloneName: "", refText: "" }) }));
        if (draft.mode === "clone") { setFiles([]); setAuthorized(false); }
      }
      if (job.status === "completed") await load();
    } catch (reason) { if (mounted.current) setCreateError(reason instanceof Error ? reason.message : "创建失败，草稿已保留，请重试"); }
    finally { mutationPending.current = false; if (mounted.current) setWorking(false); }
  }
  function manage(voice: UploadedVoice, kind: "edit" | "delete") { setManagement({ voice, kind }); setEditName(labelFor(voice)); setEditDescription(voice.speaker_description || ""); setManageError(""); }
  async function saveManagement() {
    if (!management || mutationPending.current) return;
    mutationPending.current = true; setManaging(true); setManageError("");
    const { voice, kind } = management;
    try {
      if (kind === "edit") {
        const updated = await api.updateVoice(voice.name, { name: editName.trim(), description: editDescription.trim() });
        setUploaded(items => items.map(item => item.name === updated.name ? { ...updated, used_by: item.used_by } : item));
        if (clip?.id === voice.name) setClip(current => current ? { ...current, label: labelFor(updated) } : null);
        setNotice("音色信息已更新，已有项目继续使用原声音。");
      } else {
        await api.deleteVoice(voice.name);
        setVoices(items => items.filter(id => id !== voice.name)); setUploaded(items => items.filter(item => item.name !== voice.name));
        if (value.toLowerCase() === voice.name.toLowerCase()) onChange("default");
        if (clip?.id === voice.name) { audioRef.current?.pause(); setClip(null); }
        setNotice(`已从音色库删除“${labelFor(voice)}”，已有项目仍可使用。`);
      }
      setManagement(null);
    } catch (reason) { setManageError(reason instanceof Error ? reason.message : "操作失败，请重试"); }
    finally { mutationPending.current = false; setManaging(false); }
  }
  return <section className="voice-manager" aria-label="音色管理">
    <div className="voice-library-panel">
      <header><div><h2>音色库 <small>{voices.length}</small></h2><p>保存常用声音，为新项目选择默认音色。</p></div><button className="voice-new-action" onClick={showCreate}><MagicWand/>创建音色</button><button className="voice-tool" aria-label="刷新音色库" disabled={loading || working || managing} onClick={() => void load()}><ArrowClockwise className={loading ? "spin" : ""}/></button></header>
      <div className="voice-library-tools"><label className="voice-search"><MagnifyingGlass/><input aria-label="搜索音色" placeholder="搜索名称或说明" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="voice-source-tabs" role="group" aria-label="音色来源">{["全部", "描述生成", "克隆音色", "内置音色"].map(source => <button key={source} aria-pressed={filter === source} onClick={() => setFilter(source)}>{source}</button>)}</div></div>
      <label className="voice-preview-copy">试听文案<input disabled={Boolean(previewing)} maxLength={120} value={draft.previewText} onChange={e => { audioRef.current?.pause(); setClip(null); setDraft(current => ({ ...current, previewText: e.target.value })); }}/></label>
      {loadError ? <div className="voice-manager-error" role="alert"><p>{loadError}</p><button onClick={() => void load()}>重新加载音色</button></div> : null}
      {notice ? <p className="voice-manager-notice" role="status">{notice}</p> : null}
      {error ? <p className="voice-manager-error" role="alert">{error}</p> : null}
      <div className="voice-catalog" aria-busy={loading}>{shown.map(id => {
        const v = metadata.get(id.toLowerCase()), label = id === "default" ? "默认音色" : v ? labelFor(v) : id;
        const selected = value.toLowerCase() === id.toLowerCase(), isPlaying = clip?.id === id && playing;
        return <article key={id} aria-label={label} className={selected ? "is-default" : ""}>
          <span className="voice-catalog-icon"><SpeakerHigh/></span><div className="voice-catalog-copy"><b title={label}>{label}</b><small>{sourceFor(v)}{selected ? " · 新项目默认" : ""}{v?.used_by ? ` · ${v.used_by} 个项目使用` : ""}</small>{v?.speaker_description ? <p title={v.speaker_description}>{v.speaker_description}</p> : null}</div>
          <div className="voice-catalog-actions"><button className="voice-tool" aria-label={`${isPlaying ? "暂停" : "试听"} ${label}`} title={isPlaying ? "暂停试听" : "试听音色"} disabled={Boolean(previewing) || !draft.previewText.trim()} onClick={() => void preview(id, label)}>{previewing === id ? <CircleNotch className="spin"/> : isPlaying ? <Pause/> : <Play/>}</button><button className="voice-default-action" disabled={selected || working || managing} onClick={() => { onChange(id); setNotice(`“${label}”已设为新项目默认音色。`); }}>{selected ? <><Check/>已默认</> : "设为默认"}</button>{v ? <><button className="voice-tool" aria-label={`编辑 ${label}`} title="重命名与说明" disabled={working || managing || loading} onClick={() => manage(v, "edit")}><PencilSimple/></button><button className="voice-tool" aria-label={`删除 ${label}`} title="删除音色" disabled={working || managing || loading} onClick={() => manage(v, "delete")}><Trash/></button></> : null}</div>
        </article>;
      })}</div>
      {loading && !voices.length ? <p role="status">正在读取音色…</p> : !shown.length && !loadError ? <div className="voice-empty"><SpeakerHigh/><p>{query || filter !== "全部" ? "没有匹配的音色，试试其他关键词或来源。" : "还没有音色，可以从右侧创建。"}</p></div> : null}
      {clip ? <div className="voice-player"><div><span>正在试听：{clip.label}</span><a href={clip.url} download={`${clip.label}-试听.wav`}><DownloadSimple/>下载试听</a></div><audio ref={audioRef} src={clip.url} controls autoPlay={active} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setClip(null); setError("试听音频无法播放，请重新试听"); }}/></div> : null}
    </div>
    <form ref={createRef} className="voice-create-panel" aria-label="创建音色" onSubmit={e => { e.preventDefault(); void create(); }}>
      <h2>创建音色</h2><div className="voice-create-tabs" role="group" aria-label="音色创建方式">{([['design','描述生成',MagicWand],['clone','克隆音色',UploadSimple]] as const).map(([mode,label,Icon]) => <button type="button" key={mode} disabled={working || audioBusy} aria-pressed={draft.mode === mode} onClick={() => setDraft(current => ({ ...current, mode }))}><Icon/>{label}</button>)}</div>
      <label>音色名称<input maxLength={32} disabled={working} value={name} onChange={e => setDraft(current => ({ ...current, [draft.mode === "design" ? "designName" : "cloneName"]: e.target.value }))} placeholder="例如：品牌讲述者"/></label>
      {duplicate ? <p className="voice-field-error">此名称已被使用，请换一个名称。</p> : name && !validName ? <p className="voice-field-error">名称不能包含路径符号。</p> : null}
      {draft.mode === "design" ? <><label>声音描述<textarea maxLength={200} disabled={working} value={description} onChange={e => setDraft(current => ({ ...current, description: e.target.value }))} placeholder="年龄、音色、语速、情绪与适用场景"/></label><div className="voice-description-ideas">{ideas.map(([label, text]) => <button type="button" key={label} disabled={working} onClick={() => setDraft(current => ({ ...current, description: text }))}>{label}</button>)}</div><small>描述声音特点，4–200 个字符。创建后可试听。</small></> : <><VoiceAudioInput active={active} value={files[0] || null} onChange={file => setFiles(file ? [file] : [])} disabled={working || fileStatus === "loading"} onBusyChange={setAudioBusy}/><label>参考音频原文<textarea maxLength={500} disabled={working} value={draft.refText} onChange={e => setDraft(current => ({ ...current, refText: e.target.value }))} placeholder="逐字填写参考音频里的内容"/></label><label>音色说明（可选）<input maxLength={200} disabled={working} value={description} onChange={e => setDraft(current => ({ ...current, cloneDescription: e.target.value }))}/></label><label className="voice-consent"><input type="checkbox" checked={authorized} disabled={working} onChange={e => setAuthorized(e.target.checked)}/><span>我已获得声音所有者授权，同意用于声音合成</span></label></>}
      <button className="voice-create-submit" disabled={!canCreate}>{working ? <CircleNotch className="spin"/> : <MagicWand/>}{working ? "正在提交" : "创建音色"}</button>
      {createError ? <p className="voice-manager-error" role="alert">{createError}</p> : null}
      {createNotice && !currentJob ? <p className="voice-manager-notice" role="status">{createNotice}</p> : null}
      {currentJob ? <div className="voice-current-task" role="status"><GenerationStatus status={currentJob.status}/><strong>{currentJob.name}</strong><p>{currentJob.status === "running" ? "音色正在创建，离开页面后会继续。" : currentJob.status === "completed" ? "已保存到音色库，可以试听或设为默认。" : currentJob.error || "创建未完成，可从任务记录编辑重试。"}</p><button type="button" onClick={onTasks}>查看任务记录</button></div> : null}
      <small role="status">{!draftSaved || fileStatus === "error" ? "草稿暂时无法保存，请保持页面打开。" : fileStatus === "loading" ? "正在恢复参考音频…" : fileStatus === "saving" ? "正在保存参考音频…" : "草稿自动保存在此浏览器"}</small>
    </form>
    {management ? <ActionDialog title={management.kind === "edit" ? "编辑音色" : "删除音色"} busy={managing} onClose={() => setManagement(null)}><form className="voice-management-form" onSubmit={e => { e.preventDefault(); void saveManagement(); }}>{management.kind === "edit" ? <><label>音色名称<input autoFocus maxLength={32} value={editName} disabled={managing} onChange={e => setEditName(e.target.value)}/></label><label>音色说明<textarea maxLength={200} value={editDescription} disabled={managing} onChange={e => setEditDescription(e.target.value)}/></label><p>名称和说明不改变声音，已有项目引用保持不变。</p><small>{sourceFor(management.voice)}{management.voice.created_at ? ` · ${new Date(management.voice.created_at < 1e12 ? management.voice.created_at * 1000 : management.voice.created_at).toLocaleDateString("zh-CN")}` : ""}</small>{management.voice.ref_text ? <details><summary>参考音频原文</summary><p>{management.voice.ref_text}</p></details> : null}</> : <><p>从音色库删除“{labelFor(management.voice)}”？</p><p>{management.voice.used_by ? `${management.voice.used_by} 个已有项目仍可使用这个声音。` : "已有项目使用的声音会保留。"}删除后不能再为新项目选择。</p>{value === management.voice.name ? <p>新项目默认音色将恢复为“默认音色”。</p> : null}</>}{manageError ? <p className="form-error" role="alert">{manageError}</p> : null}<footer><button type="button" disabled={managing} onClick={() => setManagement(null)}>取消</button><button className={management.kind === "delete" ? "danger-action" : "primary-button"} disabled={managing || (management.kind === "edit" && !editName.trim())}>{managing ? "正在保存…" : management.kind === "delete" ? "确认删除" : "保存修改"}</button></footer></form></ActionDialog> : null}
  </section>;
}
