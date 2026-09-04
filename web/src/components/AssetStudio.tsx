import {
  ArrowRight, CaretDown, Check, CircleNotch, DownloadSimple, File as FileIcon, FileAudio, FileText,
  FilmSlate, FolderOpen, FolderSimple, Folders, Image as ImageIcon, Images,
  MagnifyingGlass, MusicNotes, Paperclip, Plus, Sparkle, SpeakerHigh, UploadSimple,
  VideoCamera, Waveform, X,
} from "@phosphor-icons/react";
import { useCallback, useDeferredValue, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import type { AssetFolder, AssetLibraryItem, ModelSelection, ProjectRecord } from "../types";
import { ModelSelector } from "./ModelSelector";
import { VoiceStudio } from "./VoiceStudio";

type UsageRecord = { projectId: string; projectTitle: string; addedAt: number };
type UsageIndex = Record<string, UsageRecord[]>;
type GenerationJob = { id: string; prompt: string; state: "running" | "done" | "failed"; createdAt: number };
type AssetTab = "all" | "image" | "video" | "audio" | "voice" | "document";
type SourceFilter = "all" | "uploaded" | "generated";
const usageStorageKey = "yingya-image-usage-v1";

const typeTabs: { id: AssetTab; label: string; icon: typeof Images }[] = [
  { id: "all", label: "全部", icon: Folders },
  { id: "image", label: "图片", icon: Images },
  { id: "video", label: "视频", icon: VideoCamera },
  { id: "audio", label: "音频", icon: MusicNotes },
  { id: "voice", label: "音色", icon: Waveform },
  { id: "document", label: "文档", icon: FileText },
];

function readUsage(): UsageIndex {
  try { return JSON.parse(localStorage.getItem(usageStorageKey) ?? "{}"); }
  catch { return {}; }
}
function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replaceAll("/", "-");
}
function assetName(asset: AssetLibraryItem) { return asset.sourceName?.trim() || asset.prompt?.trim() || "未命名素材"; }
function fileNameFor(asset: AssetLibraryItem) {
  if (asset.sourceName) return asset.sourceName;
  const extension = asset.mimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
  return `${(asset.prompt || asset.id).replace(/[\\/:*?"<>|]/g, "-").slice(0, 48)}.${extension}`;
}
function assetTypeLabel(asset: AssetLibraryItem) {
  if (asset.category === "image") return "图片";
  if (asset.category === "video") return "视频";
  if (asset.category === "audio") return "音频";
  if (asset.category === "document") return "文档";
  return "文件";
}
function assetFormat(asset: AssetLibraryItem) {
  const subtype = asset.mimeType.split("/")[1] || asset.sourceName?.split(".").pop() || "FILE";
  return subtype.replace("vnd.openxmlformats-officedocument.", "").toUpperCase();
}

