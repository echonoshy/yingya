import { StudioCodeTag } from "./components/StudioCodeTag";
import { briefSources, briefTemplates, sourceBrief } from './creationBrief';
import { ReferenceImageDialog } from './components/ReferenceImageDialog';
import { referenceFilms } from './marketing/showcaseMedia';
import { KineticType } from './components/KineticType';
import { PaperDelivery } from './components/PaperDelivery';
import "./clean-create.css";
import { CatalogSort } from "./components/CatalogSort";
import { takeHomeDraft, takeHomeSource, type HomeSource } from "./marketing/homeDraft";
import { AspectRatioSelector } from "./components/AspectRatioSelector";
import { AppNavigation } from "./components/AppNavigation";
import { ActionDialog } from "./components/ActionDialog";

import { ComposerMoreMenu } from "./components/ComposerMoreMenu";
import { DurationControl } from "./components/DurationControl";
import { UploadProgressList } from "./components/UploadProgressList";
import { useUploadQueue } from "./hooks/useUploadQueue";

import { CreationLibraryDialog } from "./components/CreationLibraryDialog";
import { ComposerForm } from "./components/ComposerForm";
import { AssetRoleSelect } from "./components/AssetRoleSelect";
import { assetRoleSchema } from "./schemas";
import { fileRoleKey, materialOnlyPrompt } from "./workbench";
import { SelectionIndicator } from "./components/SelectionIndicator";
import { useMotionPresence } from "./hooks/useMotionPresence";
import { ArrowRight, UploadSimple, Files, FilmStrip, Globe, Scroll, Palette, MusicNotes, Image, CircleNotch, CloudSlash, DotsThree, MagnifyingGlass, PencilSimple, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useDraftFiles } from "./hooks/useDraftFiles";

import { z } from "zod";
import { useSavedState } from "./hooks/useSavedState";
import { readRoute, useAppRoute } from "./hooks/useAppRoute";
import { TaskCenter } from "./components/TaskCenter";
import { projectCategory, projectGroup, projectStatus, projectSummary } from "./projectState";
import { api } from "./api";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { AssetStudio } from "./components/AssetStudio";
import { ModelSelector } from "./components/ModelSelector";
import { ProjectCreationPendingView, type ProjectCreationStage } from "./components/ProjectCreationPendingView";
import type { CodexModel, ModelSelection, ProjectDetail, ProjectRecord } from "./types";
import { readModelSelection, readStringSetting, writeModelSelection, writeStringSetting } from "./storage";
import { newCreationAttempt, readCreationAttempt, saveCreationAttempt } from "./creationAttempt";
import { userStorageKey } from "./session";
import { selectableModels, modelAllowed, defaultModelId } from "./models";

const briefIcons = { reference: FilmStrip, website: Globe, script: Scroll, style: Palette };
const referencePreviewSchema = z.array(z.object({ id: z.string(), url: z.string() }));

const fallbackModels: CodexModel[] = selectableModels([]);

function savedSelection(): ModelSelection {
  return readModelSelection({ model: defaultModelId, reasoningEffort: "high" });
}

