import { assetName } from "../assetNames";
import { createPortal } from "react-dom";
import { useAssetMarquee } from "../hooks/useAssetMarquee";
import { useAssetJobs } from "../hooks/useAssetJobs";
import type { ImageJob, VoiceJob } from "../schemas";
import { AssetTaskQueue } from "./AssetTaskQueue";
import { GenerationTaskDetail } from "./GenerationTaskDetail";
import { AssetPrompt } from "./AssetPrompt";
import "./assets-workspace.css";
import { type UploadQueue } from "../hooks/useUploadQueue";
import { SelectControl } from "./SelectControl";
import "./asset-creation.css";
import { CatalogSort } from "./CatalogSort";
import { AppNavigation } from "./AppNavigation";
import { AssetDocumentThumbnail } from "./AssetDocumentThumbnail";
import AssetPdfPreview, { isPdfAsset, PdfThumbnail } from "./AssetPdfPreview";
import AssetDocumentPreview, { assetDocumentKind } from "./AssetDocumentPreview";
import {
  CaretDown, CaretUp, CaretUpDown, ArrowsOut, Minus, PencilSimple, Trash, Check, Checks, CircleNotch, DownloadSimple, File as FileIcon, FileAudio, FileText,
  FolderOpen, FolderSimple, Folders, Image as ImageIcon, Images,
  MagnifyingGlass, MusicNotes, Plus, Sparkle, UploadSimple,
  Tray, VideoCamera, Waveform, X,
} from "@phosphor-icons/react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent, type DragEvent } from "react";
import { ActionDialog } from "./ActionDialog";
import { api } from "../api";
import type { AssetFolder, AssetLibraryItem, ModelSelection } from "../types";
import { ImageGeneration } from "./ImageGeneration";
import { ModelSelector } from "./ModelSelector";
import { VoiceStudio } from "./VoiceStudio";

type AssetTab = "all" | "image" | "video" | "audio" | "document" | "file";
type AssetView = "large" | "medium" | "small" | "list";
const ASSET_VIEW_KEY = "yingya.assets.view.v1";
const assetViews: { id: AssetView; label: string }[] = [{ id: "large", label: "大图" }, { id: "medium", label: "中图" }, { id: "small", label: "小图" }, { id: "list", label: "列表" }];
function readAssetView(): AssetView {
  try { const saved = localStorage.getItem(ASSET_VIEW_KEY); return assetViews.find(view => view.id === saved)?.id ?? "medium"; } catch { return "medium"; }
}

type SourceFilter = "all" | "uploaded" | "generated";
const assetSortColumns = [
  { label: "素材名称", ascending: "name", descending: "name-desc", initial: "name" },
  { label: "类型", ascending: "type", descending: "type-desc", initial: "type" },
  { label: "来源", ascending: "source", descending: "source-desc", initial: "source" },
  { label: "文件夹", ascending: "folder", descending: "folder-desc", initial: "folder" },
  { label: "添加时间", ascending: "oldest", descending: "recent", initial: "recent" },
];
const assetSortOptions = [
  { value: "recent", label: "最近添加" }, { value: "oldest", label: "最早添加" },
  { value: "name", label: "名称排序" }, { value: "name-desc", label: "名称降序" },
  { value: "type", label: "按类型排序" }, { value: "type-desc", label: "类型降序" },
  { value: "source", label: "按来源排序" }, { value: "source-desc", label: "来源降序" },
  { value: "folder", label: "按文件夹排序" }, { value: "folder-desc", label: "文件夹降序" },
];
const ASSET_DRAG_TYPE = "application/x-yingya-library-assets";

const typeTabs: { id: AssetTab; label: string; icon: typeof Images }[] = [
  { id: "all", label: "全部", icon: Folders },
  { id: "image", label: "图片", icon: Images },
  { id: "video", label: "视频", icon: VideoCamera },
  { id: "audio", label: "音频", icon: MusicNotes },
  { id: "document", label: "文档", icon: FileText },
  { id: "file", label: "其他", icon: FileIcon },
];

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).replaceAll("/", "-");
}
function assetFormat(asset: AssetLibraryItem) {
  const extension = asset.sourceName?.match(/\.([a-z0-9]{1,12})$/i)?.[1] || asset.projectPath.match(/\.([a-z0-9]{1,12})$/i)?.[1];
  const subtype = extension || asset.mimeType.split(";")[0].split("/")[1] || "FILE";
  return subtype.replace("vnd.openxmlformats-officedocument.", "").toUpperCase();
}

