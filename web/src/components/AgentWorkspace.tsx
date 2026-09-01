import { ArrowClockwise, ArrowLeft, ArrowUp, CaretDown, Check, CheckCircle, CircleNotch, Code, Eye, File, FilmSlate, Paperclip, PencilSimple, Play, Queue, Stop, Terminal, Warning, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { Sidebar } from "../App";
import type { AgentEvent, Artifact, CodexModel, ModelSelection, ProjectDetail, ProjectRecord } from "../types";
import { buildTimeline, type TimelineActivity } from "./eventTimeline";
import { ModelSelector } from "./ModelSelector";

export function AgentWorkspace({ project, projects, models, selection, onSelection, onProject, onOpen, onRename, onDelete, onNew }: { project: ProjectDetail; projects: ProjectRecord[]; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; onProject: (value: ProjectDetail) => void; onOpen: (id: string) => void; onRename: (id: string, title: string) => Promise<void>; onDelete: (project: ProjectRecord) => Promise<void>; onNew: () => void }) {
  const [text, setText] = useState(""); const [files, setFiles] = useState<File[]>([]); const [contexts, setContexts] = useState<string[]>([]); const [interrupt, setInterrupt] = useState(false); const [busy, setBusy] = useState(false); const [stopping, setStopping] = useState(false); const [error, setError] = useState(""); const [studioUrl, setStudioUrl] = useState(""); const [mobilePanel, setMobilePanel] = useState<"thread" | "canvas">("thread"); const [canvasTab, setCanvasTab] = useState<"preview" | "artifacts">("preview"); const fileRef = useRef<HTMLInputElement>(null); const timelineRef = useRef<HTMLElement>(null); const latestSeq = useRef(project.events.at(-1)?.seq ?? 0); const projectRef = useRef(project);
  const [artifactPreview, setArtifactPreview] = useState<{ artifact: Artifact; content: string; loading: boolean; error: string } | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(true); const [sidebarWidth, setSidebarWidth] = useState(() => savedWidth("yingya-sidebar-width", 270)); const [canvasWidth, setCanvasWidth] = useState(() => savedWidth("yingya-canvas-width", 440));
  const [editingTitle, setEditingTitle] = useState(false); const [titleDraft, setTitleDraft] = useState(""); const [renaming, setRenaming] = useState(false); const [titleError, setTitleError] = useState("");
  const [dismissedCheckpoint, setDismissedCheckpoint] = useState("");
  const running = Boolean(project.activeTurnId);
  const refresh = useCallback(async () => { try { onProject(await api.getProject(project.id)); } catch { /* retain last stable project */ } }, [onProject, project.id]);
  const assistantTexts = useMemo(() => new Set(project.messages.filter(message => message.role === "assistant").map(message => message.text.trim())), [project.messages]);
  const activities = useMemo(() => buildTimeline(project.events, assistantTexts), [project.events, assistantTexts]);
  useEffect(() => { projectRef.current = project; latestSeq.current = project.events.at(-1)?.seq ?? 0; }, [project]);
  useEffect(() => {
    const source = new EventSource(`/api/agent-projects/${project.id}/events?after=${latestSeq.current}`);
    source.addEventListener("agent-event", event => { const item = JSON.parse((event as MessageEvent).data) as AgentEvent; latestSeq.current = Math.max(latestSeq.current, item.seq); const current = projectRef.current; if (!current.events.some(value => value.seq === item.seq)) { const next = { ...current, events: [...current.events, item] }; projectRef.current = next; onProject(next); } if (["turn/completed", "turn/failed", "item/completed"].some(value => item.method.includes(value))) void refresh(); });
    return () => source.close();
  }, [project.id, onProject, refresh]);
  useEffect(() => { if (!running && !project.queueDepth) return; const timer = window.setInterval(() => void refresh(), 2200); return () => window.clearInterval(timer); }, [running, project.queueDepth, refresh]);
  useEffect(() => { const timeline = timelineRef.current; if (timeline) timeline.scrollTop = timeline.scrollHeight; }, [project.messages.length, activities.length]);

  async function send(event: FormEvent) {
    event.preventDefault(); if (!text.trim() || busy) return; setBusy(true); setError("");
    try { const uploaded: string[] = []; for (const file of files) uploaded.push((await api.uploadAsset(project.id, file)).path); await api.sendTurn(project.id, { text: text.trim(), attachments: uploaded, context: contexts, interrupt, ...selection }); setText(""); setFiles([]); setContexts([]); setInterrupt(false); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "消息发送失败"); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError("");
    try {
      const checkpointId = project.manifest.checkpoint?.id;
      await api.confirmCheckpoint(project.id);
      if (checkpointId) setDismissedCheckpoint(checkpointId);
      setArtifactPreview(null);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "确认失败"); }
    finally { setBusy(false); }
  }
  async function openStudio() {
    setBusy(true); setError("");
    try {
      const result = await api.studio(project.id);
      const url = new URL(result.previewUrl, window.location.href);
      if (["0.0.0.0", "127.0.0.1", "localhost"].includes(url.hostname)) url.hostname = window.location.hostname;
      setStudioUrl(url.toString());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Studio 启动失败"); }
    finally { setBusy(false); }
  }
  async function stop() { setStopping(true); setError(""); try { await api.interrupt(project.id); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "停止失败"); } finally { setStopping(false); } }
  async function previewArtifact(artifact: Artifact) {
    setCanvasOpen(true); setMobilePanel("canvas");
    if (artifact.kind.includes("video")) { setArtifactPreview(null); setCanvasTab("preview"); return; }
    setArtifactPreview({ artifact, content: "", loading: true, error: "" });
    try {
      let content = await api.readProjectFile(project.id, artifact.path);
      if (artifact.path.endsWith(".json")) { try { content = JSON.stringify(JSON.parse(content), null, 2); } catch { /* show original text */ } }
      setArtifactPreview(current => current?.artifact.id === artifact.id ? { artifact, content, loading: false, error: "" } : current);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "产物预览失败";
      setArtifactPreview(current => current?.artifact.id === artifact.id ? { artifact, content: "", loading: false, error: message } : current);
    }
  }
  async function saveTitle(event: FormEvent) {
    event.preventDefault(); const title = titleDraft.trim(); if (!title || renaming) return;
    if (title === project.title) { setEditingTitle(false); return; }
    setRenaming(true); setTitleError("");
    try { await onRename(project.id, title); setEditingTitle(false); }
    catch (reason) { setTitleError(reason instanceof Error ? reason.message : "标题修改失败"); }
    finally { setRenaming(false); }
  }

  const selectedVersion = project.manifest.versions.find(value => value.id === project.manifest.currentDraft) ?? project.manifest.versions.at(-1);
  const hasCanvas = Boolean(selectedVersion || project.manifest.artifacts.length || project.manifest.checkpoint);
  const showCanvas = hasCanvas && canvasOpen;
  const visibleCheckpoint = project.manifest.checkpoint?.kind === "plan" && project.manifest.checkpoint.id !== dismissedCheckpoint ? project.manifest.checkpoint : undefined;
  const checkpointArtifact = visibleCheckpoint?.artifactIds.map(id => project.manifest.artifacts.find(artifact => artifact.id === id)).find(Boolean);
  const workspaceStyle = { "--sidebar-width": `${sidebarWidth}px`, "--canvas-width": `${canvasWidth}px` } as CSSProperties;
  function dragSidebar(event: ReactPointerEvent<HTMLDivElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(Math.min(360, Math.max(190, event.clientX))); }
  function dragCanvas(event: ReactPointerEvent<HTMLDivElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) setCanvasWidth(Math.min(720, Math.max(320, window.innerWidth - event.clientX))); }
  function finishResize(event: ReactPointerEvent<HTMLDivElement>, key: string, value: number) { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); localStorage.setItem(key, String(value)); }
  return <div className={`workspace ${showCanvas ? "workspace--canvas" : ""} workspace-mobile--${mobilePanel}`} style={workspaceStyle}>
    <Sidebar projects={projects} activeId={project.id} onOpen={onOpen} onDelete={onDelete} onNew={onNew}/>
    <div className="workspace-splitter workspace-splitter--sidebar" role="separator" aria-label="调整项目栏宽度" aria-orientation="vertical" onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={dragSidebar} onPointerUp={event => finishResize(event, "yingya-sidebar-width", sidebarWidth)}/>
    {showCanvas ? <div className="workspace-splitter workspace-splitter--canvas" role="separator" aria-label="调整产物栏宽度" aria-orientation="vertical" onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={dragCanvas} onPointerUp={event => finishResize(event, "yingya-canvas-width", canvasWidth)}/> : null}
    {showCanvas ? <nav className="workspace-tabs" aria-label="工作区视图"><button className={mobilePanel === "thread" ? "active" : ""} onClick={() => setMobilePanel("thread")}>对话</button><button className={mobilePanel === "canvas" && canvasTab === "artifacts" ? "active" : ""} onClick={() => { setMobilePanel("canvas"); setCanvasTab("artifacts"); }}>产物</button><button className={mobilePanel === "canvas" && canvasTab === "preview" ? "active" : ""} onClick={() => { setMobilePanel("canvas"); setCanvasTab("preview"); }}>预览</button></nav> : null}
    <main className="thread">
      <header className="thread-header"><div className="thread-title"><span>VIDEO PROJECT</span>{editingTitle ? <form className="thread-title-editor" onSubmit={saveTitle}><input aria-label="项目标题" autoFocus maxLength={48} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setEditingTitle(false); setTitleError(""); } }}/><button aria-label="保存项目标题" disabled={!titleDraft.trim() || renaming}><Check/></button><button type="button" aria-label="取消修改标题" onClick={() => { setEditingTitle(false); setTitleError(""); }}><X/></button></form> : <button className="thread-title-button" aria-label={`修改项目标题：${project.title}`} title="修改项目标题" onClick={() => { setTitleDraft(project.title); setTitleError(""); setEditingTitle(true); }}><h1>{project.title}</h1><PencilSimple/></button>}{titleError ? <small className="thread-title-error">{titleError}</small> : null}</div><div className="thread-meta"><span className={`project-state project-state--${project.status}`}>{project.statusLabel}</span>{hasCanvas && !canvasOpen ? <button className="open-canvas-button" onClick={() => { setCanvasOpen(true); setMobilePanel("canvas"); }}><File/>项目产物</button> : null}<span className="spec-chip">{project.aspectRatio}</span></div></header>
      <section className="timeline" ref={timelineRef}><div className="timeline-inner">
        {project.messages.map(message => <article className={`message message--${message.role}`} key={message.id}><div className="message-body">{message.context.length ? <div className="context-line">{message.context.map(value => <span key={value}>{value}</span>)}</div> : null}<div>{message.text}</div>{message.attachments.length ? <small>{message.attachments.length} 个附件</small> : null}</div></article>)}
        <ActivityFeed activities={activities}/>
        {visibleCheckpoint ? <CheckpointCard title={visibleCheckpoint.title} summary={visibleCheckpoint.summary} busy={busy} onPreview={checkpointArtifact ? () => void previewArtifact(checkpointArtifact) : undefined} onConfirm={() => void confirm()}/> : null}
        {project.queue.length ? <section className="queue-card"><header><Queue/><b>待处理消息</b><span>{project.queue.length}</span></header>{project.queue.map((turn, index) => <div key={turn.id}><i>{String(index + 1).padStart(2, "0")}</i><span>{turn.text}</span><button aria-label="撤回排队消息" onClick={() => void api.removeQueued(project.id, turn.id).then(refresh)}><X/></button></div>)}</section> : null}
        {project.events.length ? <details className="debug-events"><summary><Code/>技术详情 <span>{project.events.length} 条事件</span></summary><pre>{project.events.map(event => JSON.stringify(event)).join("\n")}</pre></details> : null}
      </div></section>
      <footer className="thread-footer">{contexts.length ? <div className="context-chips">{contexts.map(value => <span key={value}>{value}<button aria-label={`移除 ${value}`} onClick={() => setContexts(items => items.filter(item => item !== value))}>×</button></span>)}</div> : null}<form className="composer" onSubmit={send}><textarea value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={running ? "继续输入，默认排到当前任务之后…" : "描述修改，或继续推进视频…"}/><div className="attachment-row">{files.map(file => <span key={file.name}>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div><div className="composer-tools"><div><button className="icon-button" type="button" onClick={() => fileRef.current?.click()} aria-label="添加附件"><Paperclip/></button><input ref={fileRef} hidden multiple type="file" onChange={event => setFiles(Array.from(event.target.files ?? []))}/><ModelSelector models={models} value={selection} onChange={onSelection}/>{running ? <label className="interrupt-toggle"><input type="checkbox" checked={interrupt} onChange={event => setInterrupt(event.target.checked)}/><span>{interrupt ? "立即应用" : "排队"}</span></label> : null}</div><div>{running ? <button className="stop-button" type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? <CircleNotch className="spin"/> : <Stop weight="fill"/>}{stopping ? "正在停止" : "停止"}</button> : null}<button className="send-button" aria-label="发送消息" disabled={!text.trim() || busy}><ArrowUp weight="bold"/></button></div></div></form>{error ? <p className="form-error">{error}</p> : null}</footer>
    </main>
    {showCanvas ? <ArtifactCanvas project={project} activeTab={canvasTab} preview={artifactPreview} onClosePreview={() => setArtifactPreview(null)} onClosePanel={() => { setCanvasOpen(false); setMobilePanel("thread"); }} onTab={setCanvasTab} onPreview={artifact => void previewArtifact(artifact)} onContext={value => setContexts(items => items.includes(value) ? items : [...items, value])} onStudio={() => void openStudio()}/> : null}
    {studioUrl ? <div className="studio-modal"><header><div><b>HyperFrames Studio</b><span>关闭后会把当前 Draft 标记为待检查</span></div><button aria-label="关闭 Studio" onClick={() => { setStudioUrl(""); void api.markStudioDirty(project.id).then(refresh); }}><X/></button></header><iframe title="HyperFrames Studio" src={studioUrl} allow="autoplay; fullscreen"/></div> : null}
  </div>;
}

