import { ArrowRight, ArrowUp, CloudSlash, Paperclip, WifiHigh } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { api } from "./api";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { ModelSelector } from "./components/ModelSelector";
import { ProjectSidebar } from "./components/ProjectSidebar";
import type { CodexModel, ModelSelection, ProjectDetail, ProjectRecord } from "./types";
import { readModelSelection, writeModelSelection } from "./storage";

const fallbackModels: CodexModel[] = [
  ["gpt-5.6-terra", "GPT-5.6 Terra", "均衡的质量与速度"], ["gpt-5.6-sol", "GPT-5.6 Sol", "复杂创作与高质量推理"], ["gpt-5.6-luna", "GPT-5.6 Luna", "快速迭代"],
].map(([model, displayName, description], index) => ({ id: model, model, displayName, description, hidden: false, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"].map(reasoningEffort => ({ reasoningEffort, description: "" })), defaultReasoningEffort: "medium", isDefault: index === 0 }));

function savedSelection(): ModelSelection {
  return readModelSelection({ model: "gpt-5.6-terra", reasoningEffort: "high" });
}

const startIntroKey = "yingya-start-intro-seen";
const startCopyKey = "yingya-start-copy";
const startCopies = [
  { kicker: "素材集合处", title: ["素材请就座，", "创作会马上开始。"], description: "主题、链接和文件都能入席。内容结构与视觉方向确认后，制作流程正式开场。" },
  { kicker: "非正式片场", title: ["把跑偏留给花絮。"], description: "提供主题或参考素材，先校准内容与风格。生成、配音和剪辑会沿着确认过的方向进行。" },
  { kicker: "时间线 · 00:00", title: ["空白时间线，", "欢迎来稿。"], description: "一个主题、一张图或一段网页都可以成为开头。创作方案确认后，画面开始向前走。" },
  { kicker: "链接试镜处", title: ["这条链接，", "想上镜。"], description: "把网页贴进来，重点内容会被整理成可拍的结构。看过方案，再决定它如何出场。" },
  { kicker: "灵感候场区", title: ["先给灵感排个队。"], description: "零散念头和素材会被整理成清晰顺序。确认叙事与视觉方向后，各环节依次开工。" },
];

function randomStartCopy() {
  let previous = -1;
  try { previous = Number(sessionStorage.getItem(startCopyKey) ?? -1); } catch { /* Storage may be unavailable. */ }
  const candidates = startCopies.map((_, index) => index).filter(index => index !== previous);
  const index = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
  return { index, copy: startCopies[index] };
}

function AnimatedHeadline({ lines, play }: { lines: string[]; play: boolean }) {
  let characterIndex = 0;
  return <h1 className={play ? "hero-title hero-title--animated" : "hero-title"} aria-label={lines.join("")}>
    {lines.map(line => <span className="hero-title-line" key={line}>
      <span className="hero-title-ghost" aria-hidden="true">{line}</span>
      <span className="hero-title-ink" aria-hidden="true">
        {Array.from(line).map(character => {
          const index = characterIndex++;
          return <span className="hero-title-character" style={{ "--character-index": index } as CSSProperties} key={`${index}-${character}`}>{character}</span>;
        })}
      </span>
    </span>)}
  </h1>;
}

export function App() {
  const [projects, setProjects] = useState<ProjectRecord[]>([]); const [active, setActive] = useState<ProjectDetail | null>(null); const [loading, setLoading] = useState(true); const [offline, setOffline] = useState(false); const [openError, setOpenError] = useState(""); const [models, setModels] = useState(fallbackModels); const [selection, setSelection] = useState(savedSelection);
  const saveSelection = (next: ModelSelection) => { setSelection(next); writeModelSelection(next); };
  const refreshProjects = useCallback(async () => { try { setProjects(await api.listProjects()); setOffline(false); } catch { setOffline(true); } finally { setLoading(false); } }, []);
  useEffect(() => { void refreshProjects(); void api.listModels().then(value => value.data.length && setModels(value.data)).catch(() => undefined); }, [refreshProjects]);
  async function open(id: string) { setLoading(true); setOpenError(""); try { const detail = await api.getProject(id); setActive(detail); saveSelection({ model: detail.model, reasoningEffort: detail.reasoningEffort }); setOffline(false); } catch (reason) { setOpenError(reason instanceof Error ? reason.message : "项目加载失败"); } finally { setLoading(false); } }
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
  if (offline && !active) return <div className="state-screen"><CloudSlash/><h1>本地服务未连接</h1><p>项目仍保存在电脑上。服务恢复后可继续。</p><button className="primary-button" onClick={() => void refreshProjects()}>重新连接</button></div>;
  if (active) return <AgentWorkspace key={active.id} project={active} projects={projects} models={models} selection={selection} onSelection={saveSelection} onProject={setActive} onOpen={open} onRename={renameProject} onDelete={deleteProject} onNew={() => { setActive(null); void refreshProjects(); }}/>;
  return <StartScreen projects={projects} loading={loading} openError={openError} models={models} selection={selection} onSelection={saveSelection} onOpen={open} onDelete={deleteProject} onCreated={project => { setActive(project); void refreshProjects(); }}/>;
}

function StartScreen({ projects, loading, openError, models, selection, onSelection, onOpen, onDelete, onCreated }: { projects: ProjectRecord[]; loading: boolean; openError: string; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void>; onCreated: (value: ProjectDetail) => void }) {
  const [prompt, setPrompt] = useState(""); const [aspectRatio, setAspectRatio] = useState("9:16"); const [files, setFiles] = useState<File[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const fileRef = useRef<HTMLInputElement>(null);
  const [{ index: copyIndex, copy }] = useState(randomStartCopy);
  const [playIntro] = useState(() => {
    try { return sessionStorage.getItem(startIntroKey) !== "true"; }
    catch { return true; }
  });
  useEffect(() => {
    if (!playIntro) return;
    try { sessionStorage.setItem(startIntroKey, "true"); } catch { /* Storage may be unavailable. */ }
  }, [playIntro]);
  useEffect(() => {
    try { sessionStorage.setItem(startCopyKey, String(copyIndex)); } catch { /* Storage may be unavailable. */ }
  }, [copyIndex]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!prompt.trim() || busy) return; setBusy(true); setError("");
    try { const project = await api.createProject({ prompt: prompt.trim(), aspectRatio, ...selection }); const uploaded: string[] = []; for (const file of files) uploaded.push((await api.uploadAsset(project.id, file)).path); await api.sendTurn(project.id, { text: prompt.trim(), attachments: uploaded, ...selection }); onCreated(await api.getProject(project.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法创建视频任务"); } finally { setBusy(false); }
  }
  const starters = ["网站转产品宣传片", "知识解释动画", "品牌发布短片"];
  return <div className="start-layout">
    <ProjectSidebar projects={projects} loading={loading} onOpen={onOpen} onDelete={onDelete}/>
    <main className="start-main">
      <header className="topbar"><span>VIDEO CREATION</span><div className="topbar-status"><WifiHigh/>本地服务已连接</div></header>
      {openError ? <div className="open-project-error" role="alert">{openError}</div> : null}
      <section className={`hero ${playIntro ? "hero--intro" : ""}`}>
        <div className="hero-ambient" aria-hidden="true">
          <i className="hero-orb hero-orb--one"/>
          <i className="hero-orb hero-orb--two"/>
          <span className="agent-chip agent-chip--story"><b>01</b> 分镜 Agent</span>
          <span className="agent-chip agent-chip--voice"><b>02</b> 配音 Agent</span>
          <span className="agent-chip agent-chip--edit"><b>03</b> 剪辑 Agent</span>
        </div>
        <div className="hero-kicker">{copy.kicker}</div>
        <AnimatedHeadline lines={copy.title} play={playIntro}/>
        <p>{copy.description}</p>
        <form className="composer composer--hero" onSubmit={submit}>
          <textarea autoFocus value={prompt} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="描述视频主题、风格、时长，或直接粘贴网页链接…"/>
          <div className="attachment-row">{files.map(file => <span key={file.name}>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div>
          <div className="composer-tools"><div><button className="icon-button" type="button" onClick={() => fileRef.current?.click()} aria-label="添加附件"><Paperclip/></button><input ref={fileRef} hidden multiple type="file" onChange={event => setFiles(Array.from(event.target.files ?? []))}/><select aria-label="视频画幅" value={aspectRatio} onChange={event => setAspectRatio(event.target.value)}><option>9:16</option><option>16:9</option><option>1:1</option></select><ModelSelector models={models} value={selection} onChange={onSelection}/></div><button className="send-button" disabled={!prompt.trim() || busy} aria-label="创建视频任务"><ArrowUp weight="bold"/></button></div>
        </form>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="starter-prompts">{starters.map(value => <button key={value} onClick={() => setPrompt(value)}><span>{value}</span><ArrowRight/></button>)}</div>
      </section>
    </main>
  </div>;
}
