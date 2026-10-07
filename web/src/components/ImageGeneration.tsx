import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { CaretDown, CheckCircle, CircleNotch, ClockCounterClockwise, DownloadSimple, Paperclip, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import { api } from "../api";
import { createClientRequestId } from "../requestId";
import type { ImageJob } from "../schemas";
import type { ModelSelection } from "../types";
import { useUploadQueue } from "../hooks/useUploadQueue";
import { ActionDialog } from "./ActionDialog";
import { ModelSelector } from "./ModelSelector";
import { UploadProgressList } from "./UploadProgressList";
import "./image-generation.css";

const statusLabels = { running: "生成中", completed: "已完成", failed: "失败" };
const filters = [{ id: "all", label: "全部记录" }, { id: "running", label: "生成中" }, { id: "completed", label: "已完成" }, { id: "failed", label: "失败" }] as const;
function Status({ status }: { status: ImageJob["status"] }) {
  const Icon = status === "running" ? CircleNotch : status === "completed" ? CheckCircle : WarningCircle;
  return <span className={`image-job-status image-job-status--${status}`}><Icon aria-hidden="true" className={status === "running" ? "spin" : undefined}/>{statusLabels[status]}</span>;
}
function JobImage({ image }: { image: ImageJob["images"][number] }) {
  const [failed, setFailed] = useState(false);
  return <figure>{failed ? <p>图片已移除或暂时不可用，请查看素材库。</p> : <><img src={image.url} alt={image.revisedPrompt || "生成的图片"} onError={() => setFailed(true)}/><a href={image.url} download><DownloadSimple/>下载图片</a></>}</figure>;
}

export function ImageGeneration({ open, onClose, onOpen, returnFocus, models, selection, onSelection, onCompleted }: {
  open: boolean; onClose: () => void; onOpen: () => void; returnFocus: RefObject<HTMLButtonElement | null>;
  models: Parameters<typeof ModelSelector>[0]["models"]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; onCompleted: () => Promise<void>;
}) {
  const [jobs, setJobs] = useState<ImageJob[]>([]);
  const jobsRef = useRef<ImageJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<File[]>([]);
  const [savedReferences, setSavedReferences] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const referenceInput = useRef<HTMLInputElement>(null);
  const referenceUploads = useUploadQueue<Awaited<ReturnType<typeof api.uploadImage>>>();
  const pendingSubmission = useRef<{ key: string; id: string } | null>(null);
  const panelId = useId();
  const running = jobs.filter(job => job.status === "running").length;
  const failed = jobs.filter(job => job.status === "failed").length;
  const isExpanded = expanded ?? running > 0;
  const selected = jobs.find(job => job.id === selectedId);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let fetching = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (fetching || disposed) return;
      clearTimeout(timer); fetching = true;
      try {
        const next = await api.listImageJobs(controller.signal);
        if (disposed) return;
        const completed = next.some(job => job.status === "completed" && !jobsRef.current.some(old => old.id === job.id && old.status === "completed"));
        jobsRef.current = next; setJobs(next); setLoadError("");
        if (next.some(job => job.status === "running")) setExpanded(current => current ?? true);
        if (completed) void onCompleted();
      } catch (reason) {
        if (!disposed) setLoadError(reason instanceof Error ? reason.message : "生成记录读取失败");
      } finally {
        fetching = false;
        if (!disposed) { setLoading(false); timer = setTimeout(() => void refresh(), jobsRef.current.some(job => job.status === "running") ? 1500 : 5000); }
      }
    };
    const focus = () => { if (!document.hidden) void refresh(); };
    void refresh();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [refreshKey, onCompleted]);

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || submittingRef.current) return;
    submittingRef.current = true; setSubmitting(true); setError("");
    try {
      const uploaded = await referenceUploads.run(references.map(file => ({ id: `${file.name}:${file.size}:${file.lastModified}`, name: file.name, size: file.size, run: (options: import("../upload").UploadOptions) => api.uploadImage(file, options) })));
      const referenceImages = [...savedReferences, ...uploaded.map(image => image.url)];
      // Preserve uploaded references and the request ID if acceptance is uncertain.
      setSavedReferences(referenceImages); setReferences([]); referenceUploads.clearCompleted();
      const input = { prompt: prompt.trim(), referenceImages, ...selection };
      const key = JSON.stringify(input);
      if (pendingSubmission.current?.key !== key) pendingSubmission.current = { key, id: createClientRequestId() };
      const job = await api.createImageJob({ ...input, clientRequestId: pendingSubmission.current.id });
      const next = [job, ...jobsRef.current.filter(item => item.id !== job.id)];
      jobsRef.current = next; setJobs(next); setRefreshKey(value => value + 1);
      setExpanded(true); setFilter("all"); setSelectedId(job.id);
      setPrompt(""); setSavedReferences([]); pendingSubmission.current = null;
      onClose();
      if (job.status === "completed") void onCompleted();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "提交失败，请重试；已接收的任务可在生成记录查看。"); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }

  function retry(job: ImageJob) {
    setPrompt(job.prompt); setSavedReferences(job.referenceImages); setReferences([]); setError("");
    onSelection({ model: job.model, reasoningEffort: job.reasoningEffort });
    setSelectedId(null); onOpen();
  }

  return <>
    <section className="image-jobs" aria-label="图片生成记录">
      <button type="button" className="image-jobs-toggle" aria-expanded={isExpanded} aria-controls={panelId} onClick={() => setExpanded(!isExpanded)}>
        <ClockCounterClockwise aria-hidden="true"/><strong>生成记录</strong>
        <span aria-live="polite">{loading ? "正在读取…" : loadError && !jobs.length ? "暂时无法读取" : `${running ? `${running} 项生成中 · ` : ""}${failed ? `${failed} 项失败 · ` : ""}${jobs.length} 条记录`}</span>
        <CaretDown aria-hidden="true"/>
      </button>
      {loadError ? <p className="image-jobs-error" role="alert">生成记录暂时无法更新，已有记录已保留。<button type="button" onClick={() => setRefreshKey(value => value + 1)}>重新读取</button></p> : null}
      {isExpanded ? <div id={panelId}>
        <nav className="image-jobs-filters" aria-label="生成状态">{filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<small>{item.id === "all" ? jobs.length : jobs.filter(job => job.status === item.id).length}</small></button>)}</nav>
        <ul className="image-jobs-list">{jobs.filter(job => filter === "all" || job.status === filter).map(job => <li key={job.id}><button type="button" onClick={() => setSelectedId(job.id)}><Status status={job.status}/><span className="image-job-prompt">{job.prompt}</span><time dateTime={new Date(job.createdAt).toISOString()}>{new Date(job.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><span className="image-job-view">查看详情</span></button></li>)}</ul>
        {!loading && !loadError && !jobs.some(job => filter === "all" || job.status === filter) ? <p className="image-jobs-empty">{jobs.length ? "没有这个状态的生成记录" : "还没有生成记录，创建图片后可在这里查看进度和结果。"}</p> : null}
      </div> : null}
    </section>
    {open ? <ActionDialog className="asset-drawer" title="生成图片" closeLabel="关闭创建面板" returnFocus={returnFocus} onClose={onClose}>
      <div className="asset-image-workspace"><form className="asset-create-form" onSubmit={generate}>
        <label><span>画面描述</span><textarea autoFocus disabled={submitting} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="主体、场景、构图、光线和画幅要求"/></label>
        {savedReferences.length || references.length ? <div className="reference-files">{savedReferences.map((url, index) => <span key={url}>参考图 {index + 1}<button type="button" disabled={submitting} aria-label={`移除参考图 ${index + 1}`} onClick={() => setSavedReferences(current => current.filter(item => item !== url))}><X/></button></span>)}{references.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button type="button" disabled={submitting} aria-label={`移除 ${file.name}`} onClick={() => setReferences(files => files.filter((_, i) => i !== index))}><X/></button></span>)}</div> : null}
        <button type="button" disabled={submitting} className="asset-reference-button" onClick={() => referenceInput.current?.click()}><Paperclip/>添加参考图</button>
        <input hidden ref={referenceInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={submitting} multiple onChange={event => { const added = Array.from(event.target.files ?? []); setReferences(current => [...current, ...added.filter(file => !current.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified))]); event.target.value = ""; }}/>
        <UploadProgressList items={referenceUploads.items}/>
        <label><span>生成模型</span><ModelSelector models={models} value={selection} onChange={onSelection} disabled={submitting}/></label>
        <button className="asset-primary" disabled={!prompt.trim() || submitting}>{submitting ? <CircleNotch className="spin"/> : <Sparkle weight="fill"/>}{submitting ? "正在提交" : "生成图片"}</button>
        {error ? <p className="asset-error" role="alert">{error}</p> : null}
      </form><aside className="asset-generation-preview"><h3>描述你需要的画面</h3><p>提交后可关闭面板，在素材页的“生成记录”查看进度和结果。</p></aside></div>
    </ActionDialog> : null}
    {selected && !open ? <ActionDialog className="image-job-dialog" title="生成记录" dismissOnBackdrop onClose={() => setSelectedId(null)}>
      <div className="image-job-detail"><Status status={selected.status}/>
        <p role="status">{selected.status === "running" ? "图片正在生成，可以关闭面板。切换页面或刷新后，仍可在生成记录查看。" : selected.status === "completed" ? `已生成 ${selected.images.length} 张图片，已保存到素材库。` : selected.error || "图片未能生成，描述和参考图已保留，可以编辑后重试。"}</p>
        <section><h3>画面描述</h3><p className="image-job-description">{selected.prompt}</p></section>
        {selected.referenceImages.length ? <section><h3>参考图</h3><div className="image-job-references">{selected.referenceImages.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`参考图 ${index + 1}`}/>)}</div></section> : null}
        {selected.images.length ? <div className="image-job-results">{selected.images.map(image => <JobImage key={image.id} image={image}/>)}</div> : null}
        {selected.status === "failed" ? <button type="button" className="primary-button" onClick={() => retry(selected)}>编辑后重试</button> : null}
      </div>
    </ActionDialog> : null}
  </>;
}
