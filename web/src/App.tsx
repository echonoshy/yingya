import { AppNavigation } from "./components/AppNavigation";
import { StudioArtwork } from "./components/StudioTheme";

import { ComposerMoreMenu } from "./components/ComposerMoreMenu";

import { CreationLibraryDialog } from "./components/CreationLibraryDialog";
import { ComposerForm } from "./components/ComposerForm";
import { AssetRoleSelect } from "./components/AssetRoleSelect";
import { assetRoleSchema } from "./schemas";
import { fileRoleKey, materialOnlyPrompt } from "./workbench";
import { SelectionIndicator } from "./components/SelectionIndicator";
import { useMotionPresence } from "./hooks/useMotionPresence";
import { ArrowRight, CircleNotch, CloudSlash, DotsThree, FilmSlate, MagnifyingGlass, Trash, X } from "@phosphor-icons/react";
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
  if (offline && !active) return <div className="state-screen"><StudioArtwork variant="empty"/><CloudSlash/><h1>本地服务未连接</h1><p>项目仍保存在电脑上。服务恢复后可继续。</p><button className="primary-button" onClick={() => void refreshProjects()}>重新连接</button></div>;
  const showCreate = () => { navigate({ section: "create" }); void refreshProjects(); };
  const showAssets = () => navigate({ section: "assets" });
  const showProjects = () => { navigate({ section: "create", homeSection: "projects" }); void refreshProjects(); };
  const surface = opening && (!projects.length || active !== null) ? <div className="state-screen" role="status"><StudioArtwork variant="workspace"/><h1>正在恢复项目…</h1><button className="primary-button" onClick={showCreate}>返回所有项目</button></div>
    : active && route.projectId === active.id ? <AgentWorkspace key={active.id} project={active} models={models} selection={selection} onSelection={saveSelection} onVoice={voice => setProjectVoice(active.id, voice)} onProject={updateActiveProject} onRename={renameProject} onBack={showProjects}/>
    : route.section === "assets" ? <AssetStudio key={route.assetTool ?? "library"} initialTool={route.assetTool} accountPanel={accountPanel} models={models} selection={selection} voiceId={voiceId} onSelection={saveSelection} onVoice={saveVoice} onCreate={showCreate}/>
    : <StartScreen onCreate={showCreate} homeSection={route.homeSection} accountPanel={accountPanel} openingProjectId={opening ? route.projectId : undefined} projects={projects} loading={loading} openError={openError} models={models} selection={selection} onSelection={saveSelection} voiceId={voiceId} onVoice={saveVoice} onOpen={open} onDelete={deleteProject} onAssets={showAssets} onCreated={project => { setActive(project); navigate({ section: "create", projectId: project.id }); void refreshProjects(); }}/>;
  return <>{surface}<TaskCenter projects={projects} offline={offline} onOpen={open}/></>;

}

