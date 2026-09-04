import { ArrowRight, ArrowUp, CheckCircle, CloudSlash, DotsThree, FilmSlate, Images, Paperclip, Plus, Trash, WifiHigh } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { AssetStudio } from "./components/AssetStudio";
import { ModelSelector } from "./components/ModelSelector";
import { VoiceSelector } from "./components/VoiceSelector";
import type { CodexModel, ModelSelection, ProjectDetail, ProjectRecord } from "./types";
import { readModelSelection, readStringSetting, writeModelSelection, writeStringSetting } from "./storage";

const fallbackModels: CodexModel[] = [
  ["gpt-5.6-terra", "GPT-5.6 Terra", "均衡的质量与速度"], ["gpt-5.6-sol", "GPT-5.6 Sol", "复杂创作与高质量推理"], ["gpt-5.6-luna", "GPT-5.6 Luna", "快速迭代"],
].map(([model, displayName, description], index) => ({ id: model, model, displayName, description, hidden: false, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map(reasoningEffort => ({ reasoningEffort, description: "" })), defaultReasoningEffort: "medium", isDefault: index === 0 }));

function savedSelection(): ModelSelection {
  return readModelSelection({ model: "gpt-5.6-terra", reasoningEffort: "high" });
}

export function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]); const [active, setActive] = useState<ProjectDetail | null>(null); const [loading, setLoading] = useState(true); const [offline, setOffline] = useState(false); const [openError, setOpenError] = useState(""); const [models, setModels] = useState(fallbackModels); const [selection, setSelection] = useState(savedSelection); const [voiceId, setVoiceId] = useState(() => readStringSetting("yingya-voice-id", "default"));
  const [section, setSection] = useState<"create" | "assets">("create");
  const saveSelection = (next: ModelSelection) => { setSelection(next); writeModelSelection(next); };
  const saveVoice = (next: string) => { setVoiceId(next); writeStringSetting("yingya-voice-id", next); };
  const refreshProjects = useCallback(async () => { try { setProjects(await api.listProjects()); setOffline(false); } catch { setOffline(true); } finally { setLoading(false); } }, []);
  const updateActiveProject = useCallback((detail: ProjectDetail) => { setActive(detail); setProjects(current => current.map(project => project.id === detail.id ? detail : project)); }, []);
  useEffect(() => { void refreshProjects(); void api.listModels().then(value => value.data.length && setModels(value.data)).catch(() => undefined); }, [refreshProjects]);
  async function open(id: string) { setLoading(true); setOpenError(""); try { const detail = await api.getProject(id); setSection("create"); setActive(detail); saveSelection({ model: detail.model, reasoningEffort: detail.reasoningEffort }); saveVoice(detail.voiceId); setOffline(false); } catch (reason) { setOpenError(reason instanceof Error ? reason.message : "项目加载失败"); } finally { setLoading(false); } }
  async function deleteProject(project: ProjectRecord) {
    await api.deleteProject(project.id);
    setProjects(current => current.filter(item => item.id !== project.id));
    setActive(current => current?.id === project.id ? null : current);
  }
  async function renameProject(id: string, title: string) {
    const updated = await api.renameProject(id, title);
    setProjects(current => current.map(project => project.id === id ? updated : project));
    setActive(current => current?.id === id ? { ...current, ...updated } : current);
  }
  async function setProjectVoice(id: string, nextVoiceId: string) {
    const updated = await api.setProjectVoice(id, nextVoiceId);
    saveVoice(updated.voiceId);
    setProjects(current => current.map(project => project.id === id ? updated : project));
    setActive(current => current?.id === id ? { ...current, ...updated } : current);
  }
  if (offline && !active) return <div className="state-screen"><CloudSlash/><h1>本地服务未连接</h1><p>项目仍保存在电脑上。服务恢复后可继续。</p><button className="primary-button" onClick={() => void refreshProjects()}>重新连接</button></div>;
  const showCreate = () => { setSection("create"); setActive(null); void refreshProjects(); };
  const showAssets = () => { setSection("assets"); setActive(null); };
  if (active) return <AgentWorkspace key={active.id} project={active} models={models} selection={selection} onSelection={saveSelection} onVoice={voice => setProjectVoice(active.id, voice)} onProject={updateActiveProject} onRename={renameProject} onBack={showCreate}/>;
  if (section === "assets") return <AssetStudio projects={projects} models={models} selection={selection} voiceId={voiceId} onSelection={saveSelection} onVoice={saveVoice} onCreate={showCreate} onOpen={open}/>;
  return <StartScreen projects={projects} loading={loading} openError={openError} models={models} selection={selection} onSelection={saveSelection} voiceId={voiceId} onVoice={saveVoice} onOpen={open} onDelete={deleteProject} onAssets={showAssets} onCreated={project => { setActive(project); void refreshProjects(); }}/>;
}