export function App({ accountPanel }: { accountPanel?: ReactNode }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]); const [active, setActive] = useState<ProjectDetail | null>(null); const [loading, setLoading] = useState(true); const [offline, setOffline] = useState(false); const [openError, setOpenError] = useState(""); const [models, setModels] = useState(fallbackModels); const [selection, setSelection] = useState(savedSelection); const [voiceId, setVoiceId] = useState(() => readStringSetting("yingya-voice-id", "default"));
  const [route, navigate] = useAppRoute();
  const libraryUploads = useUploadQueue<Awaited<ReturnType<typeof api.uploadLibraryAsset>>>();
  const [opening, setOpening] = useState(Boolean(route.projectId));
  const saveSelection = (next: ModelSelection) => { setSelection(next); writeModelSelection(next); };
  const saveVoice = (next: string) => { setVoiceId(next); writeStringSetting("yingya-voice-id", next); };
  const refreshProjects = useCallback(async () => { try { setProjects(await api.listProjects()); setOffline(false); } catch { setOffline(true); } finally { setLoading(false); } }, []);
  const updateActiveProject = useCallback((detail: ProjectDetail) => { if (readRoute().projectId === detail.id) setActive(current => current?.id === detail.id ? detail : current); setProjects(current => current.map(project => project.id === detail.id ? projectSummary(detail) : project)); }, []);
  useEffect(() => { void refreshProjects(); void api.listModels().then(value => setModels(selectableModels(value.data))).catch(() => undefined); }, [refreshProjects]);
  const open = (id: string) => navigate({ section: "create", projectId: id });
  useEffect(() => {
    let cancelled = false;
    if (!route.projectId) { setActive(null); setOpening(false); setOpenError(""); return; }
    setOpening(true); setOpenError("");
    void api.getProject(route.projectId).then(detail => {
      if (cancelled) return;
      setActive(detail); setSelection(modelAllowed(detail.model) ? { model: detail.model, reasoningEffort: detail.reasoningEffort } : savedSelection()); setVoiceId(detail.voiceId); setOffline(false);
    }).catch(reason => { if (!cancelled) { setActive(null); setOpenError(reason instanceof Error ? reason.message : "项目加载失败"); } }).finally(() => { if (!cancelled) setOpening(false); });
    return () => { cancelled = true; };
  }, [route.projectId]);
  useEffect(() => {
    let disposed = false, inFlight = false;
    const sync = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try { const latest = await api.listProjects(); if (!disposed) { setProjects(latest); setOffline(false); } }
      catch { if (!disposed) setOffline(true); }
      finally { inFlight = false; }
    };
    const timer = window.setInterval(() => void sync(), 10000);
    document.addEventListener("visibilitychange", sync);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", sync); };
  }, []);
  async function deleteProject(project: ProjectRecord) {
    await api.deleteProject(project.id);
    setProjects(current => current.filter(item => item.id !== project.id));
    setActive(current => current?.id === project.id ? null : current);
  }
  async function renameProject(id: string, title: string) {
    const updated = await api.renameProject(id, title);
    setProjects(current => current.map(project => project.id === id ? { ...project, ...updated } : project));
    setActive(current => current?.id === id ? { ...current, ...updated } : current);
  }
  async function setProjectVoice(id: string, nextVoiceId: string) {
    const updated = await api.setProjectVoice(id, nextVoiceId);
    saveVoice(updated.voiceId);
    setProjects(current => current.map(project => project.id === id ? { ...project, ...updated } : project));
    setActive(current => current?.id === id ? { ...current, ...updated } : current);
  }
  if (offline && !active) return <div className="state-screen"><CloudSlash/><h1>暂时无法连接工作台</h1><p>已有项目会保留，连接恢复后可以继续创作</p><button className="primary-button" onClick={() => void refreshProjects()}>重新连接</button></div>;
  const showCreate = () => { navigate({ section: "create" }); void refreshProjects(); };
  const showAssets = () => navigate({ section: "assets" });
  const showProjects = () => { navigate({ section: "create", homeSection: "projects" }); void refreshProjects(); };
  const surface = opening && (!projects.length || active !== null) ? <div className="state-screen" role="status"><h1>正在恢复项目…</h1><button className="primary-button" onClick={showCreate}>返回所有项目</button></div>
    : active && route.projectId === active.id ? <AgentWorkspace key={active.id} project={active} models={models} selection={selection} onSelection={saveSelection} onVoice={voice => setProjectVoice(active.id, voice)} onProject={updateActiveProject} onRename={renameProject} onBack={showProjects}/>
    : route.section === "assets" ? <AssetStudio uploads={libraryUploads} key={route.assetTool ?? "library"} initialTool={route.assetTool} accountPanel={accountPanel} models={models} selection={selection} voiceId={voiceId} onSelection={saveSelection} onVoice={saveVoice} onCreate={showCreate}/>
    : <StartScreen onCreate={showCreate} homeSection={route.homeSection} accountPanel={accountPanel} openingProjectId={opening ? route.projectId : undefined} projects={projects} loading={loading} openError={openError} models={models} selection={selection} onSelection={saveSelection} voiceId={voiceId} onVoice={saveVoice} onOpen={open} onDelete={deleteProject} onRename={renameProject} onAssets={showAssets} onCreated={project => { setActive(project); navigate({ section: "create", projectId: project.id }); void refreshProjects(); }}/>;
  return <>{surface}{route.section !== "assets" && libraryUploads.items.length ? <div className="upload-dock"><UploadProgressList items={libraryUploads.items} onRetry={libraryUploads.retry} onClear={libraryUploads.clearCompleted}/></div> : null}{active && route.projectId === active.id ? <div className="workspace-account">{accountPanel}</div> : null}<TaskCenter projects={projects} offline={offline} onOpen={open}/></>;

}