function StartScreen({ onCreate, homeSection, accountPanel, openingProjectId, projects, loading, openError, models, selection, onSelection, voiceId, onVoice, onOpen, onDelete, onAssets, onCreated }: { onCreate: () => void; homeSection?: "styles" | "projects"; accountPanel?: ReactNode; openingProjectId?: string; projects: ProjectRecord[]; loading: boolean; openError: string; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; voiceId: string; onVoice: (voiceId: string) => void; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void>; onAssets: () => void; onCreated: (value: ProjectDetail) => void }) {
  const [prompt, setPrompt, promptSaved] = useSavedState("yingya-home-prompt", z.string(), ""); const [aspectRatio, setAspectRatio] = useSavedState("yingya-knowledge-aspect", z.enum(["9:16", "16:9", "1:1"]), "16:9"); const [files, setFiles, fileDraftStatus] = useDraftFiles("home");

  const [aspectAuto, setAspectAuto] = useSavedState("yingya-knowledge-aspect-auto", z.boolean(), false);

  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settings, setSettings] = useSavedState("yingya-knowledge-settings", creationSettingsSchema, { ...defaultCreationSettings, duration: "120", subtitles: "中文字幕", audioMode: "narration" });
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
  const projectsPage = homeSection === "projects";
  const coverProjectIds = (projectsPage ? projects : []).map(project => `${project.id}:${project.updatedAt}`).join(",");
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
    const requirements = { ...creationRequirements(settings), creationMode: "motion" as const, reviewMode: "review" as const, aspectMode: aspectAuto ? "auto" as const : "fixed" as const, workflow: "knowledge-explainer" as const };
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
      if (signature === attempt.signature) { setPrompt(""); setFiles([]); setLibraryIds([]); setAssetRoles({}); }
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
  async function removeProject(project: ProjectRecord) {
    setOpenMenu("");
    if (!window.confirm(`确定删除“${project.title}”吗？\n项目文件和生成内容将被永久删除，已创建的分享链接也会失效。`)) return;
    try { await onDelete(project); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "项目删除失败，请重试"); }
  }
  if (busy) return <ProjectCreationPendingView prompt={prompt.trim() || materialOnlyPrompt} fileCount={files.length + libraryIds.length} stage={creationStage}/>;
  return <div className={`home-layout home-layout--studio home-layout--product studio-shell ${projectsPage ? "studio-shell--library" : "studio-shell--home"}`}>
    <AppNavigation active={projectsPage ? "projects" : "create"} onCreate={startCreating} onAssets={onAssets} accountPanel={accountPanel}/>
    <main className="home-main">
      <div className="home-scroll">
        {openError ? <div className="open-project-error" role="alert">{openError}</div> : null}
        {!projectsPage ? <section className="home-create" aria-label="新建视频">
          <header className="creation-intro"><h1>今天想做什么视频？</h1><p>把想法、资料和素材，变成讲得清楚的视频</p></header>
          <StudioArtwork variant="home"/>
          <h2 id="create-prompt-label" className="sr-only">新建视频</h2>{prompt && !promptSaved ? <p className="form-error" role="status">草稿保存失败，请勿关闭页面</p> : null}
          <ComposerForm className="composer composer--hero" onSubmit={submit} filesDisabled={busy || fileDraftStatus === "loading" || acceptedCreation} onFiles={added => setFiles(current => [...current, ...added])}>
          <textarea aria-labelledby="create-prompt-label" ref={promptRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="描述视频内容，或添加参考资料"/>
          <div className="attachment-row">{files.map((file, index) => <span key={`${file.name}-${index}`}>{file.name}<AssetRoleSelect name={file.name} value={assetRoles[fileRoleKey(file)]} onChange={role => setAssetRoles(current => ({ ...current, [fileRoleKey(file)]: role }))}/><button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div>
          <div className="composer-tools"><div className="home-creation-options"><input ref={fileRef} hidden multiple type="file" onChange={event => { setFiles(current => [...current, ...Array.from(event.target.files ?? [])]); event.target.value = ""; }}/><ComposerMoreMenu onUpload={() => fileRef.current?.click()} onSelectAssets={() => setLibraryOpen(true)} selectedCount={libraryIds.length} voiceId={voiceId} onVoice={onVoice} running={busy} narration={settings.audioMode === "narration" || settings.audioMode === "replace"} settings={<><label className="composer-setting-field">画幅<select aria-label="视频画幅" value={aspectAuto ? "auto" : aspectRatio} onChange={event => { setAspectAuto(event.target.value === "auto"); if (event.target.value !== "auto") setAspectRatio(event.target.value as typeof aspectRatio); }}><option value="auto">自动选择</option><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select></label><CreationSettings includeLibrary={false} value={settings} onChange={setSettings} selectedIds={libraryIds} onSelect={setLibraryIds} roles={assetRoles} onRole={(id, role) => setAssetRoles(current => ({ ...current, [id]: role }))}/></>}/><select className="home-aspect-select" aria-label="首页视频画幅" value={aspectAuto ? "auto" : aspectRatio} onChange={event => { setAspectAuto(event.target.value === "auto"); if (event.target.value !== "auto") setAspectRatio(event.target.value as typeof aspectRatio); }}><option value="auto">自动画幅</option><option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option></select><ModelSelector models={models} value={selection} onChange={onSelection}/></div><button className="send-button" disabled={(!prompt.trim() && !files.length && !libraryIds.length && !acceptedCreation) || busy || fileDraftStatus === "loading"} aria-label={acceptedCreation ? "继续打开任务" : "生成方案"}><span>{acceptedCreation ? "继续打开任务" : "生成方案"}</span><ArrowRight weight="bold"/></button></div>
          </ComposerForm>
          {fileDraftStatus === "error" ? <p className="form-error" role="status">附件无法保存在此浏览器，刷新后需重新添加。</p> : files.length ? <p className="draft-save-status">{fileDraftStatus === "saved" ? "附件已保存" : "正在保存附件…"}</p> : null}

          {acceptedCreation ? <p className="draft-save-status" role="status">任务已提交，继续打开可恢复制作进度。</p> : null}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </section> : null}

        {projectsPage ? <section className="home-projects">
          <header><div className="home-project-heading"><StudioArtwork variant="projects"/><h1>我的作品</h1><span aria-live="polite">{loading ? "正在读取…" : `${visibleProjects.length} 个项目`}</span></div><label className="home-project-search"><MagnifyingGlass/><input type="search" aria-label="搜索项目" placeholder="搜索项目名称" value={search} onChange={event => setSearch(event.target.value)}/>{search ? <button type="button" aria-label="清除搜索" onClick={() => setSearch("")}><X/></button> : null}</label></header>
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
            {!loading && !visibleProjects.length ? <div className="home-project-empty"><StudioArtwork variant="projects"/><b>{projects.length ? "没有符合条件的项目" : "还没有视频项目"}</b><span>{projects.length ? "试试其他关键词，或切换项目状态。" : "新建视频，开始你的第一个作品。"}</span>{projects.length ? <button className="home-reset-filters" onClick={() => { setSearch(""); setFilter("all"); }}>查看全部项目</button> : null}</div> : null}
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </section> : null}
      </div>
    </main>
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
