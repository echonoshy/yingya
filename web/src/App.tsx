import { SelectionIndicator } from "./components/SelectionIndicator";
import { useMotionPresence } from "./hooks/useMotionPresence";
import { ArrowRight, ArrowUp, CheckCircle, CircleNotch, CloudSlash, DotsThree, FilmSlate, Images, MagnifyingGlass, Paperclip, Plus, Trash, WifiHigh, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useDraftFiles } from "./hooks/useDraftFiles";
import { CreationSettings, creationBrief, creationSettingsSchema, defaultCreationSettings } from "./components/CreationSettings";
import { z } from "zod";
import { useSavedState } from "./hooks/useSavedState";
import { useAppRoute } from "./hooks/useAppRoute";
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
import { createClientRequestId } from "./requestId";
import { includeAstra } from "./models";

const fallbackModels: CodexModel[] = includeAstra([
  ["gpt-5.6-terra", "GPT-5.6 Terra", "均衡的质量与速度"], ["gpt-5.6-sol", "GPT-5.6 Sol", "复杂创作与高质量推理"], ["gpt-5.6-luna", "GPT-5.6 Luna", "快速迭代"],
].map(([model, displayName, description], index) => ({ id: model, model, displayName, description, hidden: false, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map(reasoningEffort => ({ reasoningEffort, description: "" })), defaultReasoningEffort: "medium", isDefault: index === 0 })));

function savedSelection(): ModelSelection {
  return readModelSelection({ model: "gpt-5.6-terra", reasoningEffort: "high" });
}