export function AssetStudio({ uploads, initialTool, initialSection, accountPanel, models, selection, voiceId, onSelection, onVoice, onCreate }: { uploads: UploadQueue<AssetLibraryItem>; initialTool?: "image" | "voice"; initialSection?: "library" | "generate" | "tasks"; accountPanel?: ReactNode; models: Parameters<typeof ModelSelector>[0]["models"]; selection: ModelSelection; voiceId: string; onSelection: (value: ModelSelection) => void; onVoice: (value: string) => void; onCreate: () => void }) {
  const section = initialSection || (initialTool ? "generate" : "library");
  const [lastTool, setLastTool] = useState<"image" | "voice">(initialTool || "image");
  const tool = initialTool || lastTool;
  const [tab, setTab] = useState<AssetTab>("all");
  const [voiceVisited, setVoiceVisited] = useState(initialTool === "voice");
  const [retryImage, setRetryImage] = useState<{ job: ImageJob } | null>(null);
  const [retryVoice, setRetryVoice] = useState<{ job: VoiceJob } | null>(null);
  const [task, setTask] = useState<{ kind: "image" | "voice"; id: string } | null>(null);
  useEffect(() => { if (initialTool) setLastTool(initialTool); if (initialTool === "voice") setVoiceVisited(true); }, [initialTool]);
  function navigate(next: "library" | "generate" | "tasks", nextTool = tool) {
    const hash = next === "library" ? "#/assets" : next === "tasks" ? "#/assets/tasks" : `#/assets/generate/${nextTool}`;
    if (window.location.hash !== hash) { window.history.pushState(null, "", hash); window.dispatchEvent(new PopStateEvent("popstate")); }
    setInspectorOpen(false); setTask(null);
  }
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState<AssetView>(readAssetView);
  function changeView(next: AssetView) {
    setView(next);
    try { localStorage.setItem(ASSET_VIEW_KEY, next); } catch { /* View switching also works without storage. */ }
  }
  const [expandedAsset, setExpandedAsset] = useState<AssetLibraryItem | null>(null);
  const browserRef = useRef<HTMLDivElement>(null);
  const catalogScrollRef = useRef<HTMLElement>(null);
  function expandPreview(asset: AssetLibraryItem) {
    browserRef.current?.querySelectorAll<HTMLMediaElement>(".asset-inspector video, .asset-inspector audio").forEach(media => media.pause());
    setExpandedAsset(asset);
  }
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]);
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchTargetFolderId, setBatchTargetFolderId] = useState("");
  const [movingBatch, setMovingBatch] = useState(false);
  const moveInFlight = useRef(false);
  const [movingCount, setMovingCount] = useState(0);
  const dragging = useRef<string[]>([]);
  const dragPreview = useRef<HTMLDivElement>(null);
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [dropFolder, setDropFolder] = useState<{ id: string; allowed: boolean } | null>(null);
  const [batchStatus, setBatchStatus] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [preferredSource, setSourceFilter] = useState<SourceFilter>("all");
  const sourceFilter = preferredSource;
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const folderTriggerRef = useRef<HTMLButtonElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderName, setFolderName] = useState("");
  const [folderError, setFolderError] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [fileDropActive, setFileDropActive] = useState(false);
  const fileDragDepth = useRef(0);
  const uploadDestination = folders.find(folder => folder.id === activeFolder)?.name ?? "未整理";
  useEffect(() => {
    const reset = () => { fileDragDepth.current = 0; setFileDropActive(false); };
    const preventFileNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      if (event.type === "drop") reset();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") reset(); };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation); window.removeEventListener("drop", preventFileNavigation);
      window.removeEventListener("dragend", reset); window.removeEventListener("blur", reset); window.removeEventListener("keydown", escape);
    };
  }, []);
  const appliedUploads = useRef(new Set(uploads.items.filter(item => item.status === "complete").map(item => item.id)));
  const receivedUploads = useRef(new Map<string, AssetLibraryItem>());
  useEffect(() => {
    const completed = uploads.items.flatMap(item => {
      if (item.status !== "complete" || !item.result || appliedUploads.current.has(item.id)) return [];
      appliedUploads.current.add(item.id);
      receivedUploads.current.set(item.id, item.result);
      return [item.result];
    });
    if (completed.length) setAssets(current => { const added = completed.filter(asset => !current.some(existing => existing.id === asset.id)); return added.length ? [...added, ...current] : current; });
  }, [uploads.items]);
  const [error, setError] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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
      if (management.kind === "delete-asset") { await api.deleteLibraryAsset(management.id); setInspectorOpen(false); }
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
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const receivedBeforeLoad = new Set(receivedUploads.current.keys());
    try {
      const [library, folderList] = await Promise.all([api.listAssetLibrary(), api.listAssetFolders()]);
      // Keep uploads completed during this request without reviving previously deleted files.
      const receivedDuringLoad = [...receivedUploads.current].filter(([id, asset]) => !receivedBeforeLoad.has(id) && !library.assets.some(item => item.id === asset.id)).map(([, asset]) => asset);
      setAssets([...receivedDuringLoad, ...library.assets]);
      setFolders(folderList);
      setSelectedId(current => library.assets.some(item => item.id === current) ? current : library.assets[0]?.id ?? "");
      setBatchSelectedIds(current => current.filter(id => library.assets.some(item => item.id === id)));
      setError("");
    } catch (reason) { setLoadError(reason instanceof Error ? reason.message : "素材库读取失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const jobs = useAssetJobs(load);
  const activeUploads = uploads.items.filter(item => !["complete", "error"].includes(item.status)).length;
  const activeTasks = activeUploads + jobs.images.jobs.filter(job => job.status === "running").length + jobs.voices.jobs.filter(job => job.status === "running").length;
  const selectedImageJob = task?.kind === "image" ? jobs.images.jobs.find(job => job.id === task.id) : undefined;
  const selectedVoiceJob = task?.kind === "voice" ? jobs.voices.jobs.find(job => job.id === task.id) : undefined;
  const keyword = deferredQuery.trim().toLocaleLowerCase();
  const folderAssets = assets.filter(asset => activeFolder === "all" || (activeFolder === "unfiled" ? !asset.folderId : asset.folderId === activeFolder));
  const folderLabel = activeFolder === "all" ? "全部素材" : activeFolder === "unfiled" ? "未整理" : folders.find(folder => folder.id === activeFolder)?.name ?? "文件夹";
  const folderNames = new Map(folders.map(folder => [folder.id, folder.name]));
  const filtered = folderAssets.filter(asset => {
    const matchesQuery = !keyword || `${assetName(asset)} ${asset.prompt || ""} ${asset.mimeType}`.toLocaleLowerCase().includes(keyword);
    const matchesType = tab === "all" || asset.category === tab;
    const matchesSource = sourceFilter === "all" || asset.kind === sourceFilter;
    return matchesQuery && matchesType && matchesSource;
  }).sort((a, b) => {
    const value = sort.startsWith("name") ? assetName(a).localeCompare(assetName(b), "zh-CN")
      : sort.startsWith("type") ? assetFormat(a).localeCompare(assetFormat(b))
      : sort.startsWith("source") ? a.kind.localeCompare(b.kind)
      : sort.startsWith("folder") ? (folderNames.get(a.folderId ?? "") ?? "未整理").localeCompare(folderNames.get(b.folderId ?? "") ?? "未整理", "zh-CN")
      : a.createdAt - b.createdAt;
    return value * (sort === "recent" || sort.endsWith("-desc") ? -1 : 1) || assetName(a).localeCompare(assetName(b), "zh-CN") || a.id.localeCompare(b.id);
  });
  const selected = filtered.find(asset => asset.id === selectedId) ?? null;
  useEffect(() => { if (inspectorOpen && !selected) setInspectorOpen(false); }, [inspectorOpen, selected]);
  const batchSelectedSet = useMemo(() => new Set(batchSelectedIds), [batchSelectedIds]);
  const allFilteredSelected = filtered.length > 0 && filtered.every(asset => batchSelectedSet.has(asset.id));
  const showInspector = inspectorOpen && Boolean(selected);
  const marquee = useAssetMarquee({
    enabled: section === "library" && selectionMode && filtered.length > 0 && !movingBatch && !showInspector,
    scope: `${view}:${filtered.map(asset => asset.id).join(",")}`,
    selected: batchSelectedIds, onSelect: setBatchSelectedIds, scrollRef: catalogScrollRef,
  });

  async function uploadFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    const folderId = activeFolder !== "all" && activeFolder !== "unfiled" ? activeFolder : undefined;
    const batch = Array.from(files).map(file => ({ id: crypto.randomUUID(), name: file.name, size: file.size, destination: uploadDestination,
      run: (options: import("../upload").UploadOptions) => api.uploadLibraryAsset(file, folderId, options) }));
    if (uploadRef.current) uploadRef.current.value = "";
    setTab("all"); setSourceFilter("all"); setQuery("");
    try { await uploads.run(batch); } catch { /* Per-file errors and retries remain visible in the queue. */ }
  }

  function isFileDrop(event: DragEvent<HTMLElement>) {
    return section === "library" && event.dataTransfer.types.includes("Files") && !event.dataTransfer.types.includes(ASSET_DRAG_TYPE)
      && !(event.target instanceof Element && event.target.closest("dialog"));
  }
  function dropFiles(event: DragEvent<HTMLElement>) {
    if (!isFileDrop(event)) return;
    event.preventDefault(); event.stopPropagation(); fileDragDepth.current = 0; setFileDropActive(false);
    const items = Array.from(event.dataTransfer.items);
    const directories = items.some(item => item.webkitGetAsEntry?.()?.isDirectory);
    const files = items.length ? items.filter(item => item.kind === "file" && !item.webkitGetAsEntry?.()?.isDirectory).flatMap(item => { const file = item.getAsFile(); return file ? [file] : []; }) : Array.from(event.dataTransfer.files);
    setError(directories ? "暂不支持直接上传文件夹，请打开文件夹后选择其中的文件。" : "");
    void uploadFiles(files);
  }

  async function createFolder(event: FormEvent) {
    event.preventDefault();
    if (!folderName.trim() || creatingFolder) return;
    setCreatingFolder(true); setFolderError("");
    try {
      const folder = await api.createAssetFolder(folderName.trim());
      setFolders(current => [...current, folder]);
      setActiveFolder(folder.id);
      setFolderName(""); setFolderFormOpen(false);
      setBatchStatus("文件夹已创建");
    } catch (reason) { setFolderError(reason instanceof Error ? reason.message : "文件夹创建失败，请重试"); }
    finally { setCreatingFolder(false); }
  }

  async function moveSelected(folderId: string) {
    if (selected) await moveAssets([selected.id], folderId);
  }

  function toggleBatchSelection(id: string) {
    setBatchSelectedIds(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    setBatchStatus("");
  }

  function closeSelectionMode() {
    setSelectionMode(false);
    setBatchSelectedIds([]);
  }

  async function moveAssets(ids: string[], folderId: string, fromBatch = false) {
    if (!ids.length || moveInFlight.current) return;
    const destination = folders.find(folder => folder.id === folderId)?.name ?? "未整理";
    const requestedIds = assets.filter(asset => ids.includes(asset.id) && (asset.folderId ?? "") !== folderId).map(asset => asset.id);
    if (!requestedIds.length) {
      setBatchStatus(`所选素材已在“${destination}”`);
      if (fromBatch) closeSelectionMode();
      return;
    }
    moveInFlight.current = true;
    setMovingBatch(true); setMovingCount(requestedIds.length); setError(""); setBatchStatus("");
    const results = await Promise.allSettled(requestedIds.map(id => api.moveLibraryAsset(id, folderId || undefined)));
    const movedIds = requestedIds.filter((_, index) => results[index].status === "fulfilled");
    const failedIds = requestedIds.filter((_, index) => results[index].status === "rejected");
    if (movedIds.length) {
      const movedSet = new Set(movedIds);
      setAssets(current => current.map(asset => movedSet.has(asset.id) ? { ...asset, folderId: folderId || undefined } : asset));
      setBatchStatus(`已将 ${movedIds.length} 项素材移动到“${destination}”`);
    }
    if (failedIds.length) {
      setBatchSelectedIds(failedIds);
      setSelectionMode(true);
      setBatchTargetFolderId(folderId);
      setError(`${failedIds.length} 项素材移动失败，已保留选中，请重试移动`);
    } else if (fromBatch) closeSelectionMode();
    moveInFlight.current = false;
    setMovingBatch(false);
  }

  function moveBatch() { return moveAssets(batchSelectedIds, batchTargetFolderId, true); }

  function endDrag() {
    dragging.current = [];
    setDraggedIds([]);
    setDropFolder(null);
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, asset: AssetLibraryItem) {
    if (moveInFlight.current) { event.preventDefault(); return; }
    const ids = selectionMode && batchSelectedSet.has(asset.id) ? [...batchSelectedIds] : [asset.id];
    if (selectionMode) setBatchSelectedIds(ids);
    dragging.current = ids;
    setDraggedIds(ids);
    setBatchStatus("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(ids));
    if (dragPreview.current) {
      dragPreview.current.textContent = ids.length === 1 ? assetName(asset) : `${ids.length} 项素材`;
      event.dataTransfer.setDragImage(dragPreview.current, 20, 20);
    }
  }

  function folderDropProps(folderId: string) {
    const isLocalDrag = (event: DragEvent<HTMLButtonElement>) => !moveInFlight.current && dragging.current.length > 0 && event.dataTransfer.types.includes(ASSET_DRAG_TYPE);
    const over = (event: DragEvent<HTMLButtonElement>) => {
      if (!isLocalDrag(event)) return;
      const allowed = assets.some(asset => dragging.current.includes(asset.id) && (asset.folderId ?? "") !== folderId);
      event.preventDefault();
      event.dataTransfer.dropEffect = allowed ? "move" : "none";
      setDropFolder(current => current?.id === folderId && current.allowed === allowed ? current : { id: folderId, allowed });
    };
    return {
      "data-folder-id": folderId || "unfiled",
      "data-drop-target": dropFolder?.id === folderId && dropFolder.allowed ? true : undefined,
      onDragEnter: over,
      onDragOver: over,
      onDragLeave: (event: DragEvent<HTMLButtonElement>) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropFolder(current => current?.id === folderId ? null : current);
      },
      onDrop: (event: DragEvent<HTMLButtonElement>) => {
        if (!isLocalDrag(event)) return;
        event.preventDefault(); event.stopPropagation();
        const ids = [...dragging.current];
        endDrag();
        void moveAssets(ids, folderId, selectionMode);
      },
    };
  }

  function chooseTab(next: AssetTab) { setTab(next); if (window.innerWidth <= 800) setInspectorOpen(false); }

  return <div className="asset-library-layout studio-shell studio-shell--library editorial-assets">
    <div className="asset-drag-preview" ref={dragPreview} aria-hidden="true"/>
    <AppNavigation active="assets" onCreate={onCreate} onAssets={() => { navigate("library"); chooseTab("all"); setActiveFolder("all"); }} accountPanel={accountPanel}>
      {section === "library" ? <><div className="asset-folder-heading"><span>文件夹</span><button ref={folderTriggerRef} aria-label="新建文件夹" aria-haspopup="dialog" aria-expanded={folderFormOpen} onClick={() => { setFolderError(""); setFolderFormOpen(true); }}><Plus/></button></div>
      <nav className="asset-folder-list" aria-label="素材文件夹">
        <button className={`asset-folder-button ${activeFolder === "all" ? "active" : ""}`} onClick={() => { setActiveFolder("all"); }}><Folders weight="duotone" aria-hidden="true"/><span>全部素材</span><small>{assets.length}</small></button>
        <button {...folderDropProps("")} className={`asset-folder-button ${activeFolder === "unfiled" ? "active" : ""}`} onClick={() => { setActiveFolder("unfiled"); }}><Tray weight="duotone" aria-hidden="true"/><span>未整理</span><small>{dropFolder?.id === "" ? dropFolder.allowed ? "移入" : "已在此处" : assets.filter(asset => !asset.folderId).length}</small></button>
        {folders.map(folder => <div className="asset-folder-row" key={folder.id}><button {...folderDropProps(folder.id)} className={`asset-folder-button ${activeFolder === folder.id ? "active" : ""}`} onClick={() => { setActiveFolder(folder.id); }}><FolderSimple/><span>{folder.name}</span><small>{dropFolder?.id === folder.id ? dropFolder.allowed ? "移入" : "已在此处" : assets.filter(asset => asset.folderId === folder.id).length}</small></button><button disabled={movingBatch} aria-label={`重命名文件夹 ${folder.name}`} title="重命名文件夹" onClick={() => manage("rename-folder", folder.id, folder.name)}><PencilSimple/></button><button disabled={movingBatch} aria-label={`删除文件夹 ${folder.name}`} title="删除文件夹" onClick={() => manage("delete-folder", folder.id, folder.name)}><Trash/></button></div>)}
      </nav></> : null}
    </AppNavigation>
    {folderFormOpen ? <ActionDialog title="新建文件夹" className="asset-folder-dialog" busy={creatingFolder} returnFocus={folderTriggerRef} initialFocus={folderInputRef} dismissOnBackdrop onClose={() => setFolderFormOpen(false)}>
      <form className="asset-folder-form" onSubmit={createFolder}>
        <label htmlFor="asset-folder-name">文件夹名称
          <input ref={folderInputRef} id="asset-folder-name" autoFocus value={folderName} maxLength={40} disabled={creatingFolder} aria-invalid={folderError ? true : undefined} aria-describedby={folderError ? "asset-folder-error" : undefined} onChange={event => setFolderName(event.target.value)} placeholder="输入文件夹名称"/>
        </label>
        {folderError ? <p id="asset-folder-error" className="asset-folder-error" role="alert">{folderError}</p> : null}
        <footer><button type="button" disabled={creatingFolder} onClick={() => setFolderFormOpen(false)}>取消</button><button type="submit" className="primary-button" disabled={!folderName.trim() || creatingFolder}>{creatingFolder ? <><CircleNotch className="spin" aria-hidden="true"/>创建中…</> : "创建"}</button></footer>
      </form>
    </ActionDialog> : null}
    <main ref={catalogScrollRef} {...marquee.handlers} className={`asset-main asset-main--library${marquee.enabled ? " asset-main--selecting" : ""}${marquee.rectangle ? " asset-main--marquee-active" : ""}`} aria-label="素材"
      onDragEnter={event => { if (isFileDrop(event)) { event.preventDefault(); fileDragDepth.current++; setFileDropActive(true); } }}
      onDragOver={event => { if (isFileDrop(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setFileDropActive(true); } }}
      onDragLeave={event => { if (isFileDrop(event)) { fileDragDepth.current = Math.max(0, fileDragDepth.current - 1); if (!fileDragDepth.current) setFileDropActive(false); } }}
      onDrop={dropFiles}>
      {fileDropActive ? <div className="asset-upload-drop" role="status"><div><UploadSimple aria-hidden="true"/><strong>松开即可上传到「{uploadDestination}」</strong><span>支持一次拖入多个文件，进度会显示在任务记录</span></div></div> : null}
      <div className="asset-workspace-toolbar catalog-heading">
      <h1><em>素材</em></h1>
      <nav className="asset-workspace-tabs" aria-label="素材工作区">
        {([['library','素材库'],['generate','生成素材'],['tasks','任务记录']] as const).map(([id,label]) => <a key={id} href={id === "library" ? "#/assets" : id === "generate" ? `#/assets/generate/${tool}` : "#/assets/tasks"} aria-current={section === id ? "page" : undefined} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(id); } }}>{label}{id === "tasks" && activeTasks ? <small aria-label={`${activeTasks} 项进行中`}>{activeTasks}</small> : null}</a>)}
      </nav>
      {section === "library" ? <button className="asset-upload-button" title="上传素材" aria-label="上传素材" onClick={() => uploadRef.current?.click()}><UploadSimple/><span>上传素材</span></button> : null}
      <input hidden ref={uploadRef} type="file" multiple onChange={event => void uploadFiles(event.target.files)}/>
      </div>
      <div className="asset-workspace-pane" hidden={section !== "generate"}>
        <nav className="asset-generator-tabs" aria-label="生成类型">{([['image','图片',ImageIcon],['voice','音色',Waveform]] as const).map(([id,label,Icon]) => <a key={id} href={`#/assets/generate/${id}`} aria-current={tool === id ? "page" : undefined} onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate("generate",id); } }}><Icon/>{label}</a>)}</nav>
        <div className="asset-workspace-pane" hidden={tool !== "image"}><ImageGeneration jobs={jobs.images} retry={retryImage} models={models} selection={selection} onSelection={onSelection} onLibrary={() => navigate("library")} onTasks={() => navigate("tasks")}/></div>
        {voiceVisited ? <div className="asset-workspace-pane" hidden={tool !== "voice"}><VoiceStudio value={voiceId} onChange={onVoice} active={section === "generate" && tool === "voice"} jobs={jobs.voices} retry={retryVoice} onTasks={() => navigate("tasks")}/></div> : null}
      </div>
      <div className="asset-workspace-pane" hidden={section !== "tasks"}><AssetTaskQueue uploads={uploads} jobs={jobs.images.jobs} voiceJobs={jobs.voices.jobs} loading={jobs.images.loading || jobs.voices.loading} loadError={jobs.images.error || jobs.voices.error} onRefresh={() => { jobs.images.refresh(); jobs.voices.refresh(); }} onDelete={async (kind, id) => { const list = kind === "image" ? jobs.images : jobs.voices; try { const ids = await api.deleteAssetJob(kind, id); list.forget(ids); return ids.length; } finally { list.refresh(); } }} onSelect={(kind,id) => setTask({kind,id})} onAsset={asset => { navigate("library"); setTab("all"); setQuery(""); setSourceFilter("all"); setActiveFolder("all"); setSelectedId(asset.id); setInspectorOpen(true); }}/></div>
      <div className="asset-workspace-pane" hidden={section !== "library"}>
      {uploads.items.length ? <div className="asset-upload-summary" role="status"><span>{activeUploads ? `${activeUploads} 个文件正在上传` : uploads.items.some(item => item.status === "error") ? "部分文件上传失败" : "文件已上传"}</span><button onClick={() => navigate("tasks")}>查看任务</button></div> : null}
      <div className="editorial-asset-filters"><nav className="asset-media-tabs" aria-label="素材类型">{typeTabs.map(item => { const Icon = item.icon; const count = item.id === "all" ? folderAssets.length : folderAssets.filter(asset => asset.category === item.id).length; return <button key={item.id} aria-pressed={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => chooseTab(item.id)}><Icon/>{item.label}<small>{count}</small></button>; })}</nav><label className="asset-search"><MagnifyingGlass/><input ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索名称或提示词" aria-label="搜索素材"/>{query ? <button type="button" aria-label="清除素材搜索" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X/></button> : <kbd>⌘ K</kbd>}</label></div>
        <div className={`asset-library-controls ${selectionMode ? "asset-library-controls--selecting" : ""}`}><div className="asset-current-folder" title={folderLabel}><FolderOpen aria-hidden="true"/><span>{folderLabel}</span><small aria-label={`${filtered.length} 项素材`}>{loading ? "…" : filtered.length}</small></div><SelectControl aria-label="素材来源" value={sourceFilter} onChange={event => setSourceFilter(event.target.value as SourceFilter)}><option value="all">全部来源</option><option value="uploaded">上传</option><option value="generated">AI 生成</option></SelectControl>{selectionMode ? <div className="asset-bulk-actions" role="toolbar" aria-label="批量整理素材"><strong role="status">{batchSelectedIds.length} 项已选</strong><button type="button" disabled={movingBatch} aria-pressed={allFilteredSelected} onClick={() => setBatchSelectedIds(allFilteredSelected ? [] : filtered.map(asset => asset.id))}>{allFilteredSelected ? "取消全选" : "全选当前"}</button><SelectControl disabled={movingBatch} aria-label="批量移动到文件夹" value={batchTargetFolderId} onChange={event => setBatchTargetFolderId(event.target.value)}><option value="">未整理</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</SelectControl><button className="asset-bulk-move" type="button" disabled={!batchSelectedIds.length || movingBatch} onClick={() => void moveBatch()}>{movingBatch ? <CircleNotch className="spin"/> : <FolderOpen/>}{movingBatch ? "正在移动" : "移动"}</button><button disabled={movingBatch} className="asset-bulk-cancel" type="button" onClick={closeSelectionMode}>取消</button></div> : <div className="asset-library-summary"><SelectControl className="asset-view-select" aria-label="素材显示方式" value={view} onChange={event => changeView(event.target.value as AssetView)}>{assetViews.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</SelectControl><CatalogSort label="素材排序" value={sort} onChange={setSort} options={assetSortOptions}/><button type="button" className="asset-organize-button" aria-label="批量整理" title="批量整理" disabled={movingBatch} onClick={() => { setSelectionMode(true); setBatchStatus(""); }}><Checks/><span>批量整理</span></button></div>}</div>
        {selectionMode ? <p className="asset-selection-hint">在空白处拖动框选，Shift 拖动可追加；也可点选或全选。</p> : null}
        <div ref={browserRef} className="asset-browser asset-browser--mixed">
          <div className="asset-catalog">
            {loadError ? <div className="asset-load-error" role="alert"><div><strong>素材暂时未能加载</strong><p>{loadError}</p><span>{assets.length ? "下方保留上次加载的素材，可以重试更新" : "请重试加载，已有素材不会被删除"}</span></div><button type="button" onClick={() => void load()}>重新加载</button></div> : null}
            {error ? <p className="asset-page-error" role="alert">{error}</p> : null}
            {movingBatch || batchStatus ? <p className="asset-batch-status" role="status">{movingBatch ? <CircleNotch className="spin"/> : <Check/>}{movingBatch ? `正在移动 ${movingCount} 项素材…` : batchStatus}</p> : null}
            {draggedIds.length ? <p className="asset-drag-hint" role="status">正在拖动 {draggedIds.length} 项素材，松开即可移入文件夹</p> : null}
            <p className="sr-only" role="status">{loading ? "正在读取素材" : loadError ? "素材加载失败" : `${folderLabel}，${filtered.length} 项素材`}</p>
            {filtered.length ? <div ref={marquee.gridRef} className={`asset-mixed-grid asset-view--${view}${selectionMode ? " asset-mixed-grid--selecting" : ""}`} role="list" aria-label="素材">{view === "list" ? <div className="asset-list-heading" role="group" aria-label="素材列表排序">{assetSortColumns.map(column => {
              const active = sort === column.ascending || sort === column.descending, descending = sort === column.descending;
              const Icon = active ? descending ? CaretDown : CaretUp : CaretUpDown;
              return <button key={column.label} type="button" aria-pressed={active} aria-label={`按${column.label}排序${active ? descending ? "，当前降序" : "，当前升序" : ""}`} onClick={() => setSort(active ? descending ? column.ascending : column.descending : column.initial)}><span>{column.label}</span><Icon aria-hidden="true"/></button>;
            })}</div> : null}{marquee.rectangle ? createPortal(<div className="asset-selection-box" aria-hidden="true" style={marquee.rectangle}/>, document.body) : null}{filtered.map(asset => <AssetCard key={asset.id} asset={asset} folder={folders.find(folder => folder.id === asset.folderId)} inspected={showInspector && asset.id === selectedId} checked={batchSelectedSet.has(asset.id)} selectionMode={selectionMode} dragging={draggedIds.includes(asset.id)} moving={movingBatch} onDragStart={event => startDrag(event, asset)} onDragEnd={endDrag} onOpen={() => { setSelectedId(asset.id); setInspectorOpen(true); }} onToggle={() => { if (!movingBatch) toggleBatchSelection(asset.id); }}/>)}</div> : null}
            {!loading && !loadError && !filtered.length ? <div className="asset-empty-state">

              <h2>{keyword ? "没有匹配的素材" : sourceFilter === "generated" ? "这里还没有 AI 生成的素材" : "这个分类还没有素材"}</h2>
              <p>{keyword ? "尝试更换关键词或筛选条件" : sourceFilter === "generated" ? "描述你想要的画面，生成图片后会自动保存到素材库" : sourceFilter === "uploaded" ? "上传图片、视频、音频或文件，集中整理创作素材" : "上传已有文件，或生成一张新的图片"}</p>
              <div className="asset-empty-actions">
                <button className="asset-empty-primary" onClick={() => keyword ? setQuery("") : sourceFilter === "generated" ? navigate("generate", "image") : uploadRef.current?.click()}>{keyword ? "清除搜索" : sourceFilter === "generated" ? <><Sparkle/>生成图片</> : <><UploadSimple/>上传素材</>}</button>
                {!keyword && sourceFilter === "all" ? <button onClick={() => navigate("generate", "image")}><Sparkle/>生成图片</button> : null}
              </div>
            </div> : null}
            {loading ? <p className="asset-loading" role="status"><CircleNotch className="spin"/>正在读取素材…</p> : null}
          </div>
          {showInspector && selected ? <ActionDialog dismissOnBackdrop resizable className="editorial-inspector" title={assetName(selected)} onClose={() => setInspectorOpen(false)}><div className="asset-inspector">
            <button className="editorial-expand" onClick={() => expandPreview(selected)}><ArrowsOut/>放大预览</button>
            {selected ? <><AssetPreview asset={selected}/>
              <section><h3>信息</h3><dl><div><dt>类型</dt><dd>{assetFormat(selected)}</dd></div><div><dt>来源</dt><dd>{selected.kind === "generated" ? <><Sparkle/>AI 生成</> : <><UploadSimple/>上传</>}</dd></div><div><dt>文件夹</dt><dd><SelectControl disabled={movingBatch} aria-label="素材文件夹" value={selected.folderId ?? ""} onChange={event => void moveSelected(event.target.value)}><option value="">未整理</option>{folders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</SelectControl></dd></div><div><dt>添加时间</dt><dd>{formatDate(selected.createdAt)}</dd></div></dl></section>
              {selected.prompt ? <AssetPrompt key={selected.id} prompt={selected.prompt}/> : null}
              <div className="asset-manage-actions"><button onClick={() => manage("rename-asset", selected.id, assetName(selected))}><PencilSimple/>重命名素材</button><button onClick={() => manage("delete-asset", selected.id, assetName(selected))}><Trash/>删除素材</button></div>
              <a className="asset-download" href={selected.url} download={assetName(selected)}><DownloadSimple/>下载文件</a></> : <div className="asset-empty-state"><p>选择一项素材查看详情</p></div>}
          </div></ActionDialog> : null}
        </div>
      </div>
    </main>
    <GenerationTaskDetail image={selectedImageJob} voice={selectedVoiceJob} onClose={() => setTask(null)} onLibrary={() => navigate("library")} onVoices={() => navigate("generate", "voice")} onReuse={() => { if (selectedImageJob) { setRetryImage({ job: selectedImageJob }); navigate("generate", "image"); } if (selectedVoiceJob) { setRetryVoice({ job: selectedVoiceJob }); navigate("generate", "voice"); } }}/>
    {expandedAsset ? <ExpandedAssetPreview key={expandedAsset.id} asset={expandedAsset} onClose={() => setExpandedAsset(null)}/> : null}
    {management ? <ActionDialog title={management.kind.startsWith("rename") ? "修改名称" : "确认删除"} busy={managementBusy} onClose={() => setManagement(null)}><form onSubmit={applyManagement}><p>{management.name}</p>{management.kind.startsWith("rename") ? <label>新名称<input autoFocus value={managementName} maxLength={management.kind.endsWith("folder") ? 40 : 120} onChange={event => setManagementName(event.target.value)}/></label> : <p>{management.kind === "delete-folder" ? "文件夹将被删除，其中的素材会移到“未整理”，文件不会删除" : "将从素材库删除此文件；已导入项目的独立副本会保留，此操作不能撤销"}</p>}{managementError ? <p className="form-error" role="alert">{managementError}</p> : null}<footer><button type="button" disabled={managementBusy} onClick={() => setManagement(null)}>取消</button><button className={management.kind.startsWith("delete") ? "danger-action" : "primary-button"} disabled={managementBusy || (management.kind.startsWith("rename") && !managementName.trim())}>{managementBusy ? "正在处理…" : management.kind.startsWith("rename") ? "保存名称" : "确认删除"}</button></footer></form></ActionDialog> : null}
  </div>;
}

function AssetCard({ asset, folder, inspected, checked, selectionMode, dragging, moving, onDragStart, onDragEnd, onOpen, onToggle }: { asset: AssetLibraryItem; folder?: AssetFolder; inspected: boolean; checked: boolean; selectionMode: boolean; dragging: boolean; moving: boolean; onDragStart: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void; onOpen: () => void; onToggle: () => void }) {
  const name = assetName(asset);
  return <article role="listitem" data-asset-id={asset.id} className={`asset-card-item ${inspected ? "inspected" : ""} ${checked ? "batch-selected" : ""} ${dragging ? "is-dragging" : ""}`}><button className="asset-card-open" draggable={!moving} onDragStart={onDragStart} onDragEnd={onDragEnd} disabled={selectionMode && moving} title="查看素材，或拖动到文件夹" aria-pressed={selectionMode ? checked : undefined} aria-label={selectionMode ? `${checked ? "取消选择" : "选择"}素材 ${name}` : undefined} onClick={selectionMode ? onToggle : onOpen}><AssetThumb asset={asset}/><b title={name}>{name}</b><span className="asset-list-type">{assetFormat(asset)}</span><small><span className={`asset-source asset-source--${asset.kind}`}>{asset.kind === "generated" ? <Sparkle/> : <UploadSimple/>}{asset.kind === "generated" ? "AI 生成" : "上传"}</span></small><em title={folder?.name ?? "未整理"}><FolderSimple/><span>{folder?.name ?? "未整理"}</span></em><time className="asset-list-date" dateTime={new Date(asset.createdAt).toISOString()}>{formatDate(asset.createdAt)}</time></button>{selectionMode ? <span className="asset-card-check" aria-hidden="true">{checked ? <Check weight="bold"/> : null}</span> : null}</article>;
}

function AssetThumb({ asset }: { asset: AssetLibraryItem }) {
  if (isPdfAsset(asset)) return <PdfThumbnail asset={asset}/>;
  if (asset.category === "image") return <span className="asset-card-image"><img src={asset.url} alt="" draggable={false}/><i><ImageIcon/></i><mark>{assetFormat(asset)}</mark></span>;
  if (asset.category === "video") return <span className="asset-card-image asset-card-video"><video src={asset.url} preload="metadata" muted/><i><VideoCamera/></i><mark>{assetFormat(asset)}</mark></span>;
  if (asset.category === "audio") return <span className="asset-card-image asset-card-audio"><FileAudio/><span className="asset-waveform"/><mark>{assetFormat(asset)}</mark></span>;
  const documentKind = assetDocumentKind(asset);
  if (documentKind) return <AssetDocumentThumbnail asset={asset} kind={documentKind} format={assetFormat(asset)}/>;
  if (asset.category === "document") return <span className="asset-card-image asset-card-document"><FileText/><mark>{assetFormat(asset)}</mark></span>;
  return <span className="asset-card-image asset-card-document"><FileIcon/><mark>{assetFormat(asset)}</mark></span>;
}

function AssetPreview({ asset }: { asset: AssetLibraryItem }) {
  if (isPdfAsset(asset)) return <AssetPdfPreview key={`${asset.id}:${asset.url}`} asset={asset}/>;
  if (asset.category === "image") return <div className="asset-preview"><img src={asset.url} alt={assetName(asset)}/><span>{assetFormat(asset)}</span></div>;
  if (asset.category === "video") return <div className="asset-preview asset-preview--media"><video src={asset.url} controls preload="metadata"/><span>{assetFormat(asset)}</span></div>;
  if (asset.category === "audio") return <div className="asset-preview asset-preview--audio"><FileAudio/><audio src={asset.url} controls/><span>{assetFormat(asset)}</span></div>;
  const documentKind = assetDocumentKind(asset);
  if (documentKind) return <AssetDocumentPreview key={`${asset.id}:${asset.url}`} asset={asset} kind={documentKind}/>;
  return <div className="asset-preview asset-preview--file">{asset.category === "document" ? <FileText/> : <FileIcon/>}<b>{assetName(asset)}</b><p>此格式暂不支持预览，请下载后查看</p><span>{assetFormat(asset)}</span></div>;
}

function ExpandedAssetPreview({ asset, onClose }: { asset: AssetLibraryItem; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  return <ActionDialog title={assetName(asset)} className="asset-expanded-dialog" onClose={onClose}>
    {asset.category === "image" ? <>
      <div className="asset-zoom-controls" role="group" aria-label="图片缩放"><button aria-label="缩小图片" disabled={zoom <= 0.5} onClick={() => setZoom(value => Math.max(0.5, value - 0.25))}><Minus/></button><button onClick={() => setZoom(1)} aria-label="适应窗口">{Math.round(zoom * 100)}% · 重置</button><button aria-label="放大图片" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}><Plus/></button></div>
      <div className="asset-expanded-image"><img src={asset.url} alt={assetName(asset)} style={{ width: `${zoom * 100}%`, maxHeight: zoom <= 1 ? "100%" : "none", objectFit: "contain" }}/></div>
    </> : <div className="asset-expanded-content"><AssetPreview asset={asset}/></div>}
  </ActionDialog>;
}