function ActivityFeed({ activities }: { activities: TimelineActivity[] }) {
  const rows: ReactNode[] = [];
  let completed: TimelineActivity[] = [];
  const flushCompleted = () => {
    if (!completed.length) return;
    const batch = completed;
    completed = [];
    rows.push(<details className="activity-batch" key={`batch-${batch[0].id}`}>
      <summary><span className="activity-batch-icon"><Check/></span><b>后台操作已完成</b><span>{batch.length} 项</span><em>按需查看命令与输出</em><CaretDown className="activity-caret"/></summary>
      <div className="activity-batch-list">{batch.map(activity => <ActivityRow key={activity.id} activity={activity} nested/>)}</div>
    </details>);
  };
  for (const activity of activities) {
    const isQuietCompletion = activity.status === "completed" && activity.kind !== "request";
    if (isQuietCompletion) { completed.push(activity); continue; }
    flushCompleted();
    rows.push(<ActivityRow key={activity.id} activity={activity}/>);
  }
  flushCompleted();
  return <>{rows}</>;
}

function ActivityRow({ activity, nested = false }: { activity: TimelineActivity; nested?: boolean }) {
  if (activity.kind === "assistant") return <article className={`agent-update${nested ? " agent-update--nested" : ""}`}><p>{activity.summary}</p>{activity.status === "running" ? <CircleNotch className="spin"/> : null}</article>;
  if (activity.kind === "request" && activity.event) return <section className="activity-request"><header><Warning/><b>{activity.title}</b></header><RequestControls event={activity.event}/></section>;
  const icon = activity.kind === "command" ? <Terminal/> : activity.kind === "file" ? <File/> : activity.kind === "plan" ? <Check/> : <Code/>;
  return <details className={`activity-item activity-item--${activity.status}${nested ? " activity-item--nested" : ""}`} open={activity.status === "running"}><summary><span className="activity-icon">{activity.status === "running" ? <CircleNotch className="spin"/> : activity.status === "failed" ? <Warning/> : icon}</span><b>{activity.status === "failed" ? `${activity.title}失败` : activity.title}</b>{activity.summary ? <em>{activity.summary}</em> : null}<small>{activity.status === "running" ? "进行中" : activity.status === "failed" ? "失败" : activity.status === "interrupted" ? "已中断" : "完成"}</small><CaretDown className="activity-caret"/></summary>{activity.output ? <pre>{activity.output}</pre> : <p>{activity.summary}</p>}</details>;
}

