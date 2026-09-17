import { CreationTaskLauncher, CreationTaskDialog } from "./components/CreationTaskLauncher";
import type { CreationTask } from "./creationTasks";
import { CapabilityGallery, CapabilityDetails } from "./components/CapabilityExplorer";
import { CreationLibraryDialog } from "./components/CreationLibraryDialog";
import { capabilities, capabilityInputHints, presentationLabel, type Capability } from "./capabilities";
import { presentationSchema, type PresentationChoice } from "./presentation";
import { ComposerForm } from "./components/ComposerForm";
import { AssetRoleSelect } from "./components/AssetRoleSelect";
import { assetRoleSchema } from "./schemas";
import { fileRoleKey, materialOnlyPrompt } from "./workbench";
import { SelectionIndicator } from "./components/SelectionIndicator";
import { useMotionPresence } from "./hooks/useMotionPresence";
import { ArrowRight, ArrowUp, CheckCircle, CircleNotch, CloudSlash, DotsThree, FilmSlate, Images, MagnifyingGlass, Cube, FolderSimple, UploadSimple, Plus, Trash, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useDraftFiles } from "./hooks/useDraftFiles";
import { CreationSettings, creationRequirements, creationSettingsSchema, defaultCreationSettings } from "./components/CreationSettings";
import { z } from "zod";
import { useSavedState } from "./hooks/useSavedState";
import { readRoute, useAppRoute } from "./hooks/useAppRoute";
import { TaskCenter } from "./components/TaskCenter";
import { projectGroup, projectStatus, projectSummary } from "./projectState";
import { api } from "./api";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { AssetStudio } from "./components/AssetStudio";
import { ModelSelector } from "./components/ModelSelector";
import { ProjectCreationPendingView, type ProjectCreationStage } from "./components/ProjectCreationPendingView";
import { VoiceSelector } from "./components/VoiceSelector";
import type { CodexModel, ModelSelection, ProjectDetail, ProjectRecord } from "./types";
import { readModelSelection, readStringSetting, writeModelSelection, writeStringSetting } from "./storage";
import { newCreationAttempt, readCreationAttempt, saveCreationAttempt } from "./creationAttempt";
import { userStorageKey } from "./session";
import { selectableModels, modelAllowed } from "./models";

const fallbackModels: CodexModel[] = selectableModels([
  ["gpt-5.6-terra", "GPT-5.6 Terra", "均衡的质量与速度"], ["gpt-5.6-sol", "GPT-5.6 Sol", "复杂创作与高质量推理"], ["gpt-5.6-luna", "GPT-5.6 Luna", "快速迭代"],
].map(([model, displayName, description], index) => ({ id: model, model, displayName, description, hidden: false, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map(reasoningEffort => ({ reasoningEffort, description: "" })), defaultReasoningEffort: "medium", isDefault: index === 0 })));

function savedSelection(): ModelSelection {
  return readModelSelection({ model: "gpt-5.6-terra", reasoningEffort: "high" });
}

export function App({ accountPanel }: { accountPanel?: ReactNode }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]); const [active, setActive] = useState<ProjectDetail | null>(null); const [loading, setLoading] = useState(true); const [offline, setOffline] = useState(false); const [openError, setOpenError] = useState(""); const [models, setModels] = useState(fallbackModels); const [selection, setSelection] = useState(savedSelection); const [voiceId, setVoiceId] = useState(() => readStringSetting("yingya-voice-id", "default"));
  const [route, navigate] = useAppRoute();
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
  if (offline && !active) return <div className="state-screen"><CloudSlash/><h1>本地服务未连接</h1><p>项目仍保存在电脑上。服务恢复后可继续。</p><button className="primary-button" onClick={() => void refreshProjects()}>重新连接</button></div>;
  const showCreate = () => { navigate({ section: "create" }); void refreshProjects(); };
  const showAssets = () => navigate({ section: "assets" });
  const surface = opening && (!projects.length || active !== null) ? <div className="state-screen" role="status"><h1>正在恢复项目…</h1><button className="primary-button" onClick={showCreate}>返回所有项目</button></div>
    : active && route.projectId === active.id ? <AgentWorkspace key={active.id} project={active} models={models} selection={selection} onSelection={saveSelection} onVoice={voice => setProjectVoice(active.id, voice)} onProject={updateActiveProject} onRename={renameProject} onBack={showCreate}/>
    : route.section === "assets" ? <AssetStudio key={route.assetTool ?? "library"} initialTool={route.assetTool} accountPanel={accountPanel} models={models} selection={selection} voiceId={voiceId} onSelection={saveSelection} onVoice={saveVoice} onCreate={showCreate}/>
    : <StartScreen accountPanel={accountPanel} openingProjectId={opening ? route.projectId : undefined} projects={projects} loading={loading} openError={openError} models={models} selection={selection} onSelection={saveSelection} voiceId={voiceId} onVoice={saveVoice} onOpen={open} onDelete={deleteProject} onAssets={showAssets} onTool={assetTool => navigate({ section: "assets", assetTool })} onCreated={project => { setActive(project); navigate({ section: "create", projectId: project.id }); void refreshProjects(); }}/>;
  return <>{surface}<TaskCenter projects={projects} offline={offline} onOpen={open}/></>;

}

