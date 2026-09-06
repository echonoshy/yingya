import { useMotionPresence } from "../hooks/useMotionPresence";
import {
  PencilSimple, Trash, ArrowRight, CaretDown, Check, Checks, CircleNotch, DownloadSimple, File as FileIcon, FileAudio, FileText,
  FilmSlate, FolderOpen, FolderSimple, Folders, Image as ImageIcon, Images,
  MagnifyingGlass, MusicNotes, Paperclip, Plus, Sparkle, SpeakerHigh, UploadSimple,
  VideoCamera, Waveform, X,
} from "@phosphor-icons/react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ActionDialog } from "./ActionDialog";
import { api } from "../api";
import { createClientRequestId } from "../requestId";
import type { AssetFolder, AssetLibraryItem, ModelSelection, ProjectRecord } from "../types";
import { ModelSelector } from "./ModelSelector";
import { VoiceStudio } from "./VoiceStudio";

type UsageRecord = { projectId: string; projectTitle: string; addedAt: number };
type UsageIndex = Record<string, UsageRecord[]>;
type GenerationJob = { id: string; prompt: string; state: "running" | "done" | "failed"; createdAt: number };
type AssetTab = "all" | "image" | "video" | "audio" | "voice" | "document";
type SourceFilter = "all" | "uploaded" | "generated";