function RequestControls({ event }: { event: AgentEvent }) {
  const payload = event.payload as Record<string, unknown>; const params = (payload.params ?? {}) as Record<string, unknown>; const questions = (params.questions ?? []) as Array<{ id: string; header: string; question: string; options?: Array<{ label: string; description: string }> }>; const [answers, setAnswers] = useState<Record<string, string>>({}); const [resolved, setResolved] = useState(false); const [error, setError] = useState("");
  async function respond(result: unknown) { try { await api.respondToRequest(event.projectId, payload.id, result); setResolved(true); } catch (reason) { setError(reason instanceof Error ? reason.message : "无法响应请求"); } }
  if (resolved) return <div className="request-resolved"><Check/>已提交，等待 Codex 继续</div>;
  if (event.method.includes("requestUserInput")) return <div className="request-controls">{questions.map(question => <label key={question.id}><b>{question.header || "需要你的输入"}</b><span>{question.question}</span>{question.options?.length ? <select value={answers[question.id] ?? ""} onChange={change => setAnswers(value => ({ ...value, [question.id]: change.target.value }))}><option value="">请选择</option>{question.options.map(option => <option value={option.label} key={option.label}>{option.label}</option>)}</select> : <input value={answers[question.id] ?? ""} onChange={change => setAnswers(value => ({ ...value, [question.id]: change.target.value }))}/>}</label>)}<div><button onClick={() => void respond({ answers: Object.fromEntries(questions.map(question => [question.id, { answers: [answers[question.id] ?? ""] }])) })}>提交回答</button><button onClick={() => void respond({ answers: {} })}>取消</button></div>{error ? <small>{error}</small> : null}</div>;
  if (event.method.includes("permissions/requestApproval")) return <div className="request-controls"><p>{String(params.reason ?? "Codex 请求临时扩展项目权限。")}</p><div><button onClick={() => void respond({ scope: "turn", permissions: params.permissions ?? {} })}>仅本次允许</button><button onClick={() => void respond({ permissions: {} })}>拒绝</button></div>{error ? <small>{error}</small> : null}</div>;
  if (event.method.includes("elicitation/request")) return <div className="request-controls"><p>{String(params.message ?? "外部工具请求输入；请先检查原始事件中的表单结构。")}</p><div><button onClick={() => void respond({ action: "decline", content: null })}>拒绝请求</button><button onClick={() => void respond({ action: "cancel", content: null })}>取消工具</button></div>{error ? <small>{error}</small> : null}</div>;
  if (event.method === "execCommandApproval" || event.method === "applyPatchApproval") return <div className="request-controls"><p>{String(params.reason ?? "Codex 请求执行受限操作。")}</p><div><button onClick={() => void respond({ decision: "allow" })}>允许</button><button onClick={() => void respond({ decision: "deny" })}>拒绝</button></div>{error ? <small>{error}</small> : null}</div>;
  return <div className="request-controls"><p>{String(params.reason ?? "Codex 请求执行项目范围外的操作，请检查原始事件后决定。")}</p><div><button onClick={() => void respond({ decision: "accept" })}>仅本次允许</button><button onClick={() => void respond({ decision: "decline" })}>拒绝</button></div>{error ? <small>{error}</small> : null}</div>;
}

