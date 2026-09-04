import {
  CaretDown, Check, CircleNotch, DownloadSimple, FolderSimple, Image as ImageIcon, Images,
  MagnifyingGlass, Paperclip, Plus, Sparkle, UploadSimple, Waveform, X,
} from "@phosphor-icons/react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import type { ImageLibraryAsset, ModelSelection, ProjectRecord } from "../types";
import { ModelSelector } from "./ModelSelector";
import { ProjectSidebar } from "./ProjectSidebar";
import { VoiceStudio } from "./VoiceStudio";

type UsageRecord = { projectId: string; projectTitle: string; addedAt: number };
type UsageIndex = Record<string, UsageRecord[]>;
type GenerationJob = { id: string; prompt: string; state: "running" | "done" | "failed"; createdAt: number };
const usageStorageKey = "yingya-image-usage-v1";

function readUsage(): UsageIndex {
  try { return JSON.parse(localStorage.getItem(usageStorageKey) ?? "{}"); }
  catch { return {}; }
}
function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replaceAll("/", "-");
}
function assetName(asset: ImageLibraryAsset) { return asset.prompt?.trim() || asset.sourceName?.trim() || "未命名素材"; }
function fileNameFor(asset: ImageLibraryAsset) {
  const extension = asset.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const base = (asset.sourceName || asset.prompt || asset.id).replace(/[\\/:*?"<>|]/g, "-").slice(0, 48);
  return `${base}.${extension}`;
}

export function AssetStudio({ projects, models, selection, voiceId, onSelection, onVoice, onCreate, onOpen, onDelete }: { projects: ProjectRecord[]; models: Parameters<typeof ModelSelector>[0]["models"]; selection: ModelSelection; voiceId: string; onSelection: (value: ModelSelection) => void; onVoice: (value: string) => void; onCreate: () => void; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void> }) {
  const [tab, setTab] = useState<"images" | "voices">("images");
  const [images, setImages] = useState<ImageLibraryAsset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [usageFilter, setUsageFilter] = useState<"all" | "unused" | "used">("all");
  const [usage, setUsage] = useState<UsageIndex>(readUsage);
  const [targetProjectId, setTargetProjectId] = useState(projects[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<File[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = (await api.listImages()).images;
      setImages(next);
      setSelectedId(current => next.some(item => item.id === current) ? current : next[0]?.id ?? "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片素材库读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!targetProjectId && projects[0]) setTargetProjectId(projects[0].id); }, [projects, targetProjectId]);

  const filtered = useMemo(() => {
    const keyword = deferredQuery.trim().toLocaleLowerCase();
    return images.filter(image => {
      const matchesQuery = !keyword || `${image.prompt ?? ""} ${image.sourceName ?? ""}`.toLocaleLowerCase().includes(keyword);
      const isUsed = Boolean(usage[image.id]?.length);
      return matchesQuery && (usageFilter === "all" || (usageFilter === "used" ? isUsed : !isUsed));
    });
  }, [deferredQuery, images, usage, usageFilter]);
  const recent = filtered.filter(image => usage[image.id]?.length).sort((a, b) => (usage[b.id]?.[0]?.addedAt ?? 0) - (usage[a.id]?.[0]?.addedAt ?? 0)).slice(0, 5);
  const remaining = filtered.filter(image => !recent.some(item => item.id === image.id));
  const selected = images.find(image => image.id === selectedId) ?? null;
  const selectedUsage = selected ? usage[selected.id] ?? [] : [];

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError("");
    try { for (const file of Array.from(files)) await api.uploadImage(file); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "素材上传失败"); }
    finally { setUploading(false); if (uploadRef.current) uploadRef.current.value = ""; }
  }

  async function generate(event: FormEvent) {
    event.preventDefault(); if (!prompt.trim() || busy) return;
    const job: GenerationJob = { id: crypto.randomUUID(), prompt: prompt.trim(), state: "running", createdAt: Date.now() };
    setJobs(current => [job, ...current].slice(0, 3)); setBusy(true); setError("");
    try {
      const referenceImages: string[] = [];
      for (const file of references) referenceImages.push((await api.uploadImage(file)).url);
      const { threadId } = await api.startImageThread();
      await api.generateImage(threadId, { prompt: prompt.trim(), referenceImages, ...selection });
      setJobs(current => current.map(item => item.id === job.id ? { ...item, state: "done" } : item));
      setPrompt(""); setReferences([]); setDrawerOpen(false); await load();
    } catch (reason) {
      setJobs(current => current.map(item => item.id === job.id ? { ...item, state: "failed" } : item));
      setError(reason instanceof Error ? reason.message : "图片生成失败");
    } finally { setBusy(false); }
  }

  async function addToProject() {
    if (!selected || !targetProjectId || adding) return;
    const project = projects.find(item => item.id === targetProjectId); if (!project) return;
    setAdding(true); setError("");
    try {
      const response = await fetch(selected.url); if (!response.ok) throw new Error("素材文件读取失败");
      const blob = await response.blob();
      await api.uploadAsset(project.id, new File([blob], fileNameFor(selected), { type: selected.mimeType }));
      const record: UsageRecord = { projectId: project.id, projectTitle: project.title, addedAt: Date.now() };
      setUsage(current => {
        const next = { ...current, [selected.id]: [record, ...(current[selected.id] ?? []).filter(item => item.projectId !== project.id)] };
        localStorage.setItem(usageStorageKey, JSON.stringify(next)); return next;
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "添加到项目失败"); }
    finally { setAdding(false); }
  }
  function selectAsset(image: ImageLibraryAsset) { setSelectedId(image.id); setInspectorOpen(true); }

  return <div className="start-layout asset-layout">
    <ProjectSidebar projects={projects} activeSection="assets" onCreate={onCreate} onAssets={() => undefined} onOpen={onOpen} onDelete={onDelete}/>
    <main className="asset-main">
      <header className="asset-toolbar">
        <label className="asset-search"><MagnifyingGlass/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索素材" aria-label="搜索素材"/><kbd>⌘ K</kbd></label>
        <nav className="asset-type-tabs" aria-label="素材类型"><button className={tab === "images" ? "active" : ""} onClick={() => setTab("images")}><Images/>图片</button><button className={tab === "voices" ? "active" : ""} onClick={() => setTab("voices")}><Waveform/>音色</button></nav>
        {tab === "images" ? <nav className="asset-filter-tabs" aria-label="素材使用状态">{([["all", "全部"], ["unused", "未使用"], ["used", "项目中"]] as const).map(([value, label]) => <button key={value} className={usageFilter === value ? "active" : ""} onClick={() => setUsageFilter(value)}>{label}</button>)}</nav> : null}
        <div className="asset-toolbar-actions">
          {tab === "images" ? <><button className="asset-upload-button" onClick={() => uploadRef.current?.click()} disabled={uploading}>{uploading ? <CircleNotch className="spin"/> : <UploadSimple/>}上传</button><input hidden ref={uploadRef} type="file" accept="image/*" multiple onChange={event => void uploadFiles(event.target.files)}/></> : null}
          <button className="asset-create-button" onClick={() => setDrawerOpen(true)}><Sparkle weight="fill"/>创建素材<CaretDown/></button>
        </div>
      </header>
      {tab === "voices" ? <div className="asset-voice-content"><VoiceStudio value={voiceId} onChange={onVoice}/></div> : <div className={`asset-browser ${inspectorOpen ? "has-inspector" : ""}`}>
        <div className="asset-catalog">
          {error ? <p className="asset-page-error" role="alert">{error}</p> : null}
          {recent.length ? <AssetSection title="最近使用" images={recent} selectedId={selectedId} usage={usage} onSelect={selectAsset}/> : null}
          {remaining.length ? <AssetSection title={usageFilter === "used" ? "项目中" : usageFilter === "unused" ? "未使用" : recent.length ? "其他素材" : "全部素材"} images={remaining} selectedId={selectedId} usage={usage} onSelect={selectAsset}/> : null}
          {!loading && !filtered.length ? <div className="asset-empty-state"><Images/><h2>{query ? "没有匹配的素材" : "暂无图片素材"}</h2><button onClick={() => query ? setQuery("") : setDrawerOpen(true)}>{query ? "清除搜索" : "创建素材"}</button></div> : null}
          {loading ? <p className="asset-loading"><CircleNotch className="spin"/>正在读取素材…</p> : null}
        </div>
        {inspectorOpen ? <aside className="asset-inspector">
          <header><strong>{selected ? assetName(selected) : "素材详情"}</strong><button aria-label="关闭详情" onClick={() => setInspectorOpen(false)}><X/></button></header>
          {selected ? <><div className="asset-preview"><img src={selected.url} alt={assetName(selected)}/><span>{selected.mimeType.replace("image/", "").toUpperCase()}</span></div>
            <section><h3>提示词</h3><p>{selected.prompt || "上传素材，无生成提示词。"}</p></section>
            <section><h3>参数</h3><dl><div><dt>来源</dt><dd>{selected.kind === "generated" ? "AI 生成" : "本地上传"}</dd></div><div><dt>格式</dt><dd>{selected.mimeType.replace("image/", "").toUpperCase()}</dd></div><div><dt>添加时间</dt><dd>{formatDate(selected.createdAt)}</dd></div></dl></section>
            <section className="asset-usage-section"><div className="asset-section-title"><h3>使用位置</h3><span>{selectedUsage.length}</span></div>{selectedUsage.map(item => <button className="asset-usage-row" key={item.projectId} onClick={() => onOpen(item.projectId)}><FolderSimple/><span><b>{item.projectTitle}</b><small>{formatDate(item.addedAt)}</small></span><CaretDown/></button>)}<div className="asset-add-project"><select value={targetProjectId} onChange={event => setTargetProjectId(event.target.value)} aria-label="选择项目"><option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select><button onClick={() => void addToProject()} disabled={!targetProjectId || adding}>{adding ? <CircleNotch className="spin"/> : <Plus/>}添加</button></div></section>
            <section><div className="asset-section-title"><h3>生成任务</h3><span>{jobs.length}</span></div>{jobs.length ? jobs.map(job => <div className="asset-job" key={job.id}><ImageIcon/><span><b>{job.prompt}</b><small>{job.state === "running" ? "生成中" : job.state === "done" ? "已完成" : "失败"}</small></span>{job.state === "running" ? <CircleNotch className="spin"/> : job.state === "done" ? <Check/> : <X/>}</div>) : <p className="asset-muted">当前没有生成任务</p>}</section>
            <a className="asset-download" href={selected.url} download><DownloadSimple/>下载素材</a></> : <div className="asset-empty-state"><ImageIcon/><p>选择一项素材查看详情</p></div>}
        </aside> : null}
      </div>}
    </main>
    {drawerOpen ? <div className="asset-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDrawerOpen(false); }}><aside className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-drawer-title"><header><h2 id="asset-drawer-title">{tab === "images" ? "创建图片" : "创建音色"}</h2><button aria-label="关闭创建面板" onClick={() => setDrawerOpen(false)}><X/></button></header>{tab === "voices" ? <VoiceStudio value={voiceId} onChange={onVoice} compact/> : <form className="asset-create-form" onSubmit={generate}><label><span>画面描述</span><textarea autoFocus value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="主体、场景、构图、光线和画幅要求"/></label>{references.length ? <div className="reference-files">{references.map((file, index) => <span key={`${file.name}-${index}`}><ImageIcon/>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setReferences(files => files.filter((_, itemIndex) => itemIndex !== index))}><X/></button></span>)}</div> : null}<button type="button" className="asset-reference-button" onClick={() => referenceRef.current?.click()}><Paperclip/>添加参考图</button><input hidden ref={referenceRef} type="file" accept="image/*" multiple onChange={event => setReferences(Array.from(event.target.files ?? []))}/><label><span>生成模型</span><ModelSelector models={models} value={selection} onChange={onSelection}/></label><button className="asset-primary" disabled={!prompt.trim() || busy}>{busy ? <CircleNotch className="spin"/> : <Sparkle weight="fill"/>}{busy ? "正在生成" : "生成图片"}</button>{error ? <p className="asset-error" role="alert">{error}</p> : null}</form>}</aside></div> : null}
  </div>;
}

function AssetSection({ title, images, selectedId, usage, onSelect }: { title: string; images: ImageLibraryAsset[]; selectedId: string; usage: UsageIndex; onSelect: (image: ImageLibraryAsset) => void }) {
  return <section className="asset-grid-section"><header><h2>{title}</h2><span>{images.length}</span></header><div className="asset-image-grid">{images.map(image => <button className={selectedId === image.id ? "selected" : ""} key={image.id} onClick={() => onSelect(image)}><span className="asset-card-image"><img src={image.url} alt=""/><i><ImageIcon/></i></span><b title={assetName(image)}>{assetName(image)}</b><small>{usage[image.id]?.length ? `${usage[image.id].length} 个项目` : image.kind === "generated" ? "AI 生成" : "已上传"} · {formatDate(image.createdAt)}</small></button>)}</div></section>;
}