export function AssetStudio({ projects, models, selection, voiceId, onSelection, onVoice, onCreate, onOpen }: { projects: ProjectRecord[]; models: Parameters<typeof ModelSelector>[0]["models"]; selection: ModelSelection; voiceId: string; onSelection: (value: ModelSelection) => void; onVoice: (value: string) => void; onCreate: () => void; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<AssetTab>("all");
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [usage, setUsage] = useState<UsageIndex>(readUsage);
  const [targetProjectId, setTargetProjectId] = useState(projects[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [createKind, setCreateKind] = useState<"image" | "voice" | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 800);
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
      const [library, folderList] = await Promise.all([api.listAssetLibrary(), api.listAssetFolders()]);
      setAssets(library.assets);
      setFolders(folderList);
      setSelectedId(current => library.assets.some(item => item.id === current) ? current : library.assets[0]?.id ?? "");
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "素材库读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!targetProjectId && projects[0]) setTargetProjectId(projects[0].id); }, [projects, targetProjectId]);

  const keyword = deferredQuery.trim().toLocaleLowerCase();
  const filtered = assets.filter(asset => {
    const matchesQuery = !keyword || `${assetName(asset)} ${asset.mimeType}`.toLocaleLowerCase().includes(keyword);
    const matchesType = tab === "all" || tab === "voice" || asset.category === tab;
    const matchesSource = sourceFilter === "all" || asset.kind === sourceFilter;
    const matchesFolder = activeFolder === "all" || (activeFolder === "unfiled" ? !asset.folderId : asset.folderId === activeFolder);
    return tab !== "voice" && matchesQuery && matchesType && matchesSource && matchesFolder;
  });
  const selected = assets.find(asset => asset.id === selectedId) ?? null;
  const selectedUsage = selected ? usage[selected.id] ?? [] : [];
  const showInspector = inspectorOpen && Boolean(selected);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true); setError("");
    try {
      const folderId = activeFolder !== "all" && activeFolder !== "unfiled" ? activeFolder : undefined;
      await Promise.all(Array.from(files).map(file => api.uploadLibraryAsset(file, folderId)));
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "素材上传失败"); }
    finally { setUploading(false); if (uploadRef.current) uploadRef.current.value = ""; }
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    if (!folderName.trim() || creatingFolder) return;
    setCreatingFolder(true); setError("");
    try {
      const folder = await api.createAssetFolder(folderName.trim());
      setFolders(current => [...current, folder]);
      setActiveFolder(folder.id);
      setFolderName(""); setFolderFormOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "文件夹创建失败"); }
    finally { setCreatingFolder(false); }
  }

  async function moveSelected(folderId: string) {
    if (!selected) return;
    setError("");
    try {
      await api.moveLibraryAsset(selected.id, folderId || undefined);
      setAssets(current => current.map(asset => asset.id === selected.id ? { ...asset, folderId: folderId || undefined } : asset));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "文件夹更新失败"); }
  }

  async function generate(event: FormEvent) {
    event.preventDefault(); if (!prompt.trim() || busy) return;
    const job: GenerationJob = { id: crypto.randomUUID(), prompt: prompt.trim(), state: "running", createdAt: Date.now() };
    setJobs(current => [job, ...current].slice(0, 3)); setBusy(true); setError("");
    try {
      const referenceImages = await Promise.all(references.map(async file => (await api.uploadImage(file)).url));
      const { threadId } = await api.startImageThread();
      await api.generateImage(threadId, { prompt: prompt.trim(), referenceImages, ...selection });
      setJobs(current => current.map(item => item.id === job.id ? { ...item, state: "done" } : item));
      setPrompt(""); setReferences([]); setCreateKind(null); await load();
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

  function chooseTab(next: AssetTab) {
    setTab(next);
    if (next !== "voice") setInspectorOpen(true);
  }

  return <div className="asset-library-layout">
    <aside className="asset-workshop-nav">
      <div className="asset-workshop-brand"><img src="/brand/invideo-favicon-black.ico" alt=""/><b>映芽</b></div>
      <nav className="asset-product-nav" aria-label="映芽功能"><button onClick={onCreate}><FilmSlate/>视频创作</button><button className="active"><Images/>素材工坊</button></nav>
      <div className="asset-folder-heading"><span>文件夹</span><button aria-label="新建文件夹" aria-expanded={folderFormOpen} onClick={() => setFolderFormOpen(current => !current)}><Plus/></button></div>
      {folderFormOpen ? <form className="asset-folder-form" onSubmit={createFolder}><label htmlFor="asset-folder-name">新建文件夹</label><input id="asset-folder-name" autoFocus value={folderName} maxLength={40} onChange={event => setFolderName(event.target.value)} placeholder="文件夹名称"/><div><button type="button" onClick={() => setFolderFormOpen(false)}>取消</button><button disabled={!folderName.trim() || creatingFolder}>{creatingFolder ? <CircleNotch className="spin"/> : "创建"}</button></div></form> : null}
      <nav className="asset-folder-list" aria-label="素材文件夹">
        <button className={activeFolder === "all" ? "active" : ""} onClick={() => setActiveFolder("all")}><FolderOpen/><span>全部素材</span><small>{assets.length}</small></button>
        <button className={activeFolder === "unfiled" ? "active" : ""} onClick={() => setActiveFolder("unfiled")}><FolderSimple/><span>未整理</span><small>{assets.filter(asset => !asset.folderId).length}</small></button>
        {folders.map(folder => <button key={folder.id} className={activeFolder === folder.id ? "active" : ""} onClick={() => setActiveFolder(folder.id)}><FolderSimple/><span>{folder.name}</span><small>{assets.filter(asset => asset.folderId === folder.id).length}</small></button>)}
      </nav>
      <div className="asset-service-status"><span/><span>本地服务已连接</span></div>
    </aside>
    <main className="asset-main asset-main--library">
      <header className="asset-library-header"><div><h1>素材工坊</h1><p>集中管理创作中使用的图片、视频、音频、音色与文件</p></div><label className="asset-search"><MagnifyingGlass/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索素材" aria-label="搜索素材"/><kbd>⌘ K</kbd></label><button className="asset-upload-button" onClick={() => uploadRef.current?.click()} disabled={uploading}>{uploading ? <CircleNotch className="spin"/> : <UploadSimple/>}上传素材</button><input hidden ref={uploadRef} type="file" multiple onChange={event => void uploadFiles(event.target.files)}/><div className="asset-create-control"><button className="asset-create-button" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen(current => !current)}><Sparkle weight="fill"/>创建素材<CaretDown/></button>{createMenuOpen ? <div className="asset-create-menu"><button onClick={() => { setCreateKind("image"); setCreateMenuOpen(false); }}><ImageIcon/>生成图片</button><button onClick={() => { setCreateKind("voice"); setCreateMenuOpen(false); }}><SpeakerHigh/>创建音色</button></div> : null}</div></header>
      <nav className="asset-media-tabs" aria-label="素材类型">{typeTabs.map(item => { const Icon = item.icon; const count = item.id === "all" ? assets.length : item.id === "voice" ? undefined : assets.filter(asset => asset.category === item.id).length; return <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => chooseTab(item.id)}><Icon/>{item.label}{count !== undefined ? <small>{count}</small> : null}</button>; })}</nav>
      {tab === "voice" ? <div className="asset-voice-content"><VoiceStudio value={voiceId} onChange={onVoice}/></div> : <>
        <div className="asset-library-controls"><nav aria-label="素材来源">{([ ["all", "全部来源"], ["uploaded", "已上传"], ["generated", "AI 生成"] ] as const).map(([id, label]) => <button key={id} className={sourceFilter === id ? "active" : ""} onClick={() => setSourceFilter(id)}>{id === "uploaded" ? <UploadSimple/> : id === "generated" ? <Sparkle/> : <Folders/>}{label}</button>)}</nav><span>{filtered.length} 项素材</span></div>
        <div className={`asset-browser asset-browser--mixed ${showInspector ? "has-inspector" : ""}`}>
          <div className="asset-catalog">
            {error ? <p className="asset-page-error" role="alert">{error}</p> : null}
            {filtered.length ? <div className="asset-mixed-grid">{filtered.map(asset => <AssetCard key={asset.id} asset={asset} folder={folders.find(folder => folder.id === asset.folderId)} selected={asset.id === selectedId} used={Boolean(usage[asset.id]?.length)} onSelect={() => { setSelectedId(asset.id); setInspectorOpen(true); }}/>)}</div> : null}
            {!loading && !filtered.length ? <div className="asset-empty-state"><Folders/><h2>{query ? "没有匹配的素材" : "这个分类还没有素材"}</h2><p>{query ? "尝试更换关键词或筛选条件。" : "上传文件，或通过创建素材生成图片与音色。"}</p><button onClick={() => query ? setQuery("") : uploadRef.current?.click()}>{query ? "清除搜索" : "上传素材"}</button></div> : null}
            {loading ? <p className="asset-loading"><CircleNotch className="spin"/>正在读取素材…</p> : null}
          </div>
          {showInspector ? <aside className="asset-inspector">
            <header><strong>{selected ? assetName(selected) : "素材详情"}</strong><button aria-label="关闭详情" onClick={() => setInspectorOpen(false)}><X/></button></header>
            {selected ? <><AssetPreview asset={selected}/>
              {selected.prompt ? <section><h3>提示词</h3><p>{selected.prompt}</p></section> : null}
              <section><h3>信息</h3><dl><div><dt>类型</dt><dd>{assetTypeLabel(selected)}（{assetFormat(selected)}）</dd></div><div><dt>来源</dt><dd>{selected.kind === "generated" ? <><Sparkle/>AI 生成</> : <><UploadSimple/>已上传</>}</dd></div><div><dt>文件夹</dt><dd><select aria-label="素材文件夹" value={selected.folderId ?? ""} onChange={event => void moveSelected(event.target.value)}><option value="">未整理</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></dd></div><div><dt>添加时间</dt><dd>{formatDate(selected.createdAt)}</dd></div></dl></section>
              <section className="asset-usage-section"><div className="asset-section-title"><h3>使用位置</h3><span>{selectedUsage.length}</span></div>{selectedUsage.map(item => <button className="asset-usage-row" key={item.projectId} onClick={() => onOpen(item.projectId)}><FolderSimple/><span><b>{item.projectTitle}</b><small>{formatDate(item.addedAt)}</small></span><ArrowRight/></button>)}<div className="asset-add-project"><select value={targetProjectId} onChange={event => setTargetProjectId(event.target.value)} aria-label="选择项目"><option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select><button onClick={() => void addToProject()} disabled={!targetProjectId || adding}>{adding ? <CircleNotch className="spin"/> : <Plus/>}添加</button></div></section>
              {jobs.length ? <section><div className="asset-section-title"><h3>生成任务</h3><span>{jobs.length}</span></div>{jobs.map(job => <div className="asset-job" key={job.id}><ImageIcon/><span><b>{job.prompt}</b><small>{job.state === "running" ? "生成中" : job.state === "done" ? "已完成" : "失败"}</small></span>{job.state === "running" ? <CircleNotch className="spin"/> : job.state === "done" ? <Check/> : <X/>}</div>)}</section> : null}
              <a className="asset-download" href={selected.url} download={fileNameFor(selected)}><DownloadSimple/>下载文件</a></> : <div className="asset-empty-state"><FileIcon/><p>选择一项素材查看详情</p></div>}
          </aside> : null}
        </div>
      </>}
    </main>
    {createKind ? <div className="asset-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCreateKind(null); }}><aside className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-drawer-title"><header><h2 id="asset-drawer-title">{createKind === "image" ? "生成图片" : "创建音色"}</h2><button aria-label="关闭创建面板" onClick={() => setCreateKind(null)}><X/></button></header>{createKind === "voice" ? <VoiceStudio value={voiceId} onChange={onVoice} compact/> : <form className="asset-create-form" onSubmit={generate}><label><span>画面描述</span><textarea autoFocus value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="主体、场景、构图、光线和画幅要求"/></label>{references.length ? <div className="reference-files">{references.map((file, index) => <span key={`${file.name}-${index}`}><ImageIcon/>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setReferences(files => files.filter((_, itemIndex) => itemIndex !== index))}><X/></button></span>)}</div> : null}<button type="button" className="asset-reference-button" onClick={() => referenceRef.current?.click()}><Paperclip/>添加参考图</button><input hidden ref={referenceRef} type="file" accept="image/*" multiple onChange={event => setReferences(Array.from(event.target.files ?? []))}/><label><span>生成模型</span><ModelSelector models={models} value={selection} onChange={onSelection}/></label><button className="asset-primary" disabled={!prompt.trim() || busy}>{busy ? <CircleNotch className="spin"/> : <Sparkle weight="fill"/>}{busy ? "正在生成" : "生成图片"}</button>{error ? <p className="asset-error" role="alert">{error}</p> : null}</form>}</aside></div> : null}
  </div>;
}