function CheckpointCard({ title, summary, busy, onPreview, onConfirm }: { title: string; summary: string; busy: boolean; onPreview?: () => void; onConfirm: () => void }) {
  return <section className="checkpoint-card"><div className="checkpoint-icon"><CheckCircle weight="fill"/></div><div className="checkpoint-copy"><small>REVIEW CHECKPOINT</small><h2>{title || "制作方案已就绪"}</h2><p>{summary || "确认方向后，Agent 才会开始制作完整 Composition。"}</p></div><div className="checkpoint-actions">{onPreview ? <button className="checkpoint-preview" onClick={onPreview}><Eye/>查看计划</button> : null}<button className="primary-button kiro-fill" disabled={busy} onClick={onConfirm}>确认并制作<ArrowUp/></button></div></section>;
}

function ArtifactCanvas({ project, activeTab, preview, onClosePreview, onClosePanel, onTab, onPreview, onContext, onStudio }: { project: ProjectDetail; activeTab: "preview" | "artifacts"; preview: { artifact: Artifact; content: string; loading: boolean; error: string } | null; onClosePreview: () => void; onClosePanel: () => void; onTab: (value: "preview" | "artifacts") => void; onPreview: (artifact: Artifact) => void; onContext: (value: string) => void; onStudio: () => void }) {
  const [versionId, setVersionId] = useState(project.manifest.currentDraft ?? project.manifest.versions.at(-1)?.id ?? ""); const videoRef = useRef<HTMLVideoElement>(null); const version = project.manifest.versions.find(value => value.id === versionId) ?? project.manifest.versions.at(-1); const videoArtifact = project.manifest.artifacts.find(value => value.kind.includes("video")); const videoPath = version?.videoPath ?? videoArtifact?.path;
  useEffect(() => setVersionId(project.manifest.currentDraft ?? project.manifest.versions.at(-1)?.id ?? ""), [project.manifest.currentDraft, project.manifest.versions]);
  function addTime() { const time = videoRef.current?.currentTime ?? 0; onContext(`${version?.label ?? "Draft"} · ${formatTimestamp(time)}`); }
  return <aside className="artifact-canvas">
    <header><div><span className="canvas-label">VERSION</span>{project.manifest.versions.length ? <select value={versionId} onChange={event => setVersionId(event.target.value)}>{project.manifest.versions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <h2>项目产物</h2>}</div><div>{project.manifest.dirty ? <span className="dirty-chip">待检查</span> : null}<button className="close-canvas-button" aria-label="关闭项目产物面板" title="关闭项目产物面板" onClick={onClosePanel}><X/></button></div></header>
    {preview ? <InlineArtifactPreview preview={preview} onClose={onClosePreview}/> : <><div className="canvas-tabs" role="tablist" aria-label="预览面板"><button role="tab" aria-selected={activeTab === "artifacts"} className={activeTab === "artifacts" ? "active" : ""} onClick={() => onTab("artifacts")}>项目产物 <span>{project.manifest.artifacts.length}</span></button><button role="tab" aria-selected={activeTab === "preview"} className={activeTab === "preview" ? "active" : ""} onClick={() => onTab("preview")}>视频预览</button></div>
    {activeTab === "preview" ? <section className="preview-panel"><div className="section-heading"><h3>当前画面</h3><span>{project.aspectRatio}</span></div><div className="preview-stage-shell"><div className={`video-stage ${project.aspectRatio === "9:16" ? "portrait" : ""}`}>{videoPath ? <video ref={videoRef} src={api.fileUrl(project.id, videoPath)} controls/> : <div className="canvas-empty"><FilmSlate/><b>暂无预览视频</b><span>视频生成后会显示在这里。</span></div>}</div></div>{videoPath ? <div className="canvas-actions"><button onClick={addTime}><Play/>反馈当前时间点</button>{version && version.id !== project.manifest.currentDraft ? <button onClick={() => void api.rollbackVersion(project.id, version.id)}><ArrowClockwise/>回退版本</button> : null}</div> : null}</section> : <section className="artifact-list"><div className="section-heading"><h3>全部产物</h3><span>{project.manifest.artifacts.length}</span></div>{project.manifest.artifacts.map(artifact => <div className="artifact-row" key={artifact.id}><button className="artifact-open" onClick={() => onPreview(artifact)}><span>{artifact.kind.includes("report") ? <Check/> : <File/>}</span><div><b>{artifact.label}</b><small>{artifact.path}</small></div><Eye/></button><button className="artifact-context" aria-label={`加入反馈 ${artifact.label}`} title="加入反馈" onClick={() => onContext(`${version?.label ?? "项目"} · ${artifact.label}`)}>+</button></div>)}{!project.manifest.artifacts.length ? <div className="artifact-empty"><File/><b>还没有项目产物</b><p>生成完成后，视频与检查报告会显示在这里。</p></div> : null}</section>}</>}
    {project.manifest.studioEntry ? <div className="canvas-footer"><button className="studio-primary" onClick={onStudio}><Code/>在 Studio 中打开</button></div> : null}
  </aside>;
}

function InlineArtifactPreview({ preview, onClose }: { preview: { artifact: Artifact; content: string; loading: boolean; error: string }; onClose: () => void }) {
  const markdown = /\.md(?:own)?$/i.test(preview.artifact.path); const [source, setSource] = useState(false);
  useEffect(() => setSource(false), [preview.artifact.id]);
  return <section className="artifact-inline-preview" aria-label={`${preview.artifact.label}预览`}><header><button aria-label="返回项目产物" onClick={onClose}><ArrowLeft/></button><div><small>ARTIFACT PREVIEW</small><h2>{preview.artifact.label}</h2><span>{preview.artifact.path}</span></div>{markdown ? <div className="artifact-view-toggle" role="tablist" aria-label="产物查看方式"><button role="tab" aria-selected={!source} className={!source ? "active" : ""} onClick={() => setSource(false)}>预览</button><button role="tab" aria-selected={source} className={source ? "active" : ""} onClick={() => setSource(true)}>源码</button></div> : null}</header><div>{preview.loading ? <div className="artifact-preview-state"><CircleNotch className="spin"/>正在读取产物…</div> : preview.error ? <div className="artifact-preview-state artifact-preview-state--error"><Warning/>{preview.error}</div> : markdown && !source ? <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.content}</ReactMarkdown></div> : <pre className="artifact-source">{preview.content}</pre>}</div></section>;
}

function formatTimestamp(seconds: number) { const minutes = Math.floor(seconds / 60); return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`; }
function savedWidth(key: string, fallback: number) { const value = Number(localStorage.getItem(key)); return Number.isFinite(value) && value > 0 ? value : fallback; }