function StartScreen({ projects, loading, openError, models, selection, onSelection, voiceId, onVoice, onOpen, onDelete, onAssets, onCreated }: { projects: ProjectRecord[]; loading: boolean; openError: string; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; voiceId: string; onVoice: (voiceId: string) => void; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void>; onAssets: () => void; onCreated: (value: ProjectDetail) => void }) {
  const [prompt, setPrompt] = useState(""); const [aspectRatio, setAspectRatio] = useState("9:16"); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [openMenu, setOpenMenu] = useState("");
  const [covers, setCovers] = useState<Record<string, string>>({});
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const visibleProjects = projects.filter(project => filter === "all" || projectGroup(project) === filter);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(projects.slice(0, 12).map(async project => {
      try {
        const media = await api.getProjectMedia(project.id);
        const image = media.assets.find(asset => asset.mediaType?.startsWith("image/") || asset.kind === "image");
        return image ? [project.id, image.url] as const : undefined;
      } catch { return undefined; }
    })).then(entries => {
      if (!cancelled) setCovers(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    });
    return () => { cancelled = true; };
  }, [projects]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!prompt.trim() || busy) return; setBusy(true); setError("");
    try { const project = await api.createProject({ prompt: prompt.trim(), aspectRatio, voiceId, ...selection }); const uploaded: string[] = []; for (const file of files) uploaded.push((await api.uploadAsset(project.id, file)).path); await api.sendTurn(project.id, { text: prompt.trim(), attachments: uploaded, ...selection }); onCreated(await api.getProject(project.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法创建视频任务"); } finally { setBusy(false); }
  }
  function startCreating() {
    promptRef.current?.focus();
    promptRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function removeProject(project: ProjectRecord) {
    setOpenMenu("");
    if (!window.confirm(`确定删除“${project.title}”吗？\n项目文件和生成内容将被永久删除。`)) return;
    await onDelete(project);
  }
  return <div className="home-layout">
    <aside className="home-nav">
      <div className="home-brand"><img src="/brand/invideo-favicon-black.ico" alt=""/><b>映芽</b></div>
      <nav aria-label="映芽功能">
        <button className="active"><FilmSlate/>视频创作</button>
        <button onClick={onAssets}><Images/>素材工坊</button>
      </nav>
      <div className="home-service"><span/><WifiHigh/><span>本地服务已连接</span></div>
    </aside>
    <main className="home-main">
      <div className="home-scroll">
        <header className="home-header">
          <div><h1>视频项目</h1><p>把想法变成可继续创作的视频项目</p></div>
          <button className="home-new-button" onClick={startCreating}><Plus weight="bold"/>新建视频</button>
        </header>
        {openError ? <div className="open-project-error" role="alert">{openError}</div> : null}
        <section className="home-create">
          <h2>今天想创作什么？</h2>
          <form className="composer composer--hero" onSubmit={submit}>
          <textarea ref={promptRef} value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="描述视频主题、风格、时长，或直接粘贴网页链接…"/>
          <div className="attachment-row">{files.map(file => <span key={file.name}>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div>
          <div className="composer-tools"><div><button className="icon-button" type="button" onClick={() => fileRef.current?.click()} aria-label="添加附件"><Paperclip/></button><input ref={fileRef} hidden multiple type="file" onChange={event => setFiles(Array.from(event.target.files ?? []))}/><select aria-label="视频画幅" value={aspectRatio} onChange={event => setAspectRatio(event.target.value)}><option>9:16</option><option>16:9</option><option>1:1</option></select><VoiceSelector value={voiceId} onChange={onVoice}/><ModelSelector models={models} value={selection} onChange={onSelection}/></div><button className="send-button" disabled={!prompt.trim() || busy} aria-label="创建视频任务"><ArrowUp weight="bold"/></button></div>
          </form>
          {error ? <p className="form-error">{error}</p> : null}
        </section>
        <section className="home-projects">
          <header><h2>最近项目</h2><div className="project-filters" role="tablist" aria-label="筛选项目">{projectFilters.map(item => <button key={item.id} role="tab" aria-selected={filter === item.id} className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div></header>
          <div className="home-project-list">
            {visibleProjects.map(project => <article key={project.id}>
              <button className="home-project-open" onClick={() => onOpen(project.id)}>
                <span className="home-project-cover">{covers[project.id] ? <img src={covers[project.id]} alt=""/> : <FilmSlate/>}</span>
                <span className="home-project-copy"><b>{project.title}</b><small className={`home-status home-status--${projectGroup(project)}`}><i/>{project.statusLabel}</small></span>
                <time>{formatHomeTime(project.updatedAt)}</time>
                <span className="home-project-ratio">{project.aspectRatio}</span>
                <ArrowRight className="home-project-arrow"/>
              </button>
              <button className="home-project-menu-button" aria-label={`项目操作 ${project.title}`} aria-expanded={openMenu === project.id} onClick={() => setOpenMenu(current => current === project.id ? "" : project.id)}><DotsThree weight="bold"/></button>
              {openMenu === project.id ? <div className="home-project-menu"><button onClick={() => onOpen(project.id)}><ArrowRight/>打开项目</button><button disabled={Boolean(project.activeTurnId)} onClick={() => void removeProject(project)}><Trash/>删除项目</button></div> : null}
            </article>)}
            {loading ? <div className="home-project-message">正在读取项目…</div> : null}
            {!loading && !visibleProjects.length ? <div className="home-project-empty"><CheckCircle/><b>{projects.length ? "没有符合条件的项目" : "还没有视频项目"}</b><span>{projects.length ? "切换筛选条件查看其他项目。" : "从上方描述你的第一个视频想法。"}</span></div> : null}
          </div>
        </section>
      </div>
    </main>
  </div>;
}

type ProjectFilter = "all" | "active" | "review" | "completed";

const projectFilters: { id: ProjectFilter; label: string }[] = [
  { id: "all", label: "全部" }, { id: "active", label: "制作中" }, { id: "review", label: "待确认" }, { id: "completed", label: "已完成" },
];

function projectGroup(project: ProjectRecord): Exclude<ProjectFilter, "all"> {
  if (project.status === "completed" || project.statusLabel.includes("完成")) return "completed";
  if (project.activeTurnId || ["starting", "queued", "running"].includes(project.status)) return "active";
  return "review";
}

function formatHomeTime(timestamp: number) {
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return `${sameDay ? "今天" : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