function AssetCard({ asset, folder, selected, used, onSelect }: { asset: AssetLibraryItem; folder?: AssetFolder; selected: boolean; used: boolean; onSelect: () => void }) {
  return <button className={selected ? "selected" : ""} onClick={onSelect}><AssetThumb asset={asset}/><b title={assetName(asset)}>{assetName(asset)}</b><small><span className={`asset-source asset-source--${asset.kind}`}>{asset.kind === "generated" ? <Sparkle/> : <UploadSimple/>}{asset.kind === "generated" ? "AI 生成" : "已上传"}</span> · {formatDate(asset.createdAt)}</small><em><FolderSimple/>{folder?.name ?? "未整理"}{used ? " · 项目中" : ""}</em></button>;
}

function AssetThumb({ asset }: { asset: AssetLibraryItem }) {
  if (asset.category === "image") return <span className="asset-card-image"><img src={asset.url} alt=""/><i><ImageIcon/></i><mark>{assetFormat(asset)}</mark></span>;
  if (asset.category === "video") return <span className="asset-card-image asset-card-video"><video src={asset.url} preload="metadata" muted/><i><VideoCamera/></i><mark>{assetFormat(asset)}</mark></span>;
  if (asset.category === "audio") return <span className="asset-card-image asset-card-audio"><FileAudio/><span className="asset-waveform"/><mark>{assetFormat(asset)}</mark></span>;
  if (asset.category === "document") return <span className="asset-card-image asset-card-document"><FileText/><mark>{assetFormat(asset)}</mark></span>;
  return <span className="asset-card-image asset-card-document"><FileIcon/><mark>{assetFormat(asset)}</mark></span>;
}

function AssetPreview({ asset }: { asset: AssetLibraryItem }) {
  if (asset.category === "image") return <div className="asset-preview"><img src={asset.url} alt={assetName(asset)}/><span>{assetFormat(asset)}</span></div>;
  if (asset.category === "video") return <div className="asset-preview asset-preview--media"><video src={asset.url} controls preload="metadata"/><span>{assetFormat(asset)}</span></div>;
  if (asset.category === "audio") return <div className="asset-preview asset-preview--audio"><FileAudio/><audio src={asset.url} controls/><span>{assetFormat(asset)}</span></div>;
  return <div className="asset-preview asset-preview--file">{asset.category === "document" ? <FileText/> : <FileIcon/>}<b>{assetName(asset)}</b><span>{assetFormat(asset)}</span></div>;
}