export function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]); const [active, setActive] = useState<ProjectDetail | null>(null); const [loading, setLoading] = useState(true); const [offline, setOffline] = useState(false); const [openError, setOpenError] = useState(""); const [models, setModels] = useState(fallbackModels); const [selection, setSelection] = useState(savedSelection); const [voiceId, setVoiceId] = useState(() => readStringSetting("yingya-voice-id", "default"));
  const [route, navigate] = useAppRoute();
  const [opening, setOpening] = useState(Boolean(route.projectId));
  const saveSelection = (next: ModelSelection) => { setSelection(next); writeModelSelection(next); };
  const saveVoice = (next: string) => { setVoiceId(next); writeStringSetting("yingya-voice-id", next); };
  const refreshProjects = useCallback(async () => { try { setProjects(await api.listProjects()); setOffline(false); } catch { setOffline(true); } finally { setLoading(false); } }, []);
  const updateActiveProject = useCallback((detail: ProjectDetail) => { setActive(detail); setProjects(current => current.map(project => project.id === detail.id ? projectSummary(detail) : project)); }, []);
  useEffect(() => { void refreshProjects(); void api.listModels().then(value => value.data.length && setModels(includeAstra(value.data))).catch(() => undefined); }, [refreshProjects]);
  const open = (id: string) => navigate({ section: "create", projectId: id });
  useEffect(() => {
    let cancelled = false;
    if (!route.projectId) { setActive(null); setOpening(false); setOpenError(""); return; }
    setOpening(true); setOpenError("");
    void api.getProject(route.projectId).then(detail => {
      if (cancelled) return;
      setActive(detail); setSelection({ model: detail.model, reasoningEffort: detail.reasoningEffort }); setVoiceId(detail.voiceId); setOffline(false);
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
    : route.section === "assets" ? <AssetStudio projects={projects} models={models} selection={selection} voiceId={voiceId} onSelection={saveSelection} onVoice={saveVoice} onCreate={showCreate} onOpen={open}/>
    : <StartScreen openingProjectId={opening ? route.projectId : undefined} projects={projects} loading={loading} openError={openError} models={models} selection={selection} onSelection={saveSelection} voiceId={voiceId} onVoice={saveVoice} onOpen={open} onDelete={deleteProject} onAssets={showAssets} onCreated={project => { setActive(project); navigate({ section: "create", projectId: project.id }); void refreshProjects(); }}/>;
  return <>{surface}<TaskCenter projects={projects} offline={offline} onOpen={open}/></>;

}

function StartScreen({ openingProjectId, projects, loading, openError, models, selection, onSelection, voiceId, onVoice, onOpen, onDelete, onAssets, onCreated }: { openingProjectId?: string; projects: ProjectRecord[]; loading: boolean; openError: string; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; voiceId: string; onVoice: (voiceId: string) => void; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void>; onAssets: () => void; onCreated: (value: ProjectDetail) => void }) {
  const [prompt, setPrompt, promptSaved] = useSavedState("yingya-home-prompt", z.string(), ""); const [aspectRatio, setAspectRatio] = useSavedState("yingya-home-aspect", z.enum(["9:16", "16:9", "1:1"]), "9:16"); const [files, setFiles, fileDraftStatus] = useDraftFiles("home");
  const [settings, setSettings] = useSavedState("yingya-creation-settings", creationSettingsSchema, defaultCreationSettings);
  const [libraryIds, setLibraryIds] = useSavedState("yingya-home-library", z.array(z.string()), []); const [busy, setBusy] = useState(false); const [creationStage, setCreationStage] = useState<ProjectCreationStage>("creating"); const [error, setError] = useState(""); const fileRef = useRef<HTMLInputElement>(null);
  const creationAttemptRef = useRef<{ signature: string; creationRequestId: string; turnRequestId: string; uploadedPaths: Map<string, string> } | null>(null);
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
    event.preventDefault(); if (!prompt.trim() || busy || fileDraftStatus === "loading") return;
    const brief = creationBrief(settings);
    const normalizedPrompt = [prompt.trim(), brief ? `创作要求：${brief}` : ""].filter(Boolean).join("\n\n");
    const fileKeys = files.map((file, index) => `${index}:${file.name}:${file.size}:${file.lastModified}:${file.type}`);
    const signature = JSON.stringify({ prompt: normalizedPrompt, aspectRatio, voiceId, selection, fileKeys, libraryIds });
    let attempt = creationAttemptRef.current;
    if (!attempt || attempt.signature !== signature) {
      attempt = { signature, creationRequestId: createClientRequestId(), turnRequestId: createClientRequestId(), uploadedPaths: new Map() };
      creationAttemptRef.current = attempt;
    }
    setCreationStage("creating"); setBusy(true); setError("");
    try {
      const project = await api.createProject({ prompt: normalizedPrompt, clientRequestId: attempt.creationRequestId, aspectRatio, voiceId, ...selection });
      setCreationStage("uploading");
      const uploadedPaths = await Promise.all(files.map(async (file, index) => {
        const key = fileKeys[index];
        const cached = attempt.uploadedPaths.get(key);
        if (cached) return cached;
        const uploaded = await api.uploadAsset(project.id, file);
        attempt.uploadedPaths.set(key, uploaded.path);
        return uploaded.path;
      }));
      const libraryPaths = await Promise.all(libraryIds.map(id => api.importLibraryAsset(id, project.id).then(asset => asset.path)));
      uploadedPaths.push(...libraryPaths);
      setCreationStage("starting");
      await api.sendTurn(project.id, { text: normalizedPrompt, clientRequestId: attempt.turnRequestId, attachments: uploadedPaths, ...selection });
      setCreationStage("opening");
      const detail = await api.getProject(project.id);
      creationAttemptRef.current = null;
      setPrompt(""); setFiles([]); setLibraryIds([]);
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
    if (!window.confirm(`确定删除“${project.title}”吗？\n项目文件和生成内容将被永久删除。`)) return;
    try { await onDelete(project); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "项目删除失败，请重试"); }
  }
  if (busy) return <ProjectCreationPendingView prompt={prompt.trim()} fileCount={files.length} stage={creationStage}/>;
  return <div className="home-layout">
    <aside className="home-nav">
      <div className="home-brand"><img src="/brand/invideo-favicon-black.ico" alt=""/><b>映芽</b></div>
      <button className="home-new-button" onClick={startCreating}><Plus weight="bold"/>新建视频</button>
      <nav aria-label="映芽功能">
        <button className="active" aria-current="page" onClick={startCreating}><FilmSlate/>视频创作</button>
        <button onClick={onAssets}><Images/>素材工坊</button>
      </nav>
      <div className="home-service" title="本地服务已连接"><span/><WifiHigh/><span>本地服务已连接</span></div>
    </aside>
    <main className="home-main">
      <div className="home-scroll">
        <header className="home-header">
          <div><h1>让想法，长成影像。</h1><p>从一句描述开始，在这里完成你的视频创作。</p></div>
        </header>
        {openError ? <div className="open-project-error" role="alert">{openError}</div> : null}
        <section className="home-create">
          <h2 id="create-prompt-label">今天想创作什么？</h2>{prompt ? <p className="draft-save-status" role="status">{promptSaved ? "描述已自动保存到此浏览器" : "草稿保存失败，请勿关闭页面"}</p> : null}
          <form className="composer composer--hero" onSubmit={submit}>
          <textarea aria-labelledby="create-prompt-label" ref={promptRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="描述视频主题、风格、时长，或直接粘贴网页链接…"/>
          <div className="attachment-row">{files.map(file => <span key={file.name}>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div>
          <div className="composer-tools"><div><button className="icon-button" type="button" onClick={() => fileRef.current?.click()} aria-label="添加附件" title="添加图片、视频或参考文件"><Paperclip/></button><input ref={fileRef} hidden multiple type="file" onChange={event => setFiles(Array.from(event.target.files ?? []))}/><select aria-label="视频画幅" value={aspectRatio} onChange={event => setAspectRatio(event.target.value as typeof aspectRatio)}><option value="9:16">9:16 竖屏</option><option value="16:9">16:9 横屏</option><option value="1:1">1:1 方形</option></select><VoiceSelector value={voiceId} onChange={onVoice}/><ModelSelector models={models} value={selection} onChange={onSelection}/></div><button className="send-button" disabled={!prompt.trim() || busy || fileDraftStatus === "loading"} aria-label="创建视频任务" title="创建视频任务"><span>开始创作</span><ArrowUp weight="bold"/></button></div>
          </form>
          {fileDraftStatus === "error" ? <p className="form-error" role="status">附件无法保存在此浏览器，刷新后需重新添加。</p> : files.length ? <p className="draft-save-status">{fileDraftStatus === "saved" ? "附件已保存" : "正在保存附件…"}</p> : null}
          <CreationSettings value={settings} onChange={setSettings} selectedIds={libraryIds} onSelect={setLibraryIds}/>
          <div className="home-starters" aria-label="创作灵感"><span>试试这些方向</span>{starterIdeas.map(idea => <button key={idea.label} type="button" onClick={() => { setPrompt(idea.prompt); startCreating(); }}>{idea.label}<ArrowRight/></button>)}</div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </section>
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
                <span className="home-project-copy"><b title={project.title}>{project.title}</b><small className={`home-status home-status--${projectGroup(project)}`}><i/>{openingProjectId === project.id ? "正在打开…" : projectStatus(project)}</small></span>
                <time dateTime={new Date(project.updatedAt).toISOString()}>{formatHomeTime(project.updatedAt)}</time>
                <span className="home-project-ratio">{project.aspectRatio}</span>
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
  </div>;
}

const starterIdeas = [
  { label: "产品宣传", prompt: "制作一条 30 秒的产品宣传视频，面向首次了解产品的用户。突出核心功能、使用场景和产品价值，风格简洁明亮。" },
  { label: "知识讲解", prompt: "制作一条 60 秒的知识讲解视频，用通俗的语言和直观的动画解释一个知识点，包含开场问题、原理演示和总结。" },
  { label: "网页转视频", prompt: "把这个网页制作成一条 30 秒的视频，提炼关键内容，保留页面的品牌风格。网页链接：" },
];

type ProjectFilter = "all" | "active" | "review" | "completed" | "failed";

const projectFilters: { id: ProjectFilter; label: string }[] = [
  { id: "all", label: "全部" }, { id: "active", label: "制作中" }, { id: "review", label: "待确认" }, { id: "completed", label: "已完成" }, { id: "failed", label: "待恢复" },
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