function StartScreen({ onCreate, homeSection, accountPanel, openingProjectId, projects, loading, openError, models, selection, onSelection, voiceId, onVoice, onOpen, onDelete, onRename, onAssets, onCreated }: { onCreate: () => void; homeSection?: "styles" | "projects"; accountPanel?: ReactNode; openingProjectId?: string; projects: ProjectRecord[]; loading: boolean; openError: string; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; voiceId: string; onVoice: (voiceId: string) => void; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void>; onRename: (id: string, title: string) => Promise<void>; onAssets: () => void; onCreated: (value: ProjectDetail) => void }) {
  const [prompt, setPrompt, promptSaved] = useSavedState("yingya-home-prompt", z.string(), ""); const [aspectRatio, setAspectRatio] = useSavedState("yingya-knowledge-aspect", z.enum(["9:16", "16:9", "1:1"]), "16:9"); const [files, setFiles, fileDraftStatus] = useDraftFiles("home");
  const [preparation, setPreparation] = useState<HomeSource>("reference");
  const referenceFileRef = useRef<HTMLInputElement>(null);
  const musicFileRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [builtInOpen, setBuiltInOpen] = useState(false);
  const [visualReferences, setVisualReferences] = useSavedState('yingya-home-reference-previews', referencePreviewSchema, []);
  const brief = sourceBrief(preparation);
  useEffect(() => {
    const source = takeHomeSource();
    if (source) setPreparation(source);
    const incoming = takeHomeDraft();
    if (incoming) setPrompt(current => current.trim() ? `${current}\n${incoming}` : incoming);
  }, [setPrompt]);

  const [aspectAuto, setAspectAuto] = useSavedState("yingya-knowledge-aspect-auto", z.boolean(), false);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [delivery, setDelivery] = useState(0);
  const [duration, setDuration] = useSavedState("yingya-creation-duration", z.number().int().min(1).max(3600), 30);
  const uploads = useUploadQueue<{ path: string }>();
  const [assetRoles, setAssetRoles] = useSavedState("yingya-home-asset-roles", z.record(z.string(), assetRoleSchema), {});
  const [libraryIds, setLibraryIds] = useSavedState("yingya-home-library", z.array(z.string()), []); const [busy, setBusy] = useState(false); const [creationStage, setCreationStage] = useState<ProjectCreationStage>("creating"); const [error, setError] = useState(""); const fileRef = useRef<HTMLInputElement>(null);
  const attemptKey = useRef(userStorageKey("yingya-home-creation-attempt")).current;
  const [restoredAttempt] = useState(() => readCreationAttempt(attemptKey));
  const creationAttemptRef = useRef(restoredAttempt);
  const acceptedCreation = Boolean(creationAttemptRef.current?.accepted);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [search, setSearch] = useState("");
  const [openMenu, setOpenMenu] = useState("");
  const projectMenuRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openMenu) return;
    const outside = (event: PointerEvent) => { if (!projectMenuRoot.current?.contains(event.target as Node)) setOpenMenu(""); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [openMenu]);
  const menuPresence = useMotionPresence(openMenu || null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [projectSort, setProjectSort] = useState('recent');
  const [renaming, setRenaming] = useState<ProjectRecord | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const visibleProjects = projects.filter(project => (filter === "all" || projectCategory(project) === filter) && project.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => projectSort === "name" ? a.title.localeCompare(b.title, "zh-CN") : projectSort === "oldest" ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt);
  const filterCounts = Object.fromEntries(projectFilters.map(item => [item.id, projects.filter(project => item.id === "all" || projectCategory(project) === item.id).length]));
  const projectsPage = homeSection === "projects";
  const recentProjects = [...projects].sort((a, b) => Number(projectCategory(b) === "review") - Number(projectCategory(a) === "review") || b.updatedAt - a.updatedAt).slice(0, 3);
  const coverProjectIds = (projectsPage ? projects : recentProjects).map(project => `${project.id}:${project.updatedAt}`).join(",");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(coverProjectIds.split(",").filter(Boolean).map(entry => ({ id: entry.split(":")[0] })).map(async project => {
      try {
        const media = await api.getProjectMedia(project.id);
        const image = media.assets.find(asset => asset.mediaType?.startsWith("image/") || asset.kind === "image");
        return image ? [project.id, image.url] as const : undefined;
      } catch { return undefined; }
    })).then(entries => {
      if (!cancelled) setCovers(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => { cancelled = true; };
  }, [coverProjectIds]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if ((!prompt.trim() && !files.length && !libraryIds.length && !acceptedCreation) || busy || imageBusy || fileDraftStatus === "loading") return;
    const normalizedPrompt = prompt.trim() || materialOnlyPrompt;
    const requirements = { targetDurationSeconds: duration, durationMode: "target" as const, subtitles: "auto" as const, music: "auto" as const, audioMode: "auto" as const, creationMode: "motion" as const, reviewMode: "review" as const, aspectMode: aspectAuto ? "auto" as const : "fixed" as const, workflow: "knowledge-explainer" as const };
    const effectiveVoiceId = voiceId;
    const fileKeys = files.map((file, index) => `${index}:${file.name}:${file.size}:${file.lastModified}:${file.type}`);
    const signature = JSON.stringify({ prompt: normalizedPrompt, aspectRatio, voiceId: effectiveVoiceId, selection, fileKeys, libraryIds, assetRoles, requirements });
    let attempt = creationAttemptRef.current;
    if (!attempt || (!attempt.accepted && attempt.signature !== signature)) {
      attempt = newCreationAttempt(signature);
      creationAttemptRef.current = attempt;
    }
    setCreationStage("creating"); setBusy(true); setError("");
    try {
      // Save before the first request, including when a response may be lost on reload.
      saveCreationAttempt(attemptKey, attempt);
      if (!attempt.projectId) {
        const project = await api.createProject({ prompt: normalizedPrompt, clientRequestId: attempt.creationRequestId, aspectRatio, voiceId: effectiveVoiceId, ...selection, requirements });
        attempt.projectId = project.id;
        saveCreationAttempt(attemptKey, attempt);
      }
      const projectId = attempt.projectId;
      if (!mounted.current) return;
      if (!attempt.accepted) {
        setCreationStage("uploading");
        if (!attempt.turnInput) {
          const pending = attempt;
          const upload = async (key: string, action: () => Promise<{ path: string }>) => {
            if (pending.uploadedPaths[key]) return pending.uploadedPaths[key];
            const result = await action();
            pending.uploadedPaths[key] = result.path;
            saveCreationAttempt(attemptKey, pending);
            return result.path;
          };
          const uploaded = await uploads.run([
            ...files.map((file, index) => ({ id: `${projectId}:${fileKeys[index]}`, name: file.name, size: file.size,
              run: async (options: import("./upload").UploadOptions) => ({ path: await upload(fileKeys[index], () => api.uploadAsset(projectId, file, options)) }) })),
            ...libraryIds.map((id, index) => ({ id: `${projectId}:library:${id}`, name: `素材库引用 ${index + 1}`,
              run: async () => ({ path: await upload(`library:${id}`, () => api.importLibraryAsset(id, projectId)) }) })),
          ]);
          const uploadedPaths = uploaded.map(item => item.path);
          await Promise.all(uploadedPaths.map((path, index) => api.setAssetRole(projectId, path, assetRoles[index < files.length ? fileRoleKey(files[index]) : `library:${libraryIds[index - files.length]}`] ?? "auto")));
          attempt.turnInput = { baseVersionId: null, text: normalizedPrompt, clientRequestId: attempt.turnRequestId, attachments: uploadedPaths, ...selection };
          saveCreationAttempt(attemptKey, attempt);
        }
        if (!mounted.current) return;
        setCreationStage("starting");
        await api.sendTurn(projectId, attempt.turnInput);
        attempt.accepted = true;
        saveCreationAttempt(attemptKey, attempt);
      }
      if (!mounted.current) return;
      setCreationStage("opening");
      const detail = await api.getProject(projectId);
      if (!mounted.current) return;
      if (signature === attempt.signature) { setPrompt(""); setFiles([]); setLibraryIds([]); setAssetRoles({}); setVisualReferences([]); }
      saveCreationAttempt(attemptKey, null);
      creationAttemptRef.current = null;
      onCreated(detail);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法创建视频任务"); } finally { setBusy(false); }
  }
  function startCreating() {
    onCreate();
    requestAnimationFrame(() => promptRef.current?.focus({ preventScroll: true }));
  }
  function removeProject(project: ProjectRecord) { setOpenMenu(""); setDeleteError(""); setDeleting(project); }
  if (busy) return <ProjectCreationPendingView prompt={prompt.trim() || materialOnlyPrompt} fileCount={files.length + libraryIds.length} stage={creationStage}><UploadProgressList items={uploads.items}/></ProjectCreationPendingView>;
  return <div className={`home-layout home-layout--studio home-layout--product studio-shell editorial-shell ${projectsPage ? "studio-shell--library" : "studio-shell--home clean-create"}`}>
    <AppNavigation active={projectsPage ? "projects" : "create"} onCreate={startCreating} onAssets={onAssets} accountPanel={accountPanel}/>
    <main className="home-main">
      <div className="home-scroll">
        {openError ? <div className="open-project-error" role="alert">{openError}</div> : null}
        {!projectsPage ? <section className="home-create" aria-label="新建视频">
          <div className="creation-copy">
          <StudioCodeTag name="Create" className="creation-code-tag"/>
          <header className="creation-intro"><div><h1><span className="creation-greeting">今天，</span><br className="creation-title-break"/><KineticType text="从哪里开始？" cue={delivery}/></h1><p>带上参考链接、剧本与风格，先看画面，再确定方案。</p></div></header>
          <div className="creation-preparation" role="group" aria-label="准备创作内容">
            {briefSources.map(source => { const Icon = briefIcons[source.id]; return <button key={source.id} type="button" aria-pressed={preparation === source.id} onClick={() => { setPreparation(source.id); promptRef.current?.focus(); }}><Icon/>{source.label}</button>; })}
            <p>{brief.help}</p>
          </div>
          {prompt && !promptSaved ? <p className="form-error" role="status">草稿保存失败，请勿关闭页面</p> : null}
          <ComposerForm className="composer composer--hero" onSubmit={submit} filesDisabled={busy || fileDraftStatus === "loading" || acceptedCreation} onFiles={added => setFiles(current => [...current, ...added])}>
          <PaperDelivery cue={delivery}/>
          <label id="create-prompt-label" className="creation-prompt-label" htmlFor="creation-prompt">创作目标与参考说明</label>
          <textarea id="creation-prompt" aria-labelledby="create-prompt-label" aria-describedby="create-prompt-hint" ref={promptRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={brief.hint}/>
          {visualReferences.some(image => libraryIds.includes(image.id)) ? <div className="creation-reference-strip" aria-label="本次创作的图片参考">{visualReferences.filter(image => libraryIds.includes(image.id)).map((image, index) => <figure key={image.id}><img src={image.url} alt={`已选参考图 ${index + 1}`}/><figcaption>画面参考</figcaption><button type="button" disabled={busy || acceptedCreation} aria-label={`移除已选参考图 ${index + 1}`} onClick={() => setLibraryIds(current => current.filter(id => id !== image.id))}><X/></button></figure>)}</div> : null}
          <div className="attachment-row">{files.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<AssetRoleSelect name={file.name} value={assetRoles[fileRoleKey(file)]} onChange={role => setAssetRoles(current => ({ ...current, [fileRoleKey(file)]: role }))}/><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div>
          <div className="composer-tools"><div className="home-creation-options"><input ref={musicFileRef} hidden multiple type="file" accept="audio/*" aria-label="上传背景音乐" onChange={event => { const added = Array.from(event.target.files ?? []); setFiles(current => [...current, ...added]); setAssetRoles(current => ({ ...current, ...Object.fromEntries(added.map(file => [fileRoleKey(file), 'required'])) })); event.target.value = ''; }}/><input ref={imageFileRef} hidden multiple type="file" accept="image/*" aria-label="上传参考图" onChange={event => { const added = Array.from(event.target.files ?? []); setFiles(current => [...current, ...added]); setAssetRoles(current => ({ ...current, ...Object.fromEntries(added.map(file => [fileRoleKey(file), 'reference'])) })); event.target.value = ''; }}/><input ref={referenceFileRef} hidden multiple type="file" accept="video/*" aria-label="上传参考视频" onChange={event => { const added = Array.from(event.target.files ?? []); setFiles(current => [...current, ...added]); setAssetRoles(current => ({ ...current, ...Object.fromEntries(added.map(file => [fileRoleKey(file), 'reference'])) })); event.target.value = ''; }}/><input ref={fileRef} hidden multiple type="file" onChange={event => { const added = Array.from(event.target.files ?? []); setFiles(current => [...current, ...added]); event.target.value = ""; }}/><ComposerMoreMenu narration triggerLabel="添加素材" materialActions={[
            { label: '背景音乐', icon: <MusicNotes aria-hidden="true"/>, onSelect: () => musicFileRef.current?.click(), disabled: busy || fileDraftStatus === 'loading' || acceptedCreation },
            { label: '参考图', icon: <Image aria-hidden="true"/>, onSelect: () => imageFileRef.current?.click(), disabled: busy || fileDraftStatus === 'loading' || acceptedCreation },
            { label: '参考视频', icon: <FilmStrip aria-hidden="true"/>, onSelect: () => referenceFileRef.current?.click(), disabled: busy || fileDraftStatus === 'loading' || acceptedCreation },
            { label: '上传其他文件', icon: <UploadSimple aria-hidden="true"/>, onSelect: () => fileRef.current?.click(), disabled: busy || fileDraftStatus === 'loading' || acceptedCreation },
            { label: '素材库', icon: <Files aria-hidden="true"/>, onSelect: () => setLibraryOpen(true), disabled: busy || acceptedCreation, hint: libraryIds.length ? `已选 ${libraryIds.length} 项` : undefined },
            { label: '内置内容', icon: <Palette aria-hidden="true"/>, onSelect: () => setBuiltInOpen(true), disabled: busy || acceptedCreation },
          ]} onUpload={() => fileRef.current?.click()} onSelectAssets={() => setLibraryOpen(true)} selectedCount={libraryIds.length} voiceId={voiceId} onVoice={onVoice} running={busy || acceptedCreation}/><DurationControl value={duration} onChange={setDuration} disabled={busy || acceptedCreation}/><AspectRatioSelector value={aspectAuto ? "auto" : aspectRatio} onChange={value => { setAspectAuto(value === "auto"); if (value !== "auto") setAspectRatio(value); }}/><ModelSelector models={models} value={selection} onChange={onSelection} variant="creation"/></div><div className="creation-submit-actions"><button type="button" className="creation-image-first" disabled={busy || acceptedCreation} onClick={() => setImageOpen(true)}>{imageBusy ? <CircleNotch className="spin"/> : <Image/>}{imageBusy ? "参考图生成中" : "生成参考图"}</button><button className="send-button" disabled={(!prompt.trim() && !files.length && !libraryIds.length && !acceptedCreation) || busy || imageBusy || fileDraftStatus === "loading"} aria-label={acceptedCreation ? "继续打开任务" : "生成图文方案"}><span>{acceptedCreation ? "继续打开任务" : "生成图文方案"}</span><ArrowRight weight="bold"/></button></div></div>
          </ComposerForm>
          <div className="creation-input-meta"><p id="create-prompt-hint" className="creation-input-hint"><span>{prompt.trim() || files.length || libraryIds.length ? "先看参考图与关键画面，确认方向后再制作" : "在「添加素材」中上传音乐、图片或视频，剧本与大纲直接填入文本框"}</span></p><span className="creation-shortcut"><kbd>Enter</kbd> 生成图文方案 <span>·</span> <kbd>Shift ↵</kbd> 换行</span></div>
          {fileDraftStatus === "error" ? <p className="form-error" role="status">附件无法保存在此浏览器，刷新后需重新添加</p> : files.length ? <p className="draft-save-status">{fileDraftStatus === "saved" ? "附件已暂存，提交时上传" : "正在暂存附件…"}</p> : null}

          <UploadProgressList items={uploads.items}/>
          {acceptedCreation ? <p className="draft-save-status" role="status">任务已提交，继续打开可恢复制作进度</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <StudioCodeTag name="Create" closing className="creation-code-tag creation-code-tag--close"/>
          {builtInOpen ? <ActionDialog title="选用内置内容" className="brief-starter-dialog" onClose={() => setBuiltInOpen(false)}>
            <p>先选一份大纲或参考风格，再填入自己的内容。</p>
            <div className="brief-templates">{briefTemplates.map(template => <button type="button" key={template.title} onClick={() => { setPrompt(current => current.includes(template.text) ? current : [current.trim(), template.text].filter(Boolean).join('\n\n')); setPreparation('script'); setDelivery(value => value + 1); setBuiltInOpen(false); requestAnimationFrame(() => promptRef.current?.focus()); }}><strong>{template.title}</strong><span>{template.description}</span><ArrowRight/></button>)}</div>
            <h3>参考风格</h3><div className="brief-style-list">{referenceFilms.map(clip => <button type="button" key={clip.id} onClick={() => { const text = `参考视频：${new URL(clip.src, window.location.origin).href}\n参考风格：${clip.title}。请结合我的剧本与素材，先准备画面参考。`; setPrompt(current => current.includes(text) ? current : [current.trim(), text].filter(Boolean).join('\n\n')); setPreparation('reference'); setDelivery(value => value + 1); setBuiltInOpen(false); requestAnimationFrame(() => promptRef.current?.focus()); }}><img src={clip.poster} alt="" loading="lazy"/><span>{clip.title}</span></button>)}</div>
          </ActionDialog> : null}
          </div>
        </section> : null}
        {!projectsPage && recentProjects.length ? <section className="recent-creations" aria-label="继续创作">
          <header><h2>继续创作</h2><a href="#/projects">查看全部<ArrowRight/></a></header>
          <div>{recentProjects.map(project => <button className="recent-project" key={project.id} disabled={openingProjectId === project.id} onClick={() => onOpen(project.id)}>
            <ProjectCover poster={project.posterUrl} fallback={covers[project.id]} title={project.title} status={projectStatus(project)}/>
            <span className="recent-project-copy"><b>{project.title}</b><small><span>{openingProjectId === project.id ? "正在打开…" : projectStatus(project)}</span><time dateTime={new Date(project.updatedAt).toISOString()}>{formatHomeTime(project.updatedAt)}</time></small></span><span className="recent-project-action">{projectCategory(project) === "review" ? "审阅方案" : projectGroup(project) === "ready" ? "观看视频" : "继续创作"}<ArrowRight/></span>
          </button>)}</div>
        </section> : null}
        {projectsPage ? <section className="home-projects">
          <StudioCodeTag name="Projects" className="library-code-tag"/>
          <header><div className="home-project-heading"><h1><KineticType text="我的项目" reveal/></h1><p>从第一份方案，到每一次新的修改。</p><span className="sr-only" aria-live="polite">{loading ? "正在读取…" : `${visibleProjects.length} 个项目`}</span></div><button aria-label="创建新作品" className="project-create-button primary-button" onClick={startCreating}>新建视频<ArrowRight/></button></header>
          <div className="editorial-project-toolbar"><div className="project-filters" role="tablist" aria-label="筛选项目"><SelectionIndicator value={filter} line/>{projectFilters.map((item, index) => <button key={item.id} id={`project-filter-${item.id}`} role="tab" aria-controls="home-project-results" aria-selected={filter === item.id} tabIndex={filter === item.id ? 0 : -1} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)} onKeyDown={event => {
            const nextIndex = event.key === "ArrowRight" ? (index + 1) % projectFilters.length : event.key === "ArrowLeft" ? (index + projectFilters.length - 1) % projectFilters.length : event.key === "Home" ? 0 : event.key === "End" ? projectFilters.length - 1 : -1;
            if (nextIndex < 0) return;
            event.preventDefault(); setFilter(projectFilters[nextIndex].id); document.getElementById(`project-filter-${projectFilters[nextIndex].id}`)?.focus();
          }}>{item.label}<span aria-hidden="true">{filterCounts[item.id]}</span></button>)}</div><div className="editorial-project-search"><label className="home-project-search"><MagnifyingGlass/><input type="search" aria-label="搜索项目" placeholder="搜索项目名称" value={search} onChange={event => setSearch(event.target.value)}/>{search ? <button type="button" aria-label="清除搜索" onClick={() => setSearch("")}><X/></button> : null}</label><CatalogSort label="作品排序" value={projectSort} onChange={setProjectSort} options={[{ value: "recent", label: "最近更新" }, { value: "oldest", label: "最早更新" }, { value: "name", label: "名称排序" }]}/></div></div><p className="editorial-result-count" aria-live="polite">{loading ? "正在读取作品…" : `${visibleProjects.length} 个作品`}</p>
          <div className="home-project-list" key={filter} id="home-project-results" role="tabpanel" aria-labelledby={`project-filter-${filter}`}>
            {visibleProjects.map((project, index) => <article ref={openMenu === project.id ? projectMenuRoot : undefined} style={{ "--item-index": Math.min(index, 5) } as CSSProperties} key={project.id} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenMenu(current => current === project.id ? "" : current); }} onKeyDown={event => { if (event.key === "Escape") { setOpenMenu(""); event.currentTarget.querySelector<HTMLButtonElement>(".home-project-menu-button")?.focus(); } }}>
              <button className="home-project-open" disabled={openingProjectId === project.id} aria-busy={openingProjectId === project.id} onClick={() => onOpen(project.id)}>
                <ProjectCover poster={project.posterUrl} fallback={covers[project.id]} title={project.title} status={projectStatus(project)}/>
                <span className="home-project-copy"><b title={project.title}>{project.title}</b><span className="home-project-meta"><small className={`home-status home-status--${projectGroup(project)}`}><i/>{openingProjectId === project.id ? "正在打开…" : projectStatus(project)}</small><span className="home-project-ratio">{project.aspectRatio}</span><time dateTime={new Date(project.updatedAt).toISOString()}>{formatHomeTime(project.updatedAt)}</time></span></span>
                {openingProjectId === project.id ? <CircleNotch className="home-project-loading spin"/> : <ArrowRight className="home-project-arrow"/>}
              </button>
              <button className="home-project-menu-button" aria-label={`项目操作 ${project.title}`} aria-expanded={openMenu === project.id} onClick={() => setOpenMenu(current => current === project.id ? "" : project.id)}><DotsThree weight="bold"/></button>
              {menuPresence.value === project.id ? <div ref={menuPresence.ref} inert={menuPresence.exiting} aria-hidden={menuPresence.exiting || undefined} className="home-project-menu"><button onClick={() => onOpen(project.id)}><ArrowRight/>打开项目</button><button onClick={() => { setOpenMenu(""); setRenaming(project); setRenameTitle(project.title); setRenameError(""); }}><PencilSimple/>重命名</button><button disabled={Boolean(project.activeTurnId)} onClick={() => void removeProject(project)}><Trash/>删除项目</button></div> : null}
            </article>)}
            {loading ? <div className="home-project-message">正在读取项目…</div> : null}
            {!loading && !visibleProjects.length ? <div className="home-project-empty"><b>{projects.length ? "没有符合条件的项目" : "还没有视频项目"}</b><span>{projects.length ? "试试其他关键词，或切换项目状态" : "新建视频，开始你的第一个作品"}</span>{projects.length ? <button className="home-reset-filters" onClick={() => { setSearch(""); setFilter("all"); }}>查看全部项目</button> : <button className="home-reset-filters" onClick={startCreating}>开始创作<ArrowRight/></button>}</div> : null}
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <StudioCodeTag name="Projects" closing className="library-code-tag"/>
        </section> : null}
      </div>
    </main>
    {deleting ? <ActionDialog title="删除项目" busy={deleteBusy} onClose={() => setDeleting(null)}><p>确定删除「{deleting.title}」？项目文件与生成内容将被删除，已有分享链接也会失效。</p>{deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}<footer><button type="button" disabled={deleteBusy} onClick={() => setDeleting(null)}>保留项目</button><button type="button" className="danger-button" disabled={deleteBusy} onClick={async () => { setDeleteBusy(true); setDeleteError(''); try { await onDelete(deleting); setDeleting(null); } catch (reason) { setDeleteError(reason instanceof Error ? reason.message : '删除失败，请重试'); } finally { setDeleteBusy(false); } }}>{deleteBusy ? '正在删除…' : '确认删除'}</button></footer></ActionDialog> : null}
    {renaming ? <ActionDialog title="重命名作品" busy={renameBusy} onClose={() => setRenaming(null)}><form onSubmit={async event => { event.preventDefault(); if (renameBusy || !renameTitle.trim()) return; setRenameBusy(true); setRenameError(''); try { await onRename(renaming.id, renameTitle.trim()); setRenaming(null); } catch (reason) { setRenameError(reason instanceof Error ? reason.message : '名称保存失败，请重试'); } finally { setRenameBusy(false); } }}><label>作品名称<input autoFocus value={renameTitle} maxLength={120} disabled={renameBusy} onChange={event => setRenameTitle(event.target.value)} /></label>{renameError ? <p className="form-error" role="alert">{renameError}</p> : null}<footer><button type="button" disabled={renameBusy} onClick={() => setRenaming(null)}>取消</button><button className="primary-button" disabled={renameBusy || !renameTitle.trim()}>{renameBusy ? '正在保存…' : '保存名称'}</button></footer></form></ActionDialog> : null}
          <ReferenceImageDialog open={imageOpen} brief={prompt} models={models} selection={selection} onSelection={onSelection} onBusyChange={setImageBusy} onClose={() => setImageOpen(false)} onChoose={images => {
            setLibraryIds(current => [...new Set([...current, ...images.map(image => image.id)])]);
            setAssetRoles(current => ({ ...current, ...Object.fromEntries(images.map(image => [`library:${image.id}`, 'reference'])) }));
            setVisualReferences(current => [...current.filter(image => !images.some(next => next.id === image.id)), ...images.map(({ id, url }) => ({ id, url }))]);
          }}/>
    {libraryOpen ? <CreationLibraryDialog selectedIds={libraryIds} onSelect={setLibraryIds} roles={assetRoles} onRole={(id, role) => setAssetRoles(current => ({ ...current, [id]: role }))} onClose={() => setLibraryOpen(false)}/> : null}
  </div>;
}

type ProjectFilter = "all" | "active" | "review" | "ready";

const projectFilters: { id: ProjectFilter; label: string }[] = [
  { id: "all", label: "全部" }, { id: "active", label: "制作中" }, { id: "review", label: "待处理" }, { id: "ready", label: "可导出" },
];

function formatHomeTime(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return `${sameDay ? "今天" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function ProjectCover({ poster, fallback, title, status }: { poster?: string; fallback?: string; title: string; status: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const url = [poster, fallback].find(value => value && !failed.includes(value));
  return <span className="home-project-cover">{url ? <img loading="lazy" src={url} alt="" onError={() => setFailed(current => [...current, url])}/> : <span className="project-type-cover"><small>{status}</small><strong>{title}</strong><span>映芽<i/></span></span>}<span className="home-project-cover-action" aria-hidden="true"><ArrowRight/>打开作品</span></span>;
}
