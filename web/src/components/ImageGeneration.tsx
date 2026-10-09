import { useEffect, useRef, useState, type FormEvent } from "react";
import { CheckCircle, CircleNotch, DownloadSimple, Image as ImageIcon, Paperclip, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import { z } from "zod";
import { api } from "../api";
import { assetName } from "../assetNames";
import { createClientRequestId } from "../requestId";
import type { ImageJob } from "../schemas";
import type { ModelSelection } from "../types";
import type { JobList } from "../hooks/useAssetJobs";
import { useSavedState } from "../hooks/useSavedState";
import { useDraftFiles } from "../hooks/useDraftFiles";
import { useUploadQueue } from "../hooks/useUploadQueue";
import { ModelSelector } from "./ModelSelector";
import { UploadProgressList } from "./UploadProgressList";
import "./image-generation.css";

const statusLabels = { running: "生成中", completed: "已完成", failed: "失败" };
export function GenerationStatus({ status }: { status: ImageJob["status"] }) {
  const Icon = status === "running" ? CircleNotch : status === "completed" ? CheckCircle : WarningCircle;
  return <span className={`image-job-status image-job-status--${status}`}><Icon aria-hidden="true" className={status === "running" ? "spin" : undefined}/>{statusLabels[status]}</span>;
}
function JobImage({ image }: { image: ImageJob["images"][number] }) {
  const [failed, setFailed] = useState(false);
  const name = assetName(image);
  return <figure>{failed ? <p>图片已移除或暂时不可用，请查看素材库。</p> : <><img src={image.url} alt={name} onError={() => setFailed(true)}/><figcaption><span>{name}</span><a href={image.url} download={name}><DownloadSimple/>下载</a></figcaption></>}</figure>;
}
export function ImageJobDetail({ job, onReuse, onLibrary }: { job: ImageJob; onReuse: () => void; onLibrary: () => void }) {
  return <div className="image-job-detail"><GenerationStatus status={job.status}/>
    <p role="status">{job.status === "running" ? "正在生成，离开页面后任务会继续。" : job.status === "completed" ? `已生成 ${job.images.length} 张图片，已保存到素材库。` : job.error || "生成失败，描述与参考图已保留。"}</p>
    {job.images.length ? <div className="image-job-results">{job.images.map(image => <JobImage key={image.id} image={image}/>)}</div> : null}
    {job.status !== "running" ? <div className="generation-result-actions"><button onClick={onReuse}>{job.status === "failed" ? "编辑后重试" : "复用参数"}</button>{job.status === "completed" ? <button onClick={onLibrary}>查看素材库</button> : null}</div> : null}
    <details className="generation-parameters"><summary>生成参数</summary><p>{job.model} · {job.reasoningEffort}</p><p className="image-job-description">{job.prompt}</p>{job.referenceImages.length ? <div className="image-job-references">{job.referenceImages.map((url, index) => <img key={`${url}-${index}`} src={url} alt={`参考图 ${index + 1}`}/>)}</div> : null}</details>
  </div>;
}
const draftSchema = z.object({ prompt: z.string(), savedReferences: z.array(z.string()), selectedId: z.string(), pending: z.object({ key: z.string(), id: z.string() }).nullable() });
const emptyDraft = { prompt: "", savedReferences: [] as string[], selectedId: "", pending: null };
export function ImageGeneration({ jobs, retry, models, selection, onSelection, onLibrary, onTasks }: {
  jobs: JobList<ImageJob>; retry: { job: ImageJob } | null;
  models: Parameters<typeof ModelSelector>[0]["models"]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; onLibrary: () => void; onTasks: () => void;
}) {
  const [draft, setDraft, draftSaved] = useSavedState("yingya-image-studio-draft", draftSchema, emptyDraft);
  const [references, setReferences, filesStatus] = useDraftFiles("yingya-image-references");
  const [submitting, setSubmitting] = useState(false), [error, setError] = useState("");
  const submittingRef = useRef(false), referenceInput = useRef<HTMLInputElement>(null), promptRef = useRef<HTMLTextAreaElement>(null);
  const referenceUploads = useUploadQueue<Awaited<ReturnType<typeof api.uploadImage>>>();
  const selected = jobs.jobs.find(job => job.id === draft.selectedId) || jobs.jobs[0];
  function reuse(job: ImageJob) {
    setDraft(current => ({ ...current, prompt: job.prompt, savedReferences: job.referenceImages, selectedId: job.id, pending: null }));
    setReferences([]); setError(""); onSelection({ model: job.model, reasoningEffort: job.reasoningEffort }); promptRef.current?.focus();
  }
  useEffect(() => { if (retry) reuse(retry.job); }, [retry]);
  async function generate(event: FormEvent) {
    event.preventDefault(); if (!draft.prompt.trim() || submittingRef.current || filesStatus === "loading") return;
    submittingRef.current = true; setSubmitting(true); setError("");
    try {
      const uploaded = await referenceUploads.run(references.map(file => ({ id: `${file.name}:${file.size}:${file.lastModified}`, name: file.name, size: file.size, run: (options: import("../upload").UploadOptions) => api.uploadImage(file, options) })));
      const referenceImages = [...draft.savedReferences, ...uploaded.map(image => image.url)];
      const input = { prompt: draft.prompt.trim(), referenceImages, ...selection };
      const key = JSON.stringify(input), pending = draft.pending?.key === key ? draft.pending : { key, id: createClientRequestId() };
      setDraft(current => ({ ...current, savedReferences: referenceImages, pending })); setReferences([]); referenceUploads.clearCompleted();
      const job = await api.createImageJob({ ...input, clientRequestId: pending.id });
      jobs.accept(job); setDraft(current => ({ ...current, selectedId: job.id, pending: null }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "提交失败，请重试；已接收的任务可在任务记录查看。"); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  return <section className="asset-image-workspace" aria-label="图片生成工作区">
    <form className="asset-create-form" onSubmit={generate}>
      <div><h2>生成图片</h2><p>写下画面想法，也可以加入参考图。</p></div>
      <label><span>画面描述</span><textarea ref={promptRef} disabled={submitting} value={draft.prompt} onChange={event => setDraft(current => ({ ...current, prompt: event.target.value }))} placeholder="主体、场景、构图、光线和画幅要求"/></label>
      {draft.savedReferences.length || references.length ? <div className="reference-files">{draft.savedReferences.map((url, index) => <span key={`${url}-${index}`}><img src={url} alt=""/>参考图 {index + 1}<button type="button" disabled={submitting} aria-label={`移除参考图 ${index + 1}`} onClick={() => setDraft(current => ({ ...current, savedReferences: current.savedReferences.filter((_, i) => i !== index) }))}><X/></button></span>)}{references.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<button type="button" disabled={submitting} aria-label={`移除 ${file.name}`} onClick={() => setReferences(files => files.filter((_, i) => i !== index))}><X/></button></span>)}</div> : null}
      <button type="button" disabled={submitting || filesStatus === "loading"} className="asset-reference-button" onClick={() => referenceInput.current?.click()}><Paperclip/>添加参考图</button>
      <input hidden ref={referenceInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={submitting} multiple onChange={event => { const added = Array.from(event.target.files ?? []); setReferences(current => [...current, ...added.filter(file => !current.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified))]); event.target.value = ""; }}/>
      <UploadProgressList items={referenceUploads.items}/>
      <label><span>生成模型</span><ModelSelector models={models} value={selection} onChange={onSelection} disabled={submitting}/></label>
      <button className="asset-primary" disabled={!draft.prompt.trim() || submitting || filesStatus === "loading"}>{submitting ? <CircleNotch className="spin"/> : <Sparkle/>}{submitting ? "正在提交" : "生成图片"}</button>
      {error ? <p className="asset-error" role="alert">{error}</p> : null}
      <small role="status">{!draftSaved || filesStatus === "error" ? "草稿暂时无法保存，请保持页面打开。" : filesStatus === "loading" ? "正在恢复参考图…" : filesStatus === "saving" ? "正在保存参考图…" : "草稿自动保存，生成结果收入素材库。"}</small>
    </form>
    <aside className="asset-generation-preview" aria-label="图片生成结果"><header><h2>生成结果</h2><button onClick={onTasks}>全部记录</button></header>
      {jobs.error ? <p className="asset-error" role="alert">记录暂时无法更新。<button onClick={jobs.refresh}>重新读取</button></p> : null}
      {selected ? <ImageJobDetail job={selected} onReuse={() => reuse(selected)} onLibrary={onLibrary}/> : <div className="generation-empty"><ImageIcon/><h3>{jobs.loading ? "正在读取记录…" : "画面会出现在这里"}</h3><p>生成后可预览、下载，或复用参数继续调整。</p></div>}
    </aside>
  </section>;
}