function StartScreen({ accountPanel, openingProjectId, projects, loading, openError, models, selection, onSelection, voiceId, onVoice, onOpen, onDelete, onAssets, onTool, onCreated }: { accountPanel?: ReactNode; openingProjectId?: string; projects: ProjectRecord[]; loading: boolean; openError: string; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; voiceId: string; onVoice: (voiceId: string) => void; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void>; onAssets: () => void; onTool: (tool: "image" | "voice") => void; onCreated: (value: ProjectDetail) => void }) {
  const [prompt, setPrompt, promptSaved] = useSavedState("yingya-home-prompt", z.string(), ""); const [aspectRatio, setAspectRatio] = useSavedState("yingya-home-aspect", z.enum(["9:16", "16:9", "1:1"]), "9:16"); const [files, setFiles, fileDraftStatus] = useDraftFiles("home");
  const [presentation, setPresentation, presentationSaved] = useSavedState("yingya-home-presentation", presentationSchema.nullable(), null);
  const [capabilityId, setCapabilityId] = useState<string | null>(() => matchMedia("(min-width: 1100px)").matches ? (presentation?.capabilityId ?? "model-stage") : null);
  const capability = capabilities.find(item => item.id === capabilityId);
  const capabilityButton = useRef<HTMLButtonElement | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [creationTask, setCreationTask] = useState<CreationTask | null>(null);
  function openCapability(item: Capability, button: HTMLButtonElement) { capabilityButton.current = button; setCapabilityId(item.id); }
  function closeCapability() { setCapabilityId(null); requestAnimationFrame(() => capabilityButton.current?.focus()); }
  function chooseCapability(choice: PresentationChoice) { setPresentation(choice); setCapabilityId(null); setError(""); requestAnimationFrame(startCreating); }
  const [settings, setSettings] = useSavedState("yingya-creation-settings", creationSettingsSchema, defaultCreationSettings);
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
  const menuPresence = useMotionPresence(openMenu || null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const visibleProjects = projects.filter(project => (filter === "all" || projectGroup(project) === filter) && project.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const filterCounts = Object.fromEntries(projectFilters.map(item => [item.id, projects.filter(project => item.id === "all" || projectGroup(project) === item.id).length]));
  const coverProjectIds = projects.map(project => `${project.id}:${project.updatedAt}`).join(",");
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
    event.preventDefault(); if ((!prompt.trim() && !files.length && !libraryIds.length && !acceptedCreation) || busy || fileDraftStatus === "loading") return;
    const normalizedPrompt = prompt.trim() || materialOnlyPrompt;
    const requirements = { ...creationRequirements(settings), ...(presentation ? { presentation } : {}) };
    const effectiveVoiceId = settings.audioMode === "narration" || settings.audioMode === "replace" ? voiceId : "default";
    const fileKeys = files.map((file, index) => `${index}:${file.name}:${file.size}:${file.lastModified}:${file.type}`);
    const signature = JSON.stringify({ prompt: normalizedPrompt, aspectRatio, voiceId: effectiveVoiceId, selection, fileKeys, libraryIds, assetRoles, requirements });
    let attempt = creationAttemptRef.current;
    if (!attempt || (!attempt.accepted && attempt.signature !== signature)) {
      attempt = newCreationAttempt(signature);
      creationAttemptRef.current = attempt;
    }
    setCreationStage("creating"); setBusy(true); setError("");
    try {
      if (!attempt.accepted && presentation?.capabilityId === "model-stage" && !files.some(file => /\.(glb|gltf)$/i.test(file.name))) {
        const library = libraryIds.length ? await api.listAssetLibrary() : { assets: [] };
        if (!library.assets.some(asset => libraryIds.includes(asset.id) && /\.(glb|gltf)$/i.test(asset.sourceName ?? ""))) {
          throw new Error("3D 展示需要已有模型，请上传 GLB 文件或从素材库选择模型，也可以移除表现方式后继续。");
        }
      }
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
          const uploadedPaths = await Promise.all(files.map((file, index) => upload(fileKeys[index], () => api.uploadAsset(projectId, file))));
          uploadedPaths.push(...await Promise.all(libraryIds.map(id => upload(`library:${id}`, () => api.importLibraryAsset(id, projectId)))));
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
      if (signature === attempt.signature) { setPrompt(""); setFiles([]); setLibraryIds([]); setAssetRoles({}); setPresentation(null); }
      saveCreationAttempt(attemptKey, null);
      creationAttemptRef.current = null;
      onCreated(detail);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法创建视频任务"); } finally { setBusy(false); }
  }
  function startCreating() {
    promptRef.current?.focus();
    promptRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
  }
  async function removeProject(project: ProjectRecord) {
    setOpenMenu("");
    if (!window.confirm(`确定删除“${project.title}”吗？\n项目文件和生成内容将被永久删除，已创建的分享链接也会失效。`)) return;
    try { await onDelete(project); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "项目删除失败，请重试"); }
  }
  if (busy) return <ProjectCreationPendingView prompt={prompt.trim() || materialOnlyPrompt} fileCount={files.length + libraryIds.length} stage={creationStage}/>;
  return <div className="home-layout home-layout--studio home-layout--capabilities">
    <aside className="home-nav">
      <div className="home-brand"><img src="/brand/yingya-ghost.png" alt=""/><b>映芽</b></div>
      <button className="home-new-button" onClick={startCreating}><Plus weight="bold"/>新建视频</button>
      <nav aria-label="映芽功能">
        <button className="active" aria-current="page" onClick={startCreating}><FilmSlate/>视频创作</button>
        <button onClick={onAssets}><Images/>素材工坊</button>
      </nav>
      {accountPanel}
    </aside>
    <main className="home-main">
      <div className="home-scroll">
        <header className="home-header">
          <div><h1>把内容，做成<span className="home-title-phrase">会动的视频。</span></h1><p>从素材出发，也可以先选一种表现方式。</p></div>
        </header>
        {openError ? <div className="open-project-error" role="alert">{openError}</div> : null}
        <section className="home-create">
          <h2 id="create-prompt-label" className="sr-only">想把什么内容做成视频？</h2>{prompt && !promptSaved ? <p className="form-error" role="status">草稿保存失败，请勿关闭页面</p> : null}
          <ComposerForm className="composer composer--hero" onSubmit={submit} filesDisabled={busy || fileDraftStatus === "loading" || acceptedCreation} onFiles={added => setFiles(current => [...current, ...added])}>
          {presentation ? <div className="cap-method-chip"><Cube/><span>表现方式：{presentationLabel(presentation)}</span><button type="button" aria-label="移除表现方式" onClick={() => { setPresentation(null); setError(""); }}><X/></button></div> : null}
          {presentation ? <p className="cap-composer-help">接下来：{capabilityInputHints[presentation.capabilityId]}</p> : null}
          {presentation && !presentationSaved ? <p className="form-error" role="status">表现方式未能保存，关闭前请重试。</p> : null}
          <textarea aria-labelledby="create-prompt-label" aria-describedby="creation-workflow" ref={promptRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={presentation ? capabilityInputHints[presentation.capabilityId] : "描述你的视频想法，或粘贴文案、网页链接…"}/>
          <div className="attachment-row">{files.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<AssetRoleSelect name={file.name} value={assetRoles[fileRoleKey(file)]} onChange={role => setAssetRoles(current => ({ ...current, [fileRoleKey(file)]: role }))}/><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div>
          <div className="home-material-tools"><button type="button" onClick={() => fileRef.current?.click()} aria-label="添加附件"><UploadSimple/>上传素材</button><button type="button" onClick={() => setLibraryOpen(true)}><FolderSimple/>从素材库选择{libraryIds.length ? ` · ${libraryIds.length} 项` : ""}</button></div><div className="composer-tools"><div><input ref={fileRef} hidden multiple type="file" onChange={event => { const added = Array.from(event.target.files ?? []); setFiles(current => [...current, ...added]); event.target.value = ""; }}/><select aria-label="视频画幅" value={aspectRatio} onChange={event => setAspectRatio(event.target.value as typeof aspectRatio)}><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select>{settings.audioMode === "narration" || settings.audioMode === "replace" ? <VoiceSelector value={voiceId} onChange={onVoice}/> : null}<ModelSelector models={models} value={selection} onChange={onSelection}/></div><button className="send-button" disabled={(!prompt.trim() && !files.length && !libraryIds.length && !acceptedCreation) || busy || fileDraftStatus === "loading"} aria-label={acceptedCreation ? "继续打开任务" : "创建视频任务"} title={acceptedCreation ? "继续打开任务" : "创建视频任务"}><span>{acceptedCreation ? "继续打开任务" : !prompt.trim() && (files.length || libraryIds.length) ? "分析素材" : "开始制作"}</span><ArrowUp weight="bold"/></button></div>
          </ComposerForm>
          {fileDraftStatus === "error" ? <p className="form-error" role="status">附件无法保存在此浏览器，刷新后需重新添加。</p> : files.length ? <p className="draft-save-status">{fileDraftStatus === "saved" ? "附件已保存" : "正在保存附件…"}</p> : null}
          <CreationSettings includeLibrary={false} value={settings} onChange={setSettings} selectedIds={libraryIds} onSelect={setLibraryIds} roles={assetRoles} onRole={(id, role) => setAssetRoles(current => ({ ...current, [id]: role }))}/>

          <ol className="home-workflow" id="creation-workflow" aria-label="视频制作流程">
            <li><span aria-hidden="true">1</span><b>确认方案</b><ArrowRight aria-hidden="true"/></li>
            <li><span aria-hidden="true">2</span><b>预览与修改</b><ArrowRight aria-hidden="true"/></li>
            <li><span aria-hidden="true">3</span><b>导出成片</b></li>
          </ol>
          {acceptedCreation ? <p className="draft-save-status" role="status">任务已提交，继续打开可恢复制作进度。</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </section>
        <CreationTaskLauncher onTask={task => { setCapabilityId(null); setCreationTask(task); }} onTool={onTool}/>
        <CapabilityGallery onChoose={chooseCapability} selectedId={capabilityId ?? undefined} onOpen={openCapability}/>
        <section className="home-projects">
          <header><div className="home-project-heading"><h2>最近项目</h2><span aria-live="polite">{loading ? "正在读取…" : `${visibleProjects.length} 个项目`}</span></div><label className="home-project-search"><MagnifyingGlass/><input type="search" aria-label="搜索项目" placeholder="搜索项目名称" value={search} onChange={event => setSearch(event.target.value)}/>{search ? <button type="button" aria-label="清除搜索" onClick={() => setSearch("")}><X/></button> : null}</label></header>
          <div className="project-filters" role="tablist" aria-label="筛选项目"><SelectionIndicator value={filter}/>{projectFilters.map((item, index) => <button key={item.id} id={`project-filter-${item.id}`} role="tab" aria-controls="home-project-results" aria-selected={filter === item.id} tabIndex={filter === item.id ? 0 : -1} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)} onKeyDown={event => {
            const nextIndex = event.key === "ArrowRight" ? (index + 1) % projectFilters.length : event.key === "ArrowLeft" ? (index + projectFilters.length - 1) % projectFilters.length : event.key === "Home" ? 0 : event.key === "End" ? projectFilters.length - 1 : -1;
            if (nextIndex < 0) return;
            event.preventDefault(); setFilter(projectFilters[nextIndex].id); document.getElementById(`project-filter-${projectFilters[nextIndex].id}`)?.focus();
          }}>{item.label}<span aria-hidden="true">{filterCounts[item.id]}</span></button>)}</div>
          <div className="home-project-list" key={filter} id="home-project-results" role="tabpanel" aria-labelledby={`project-filter-${filter}`}>
            {visibleProjects.map((project, index) => <article style={{ "--item-index": Math.min(index, 5) } as CSSProperties} key={project.id} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpenMenu(current => current === project.id ? "" : current); }} onKeyDown={event => { if (event.key === "Escape") { setOpenMenu(""); event.currentTarget.querySelector<HTMLButtonElement>(".home-project-menu-button")?.focus(); } }}>
              <button className="home-project-open" disabled={openingProjectId === project.id} aria-busy={openingProjectId === project.id} onClick={() => onOpen(project.id)}>
                <ProjectCover poster={project.posterUrl} fallback={covers[project.id]}/>
                <span className="home-project-copy"><b title={project.title}>{project.title}</b><span className="home-project-meta"><small className={`home-status home-status--${projectGroup(project)}`}><i/>{openingProjectId === project.id ? "正在打开…" : projectStatus(project)}</small><span className="home-project-ratio">{project.aspectRatio}</span><time dateTime={new Date(project.updatedAt).toISOString()}>{formatHomeTime(project.updatedAt)}</time></span></span>
                {openingProjectId === project.id ? <CircleNotch className="home-project-loading spin"/> : <ArrowRight className="home-project-arrow"/>}
              </button>
              <button className="home-project-menu-button" aria-label={`项目操作 ${project.title}`} aria-expanded={openMenu === project.id} onClick={() => setOpenMenu(current => current === project.id ? "" : project.id)}><DotsThree weight="bold"/></button>
              {menuPresence.value === project.id ? <div ref={menuPresence.ref} inert={menuPresence.exiting} aria-hidden={menuPresence.exiting || undefined} className="home-project-menu"><button onClick={() => onOpen(project.id)}><ArrowRight/>打开项目</button><button disabled={Boolean(project.activeTurnId)} onClick={() => void removeProject(project)}><Trash/>删除项目</button></div> : null}
            </article>)}
            {loading ? <div className="home-project-message">正在读取项目…</div> : null}
            {!loading && !visibleProjects.length ? <div className="home-project-empty"><CheckCircle/><b>{projects.length ? "没有符合条件的项目" : "还没有视频项目"}</b><span>{projects.length ? "试试其他关键词，或切换项目状态。" : "从上方描述你的第一个视频想法。"}</span>{projects.length ? <button className="home-reset-filters" onClick={() => { setSearch(""); setFilter("all"); }}>查看全部项目</button> : null}</div> : null}
          </div>
        </section>
      </div>
    </main>
    {capability ? <CapabilityDetails key={capability.id} capability={capability} onClose={closeCapability} onChoose={chooseCapability}/> : null}
    {creationTask ? <CreationTaskDialog key={creationTask.id} task={creationTask} hasDraft={Boolean(prompt.trim())} fileCount={files.length + libraryIds.length} onFiles={added => setFiles(current => [...current, ...added])} onLibrary={() => setLibraryOpen(true)} onClose={() => setCreationTask(null)} onApply={text => { setPrompt(current => current.trim() ? `${current.trimEnd()}\n\n${text}` : text); setCreationTask(null); setError(""); requestAnimationFrame(startCreating); }}/> : null}
    {libraryOpen ? <CreationLibraryDialog selectedIds={libraryIds} onSelect={setLibraryIds} roles={assetRoles} onRole={(id, role) => setAssetRoles(current => ({ ...current, [id]: role }))} onClose={() => setLibraryOpen(false)}/> : null}
  </div>;
}



type ProjectFilter = "all" | "active" | "review" | "ready" | "completed" | "failed";

const projectFilters: { id: ProjectFilter; label: string }[] = [
  { id: "all", label: "全部" }, { id: "active", label: "制作中" }, { id: "review", label: "待处理" }, { id: "ready", label: "可导出" }, { id: "completed", label: "已导出" }, { id: "failed", label: "待恢复" },
];

function formatHomeTime(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return `${sameDay ? "今天" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

function ProjectCover({ poster, fallback }: { poster?: string; fallback?: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const url = [poster, fallback].find(value => value && !failed.includes(value));
  return <span className="home-project-cover">{url ? <img loading="lazy" src={url} alt="" onError={() => setFailed(current => [...current, url])}/> : <FilmSlate/>}<span className="home-project-cover-action" aria-hidden="true"><ArrowRight/>打开作品</span></span>;
}