const typeTabs: { id: AssetTab; label: string; icon: typeof Images }[] = [
  { id: "all", label: "全部", icon: Folders },
  { id: "image", label: "图片", icon: Images },
  { id: "video", label: "视频", icon: VideoCamera },
  { id: "audio", label: "音频", icon: MusicNotes },
  { id: "voice", label: "音色", icon: Waveform },
  { id: "document", label: "文档", icon: FileText },
];

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
  const [selectionMode, setSelectionMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchTargetFolderId, setBatchTargetFolderId] = useState("");
  const [movingBatch, setMovingBatch] = useState(false);
  const [batchStatus, setBatchStatus] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [usage, setUsage] = useState<UsageIndex>({});
  const [targetProjectId, setTargetProjectId] = useState(projects[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const [createKind, setCreateKind] = useState<"image" | "voice" | null>(null);
  const drawerPresence = useMotionPresence(createKind);
  const drawerRoot = useRef<HTMLDivElement>(null);
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!createKind) return;
    drawerRoot.current?.querySelector<HTMLElement>("textarea, input, button")?.focus();
    return () => createTriggerRef.current?.focus({ preventScroll: true });
  }, [createKind]);
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [usageError, setUsageError] = useState("");
  const [management, setManagement] = useState<{ kind: "rename-asset" | "delete-asset" | "rename-folder" | "delete-folder"; id: string; name: string } | null>(null);
  const [managementName, setManagementName] = useState("");
  const [managementBusy, setManagementBusy] = useState(false);
  const [managementError, setManagementError] = useState("");
  function manage(kind: NonNullable<typeof management>["kind"], id: string, name: string) { setManagement({ kind, id, name }); setManagementName(name); setManagementError(""); }
  async function applyManagement(event: FormEvent) {
    event.preventDefault(); if (!management || managementBusy) return;
    setManagementBusy(true); setManagementError("");
    try {
      if (management.kind === "rename-asset") await api.renameLibraryAsset(management.id, managementName.trim());
      if (management.kind === "delete-asset") await api.deleteLibraryAsset(management.id);
      if (management.kind === "rename-folder") await api.renameAssetFolder(management.id, managementName.trim());
      if (management.kind === "delete-folder") { await api.deleteAssetFolder(management.id); if (activeFolder === management.id) setActiveFolder("unfiled"); }
      setManagement(null); await load();
    } catch (reason) { setManagementError(reason instanceof Error ? reason.message : "操作失败，请重试"); }
    finally { setManagementBusy(false); }
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false; setUsageError("");
    void api.getLibraryUsage(selectedId).then(records => { if (!cancelled) setUsage(current => ({ ...current, [selectedId]: records })); }).catch(() => { if (!cancelled) setUsageError("使用位置暂时无法读取，请重新选择素材重试。"); });
    return () => { cancelled = true; };
  }, [selectedId]);


  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [library, folderList] = await Promise.all([api.listAssetLibrary(), api.listAssetFolders()]);
      setAssets(library.assets);
      setFolders(folderList);
      setSelectedId(current => library.assets.some(item => item.id === current) ? current : library.assets[0]?.id ?? "");
      setBatchSelectedIds(current => current.filter(id => library.assets.some(item => item.id === id)));
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
  const batchSelectedSet = useMemo(() => new Set(batchSelectedIds), [batchSelectedIds]);
  const allFilteredSelected = filtered.length > 0 && filtered.every(asset => batchSelectedSet.has(asset.id));
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

  function toggleBatchSelection(id: string) {
    setBatchSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    setBatchStatus("");
  }

  function closeSelectionMode() {
    setSelectionMode(false);
    setBatchSelectedIds([]);
  }

  async function moveBatch() {
    if (!batchSelectedIds.length || movingBatch) return;
    const requestedIds = [...batchSelectedIds];
    setMovingBatch(true); setError(""); setBatchStatus("");
    const results = await Promise.allSettled(requestedIds.map(id => api.moveLibraryAsset(id, batchTargetFolderId || undefined)));
    const movedIds = requestedIds.filter((_, index) => results[index].status === "fulfilled");
    const failedIds = requestedIds.filter((_, index) => results[index].status === "rejected");
    if (movedIds.length) {
      const movedSet = new Set(movedIds);
      setAssets(current => current.map(asset => movedSet.has(asset.id) ? { ...asset, folderId: batchTargetFolderId || undefined } : asset));
    }
    if (failedIds.length) {
      setBatchSelectedIds(failedIds);
      setError(`${failedIds.length} 项素材移动失败，请重试。`);
    } else {
      const folderName = folders.find(folder => folder.id === batchTargetFolderId)?.name ?? "未整理";
      setBatchStatus(`已将 ${movedIds.length} 项素材移动到“${folderName}”`);
      closeSelectionMode();
    }
    setMovingBatch(false);
  }

  async function generate(event: FormEvent) {
    event.preventDefault(); if (!prompt.trim() || busy) return;
    const job: GenerationJob = { id: createClientRequestId(), prompt: prompt.trim(), state: "running", createdAt: Date.now() };
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
      await api.importLibraryAsset(selected.id, project.id);
      const records = await api.getLibraryUsage(selected.id);
      setUsage(current => ({ ...current, [selected.id]: records }));
      setUsageError("");
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
        {folders.map(folder => <div className="asset-folder-row" key={folder.id}><button className={activeFolder === folder.id ? "active" : ""} onClick={() => setActiveFolder(folder.id)}><FolderSimple/><span>{folder.name}</span><small>{assets.filter(asset => asset.folderId === folder.id).length}</small></button><button aria-label={`重命名文件夹 ${folder.name}`} title="重命名文件夹" onClick={() => manage("rename-folder", folder.id, folder.name)}><PencilSimple/></button><button aria-label={`删除文件夹 ${folder.name}`} title="删除文件夹" onClick={() => manage("delete-folder", folder.id, folder.name)}><Trash/></button></div>)}
      </nav>
      <div className="asset-service-status"><span/><span>本地服务已连接</span></div>
    </aside>
    <main className="asset-main asset-main--library">
      <header className="asset-library-header"><div><h1>素材工坊</h1><p>集中管理创作中使用的图片、视频、音频、音色与文件</p></div><label className="asset-search"><MagnifyingGlass/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索素材" aria-label="搜索素材"/><kbd>⌘ K</kbd></label><button className="asset-upload-button" onClick={() => uploadRef.current?.click()} disabled={uploading}>{uploading ? <CircleNotch className="spin"/> : <UploadSimple/>}上传素材</button><input hidden ref={uploadRef} type="file" multiple onChange={event => void uploadFiles(event.target.files)}/><div className="asset-create-control"><button ref={createTriggerRef} className="asset-create-button" aria-expanded={createMenuOpen} onClick={() => setCreateMenuOpen(current => !current)}><Sparkle weight="fill"/>创建素材<CaretDown/></button>{createMenuOpen ? <div className="asset-create-menu"><button onClick={() => { setCreateKind("image"); setCreateMenuOpen(false); }}><ImageIcon/>生成图片</button><button onClick={() => { setCreateKind("voice"); setCreateMenuOpen(false); }}><SpeakerHigh/>创建音色</button></div> : null}</div></header>
      <nav className="asset-media-tabs" aria-label="素材类型">{typeTabs.map(item => { const Icon = item.icon; const count = item.id === "all" ? assets.length : item.id === "voice" ? undefined : assets.filter(asset => asset.category === item.id).length; return <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => chooseTab(item.id)}><Icon/>{item.label}{count !== undefined ? <small>{count}</small> : null}</button>; })}</nav>
      {tab === "voice" ? <div className="asset-voice-content"><VoiceStudio value={voiceId} onChange={onVoice}/></div> : <>
        <div className={`asset-library-controls ${selectionMode ? "asset-library-controls--selecting" : ""}`}><nav aria-label="素材来源">{([ ["all", "全部来源"], ["uploaded", "已上传"], ["generated", "AI 生成"] ] as const).map(([id, label]) => <button key={id} className={sourceFilter === id ? "active" : ""} onClick={() => setSourceFilter(id)}>{id === "uploaded" ? <UploadSimple/> : id === "generated" ? <Sparkle/> : <Folders/>}{label}</button>)}</nav>{selectionMode ? <div className="asset-bulk-actions" role="toolbar" aria-label="批量整理素材"><strong>{batchSelectedIds.length} 项已选</strong><button type="button" aria-pressed={allFilteredSelected} onClick={() => setBatchSelectedIds(allFilteredSelected ? [] : filtered.map(asset => asset.id))}>{allFilteredSelected ? "取消全选" : "全选当前"}</button><select aria-label="批量移动到文件夹" value={batchTargetFolderId} onChange={event => setBatchTargetFolderId(event.target.value)}><option value="">未整理</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select><button className="asset-bulk-move" type="button" disabled={!batchSelectedIds.length || movingBatch} onClick={() => void moveBatch()}>{movingBatch ? <CircleNotch className="spin"/> : <FolderOpen/>}{movingBatch ? "正在移动" : "移动"}</button><button className="asset-bulk-cancel" type="button" onClick={closeSelectionMode}>取消</button></div> : <div className="asset-library-summary"><span>{filtered.length} 项素材</span><button type="button" onClick={() => { setSelectionMode(true); setBatchStatus(""); }}><Checks/>批量整理</button></div>}</div>
        <div className={`asset-browser asset-browser--mixed ${showInspector ? "has-inspector" : ""}`}>
          <div className="asset-catalog">
            {error ? <p className="asset-page-error" role="alert">{error}</p> : null}
            {batchStatus ? <p className="asset-batch-status" role="status"><Check/>{batchStatus}</p> : null}
            {filtered.length ? <div className="asset-mixed-grid">{filtered.map(asset => <AssetCard key={asset.id} asset={asset} folder={folders.find(folder => folder.id === asset.folderId)} inspected={asset.id === selectedId} checked={batchSelectedSet.has(asset.id)} selectionMode={selectionMode} used={Boolean(usage[asset.id]?.length)} onOpen={() => { setSelectedId(asset.id); setInspectorOpen(true); }} onToggle={() => toggleBatchSelection(asset.id)}/>)}</div> : null}
            {!loading && !filtered.length ? <div className="asset-empty-state"><Folders/><h2>{query ? "没有匹配的素材" : "这个分类还没有素材"}</h2><p>{query ? "尝试更换关键词或筛选条件。" : "上传文件，或通过创建素材生成图片与音色。"}</p><button onClick={() => query ? setQuery("") : uploadRef.current?.click()}>{query ? "清除搜索" : "上传素材"}</button></div> : null}
            {loading ? <p className="asset-loading"><CircleNotch className="spin"/>正在读取素材…</p> : null}
          </div>
          {showInspector ? <aside className="asset-inspector">
            <header><strong>{selected ? assetName(selected) : "素材详情"}</strong><button aria-label="关闭详情" onClick={() => setInspectorOpen(false)}><X/></button></header>
            {selected ? <><AssetPreview asset={selected}/>
              {selected.prompt ? <section><h3>提示词</h3><p>{selected.prompt}</p></section> : null}
              <section><h3>信息</h3><dl><div><dt>类型</dt><dd>{assetTypeLabel(selected)}（{assetFormat(selected)}）</dd></div><div><dt>来源</dt><dd>{selected.kind === "generated" ? <><Sparkle/>AI 生成</> : <><UploadSimple/>已上传</>}</dd></div><div><dt>文件夹</dt><dd><select aria-label="素材文件夹" value={selected.folderId ?? ""} onChange={event => void moveSelected(event.target.value)}><option value="">未整理</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></dd></div><div><dt>添加时间</dt><dd>{formatDate(selected.createdAt)}</dd></div></dl></section>
              <div className="asset-manage-actions"><button onClick={() => manage("rename-asset", selected.id, assetName(selected))}><PencilSimple/>重命名素材</button><button onClick={() => manage("delete-asset", selected.id, assetName(selected))}><Trash/>删除素材</button></div>
              <section className="asset-usage-section"><div className="asset-section-title"><h3>使用位置</h3><span>{selectedUsage.length}</span></div><p className="draft-save-status">记录通过素材库加入的项目；早期导入可能尚未登记。</p>{usageError ? <p className="form-error" role="status">{usageError}</p> : null}{selectedUsage.map(item => <button className="asset-usage-row" key={item.projectId} onClick={() => onOpen(item.projectId)}><FolderSimple/><span><b>{item.projectTitle}</b><small>{formatDate(item.addedAt)}</small></span><ArrowRight/></button>)}<div className="asset-add-project"><select value={targetProjectId} onChange={event => setTargetProjectId(event.target.value)} aria-label="选择项目"><option value="">选择项目</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select><button onClick={() => void addToProject()} disabled={!targetProjectId || adding}>{adding ? <CircleNotch className="spin"/> : <Plus/>}添加</button></div></section>
              {jobs.length ? <section><div className="asset-section-title"><h3>生成任务</h3><span>{jobs.length}</span></div>{jobs.map(job => <div className="asset-job" key={job.id}><ImageIcon/><span><b>{job.prompt}</b><small>{job.state === "running" ? "生成中" : job.state === "done" ? "已完成" : "失败"}</small></span>{job.state === "running" ? <CircleNotch className="spin"/> : job.state === "done" ? <Check/> : <X/>}</div>)}</section> : null}
              <a className="asset-download" href={selected.url} download={fileNameFor(selected)}><DownloadSimple/>下载文件</a></> : <div className="asset-empty-state"><FileIcon/><p>选择一项素材查看详情</p></div>}
          </aside> : null}
        </div>
      </>}
    </main>
    {management ? <ActionDialog title={management.kind.startsWith("rename") ? "修改名称" : "确认删除"} busy={managementBusy} onClose={() => setManagement(null)}><form onSubmit={applyManagement}><p>{management.name}</p>{management.kind.startsWith("rename") ? <label>新名称<input autoFocus value={managementName} maxLength={management.kind.endsWith("folder") ? 40 : 120} onChange={event => setManagementName(event.target.value)}/></label> : <p>{management.kind === "delete-folder" ? "文件夹将被删除，其中的素材会移到“未整理”，文件不会删除。" : "将从素材库删除此文件。已导入项目的独立副本会保留，此操作不能撤销。"}</p>}{managementError ? <p className="form-error" role="alert">{managementError}</p> : null}<footer><button type="button" disabled={managementBusy} onClick={() => setManagement(null)}>取消</button><button className={management.kind.startsWith("delete") ? "danger-action" : "primary-button"} disabled={managementBusy || (management.kind.startsWith("rename") && !managementName.trim())}>{managementBusy ? "正在处理…" : management.kind.startsWith("rename") ? "保存名称" : "确认删除"}</button></footer></form></ActionDialog> : null}
    {drawerPresence.value ? <div ref={node => { drawerRoot.current = node; drawerPresence.ref(node); }} inert={drawerPresence.exiting} aria-hidden={drawerPresence.exiting || undefined} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); setCreateKind(null); }
      if (event.key !== "Tab") return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(control => control.getClientRects().length && !control.closest('[inert]'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} className="asset-drawer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCreateKind(null); }}><aside data-motion-panel className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-drawer-title"><header><h2 id="asset-drawer-title">{drawerPresence.value === "image" ? "生成图片" : "创建音色"}</h2><button aria-label="关闭创建面板" onClick={() => setCreateKind(null)}><X/></button></header>{drawerPresence.value === "voice" ? <VoiceStudio value={voiceId} onChange={onVoice} compact/> : <form className="asset-create-form" onSubmit={generate}><label><span>画面描述</span><textarea autoFocus value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="主体、场景、构图、光线和画幅要求"/></label>{references.length ? <div className="reference-files">{references.map((file, index) => <span key={`${file.name}-${index}`}><ImageIcon/>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setReferences(files => files.filter((_, itemIndex) => itemIndex !== index))}><X/></button></span>)}</div> : null}<button type="button" className="asset-reference-button" onClick={() => referenceRef.current?.click()}><Paperclip/>添加参考图</button><input hidden ref={referenceRef} type="file" accept="image/*" multiple onChange={event => setReferences(Array.from(event.target.files ?? []))}/><label><span>生成模型</span><ModelSelector models={models} value={selection} onChange={onSelection}/></label><button className="asset-primary" disabled={!prompt.trim() || busy}>{busy ? <CircleNotch className="spin"/> : <Sparkle weight="fill"/>}{busy ? "正在生成" : "生成图片"}</button>{error ? <p className="asset-error" role="alert">{error}</p> : null}</form>}</aside></div> : null}
  </div>;
}

function AssetCard({ asset, folder, inspected, checked, selectionMode, used, onOpen, onToggle }: { asset: AssetLibraryItem; folder?: AssetFolder; inspected: boolean; checked: boolean; selectionMode: boolean; used: boolean; onOpen: () => void; onToggle: () => void }) {
  const name = assetName(asset);
  return <article className={`asset-card-item ${inspected ? "inspected" : ""} ${checked ? "batch-selected" : ""}`}><button className="asset-card-open" aria-pressed={selectionMode ? checked : undefined} aria-label={selectionMode ? `${checked ? "取消选择" : "选择"}素材 ${name}` : undefined} onClick={selectionMode ? onToggle : onOpen}><AssetThumb asset={asset}/><b title={name}>{name}</b><small><span className={`asset-source asset-source--${asset.kind}`}>{asset.kind === "generated" ? <Sparkle/> : <UploadSimple/>}{asset.kind === "generated" ? "AI 生成" : "已上传"}</span> · {formatDate(asset.createdAt)}</small><em><FolderSimple/>{folder?.name ?? "未整理"}{used ? " · 项目中" : ""}</em></button>{selectionMode ? <span className="asset-card-check" aria-hidden="true">{checked ? <Check weight="bold"/> : null}</span> : null}</article>;
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
