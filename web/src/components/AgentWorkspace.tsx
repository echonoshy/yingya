import { ArrowClockwise, ArrowLeft, ArrowRight, ArrowUp, Check, CheckCircle, CircleNotch, Code, DownloadSimple, Eye, File, FilmSlate, Paperclip, PencilSimple, Plus, Queue, Stop, Terminal, Warning, X } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { api } from "../api";
import { ProjectSidebar } from "./ProjectSidebar";
import type { AgentEvent, AgentMessage, Artifact, CodexModel, ModelSelection, ProjectDetail, ProjectRecord } from "../types";
import { buildTimeline, type TimelineActivity } from "./eventTimeline";
import { ModelSelector } from "./ModelSelector";
import { useAgentEvents } from "../hooks/useAgentEvents";
import { readNumberSetting, writeNumberSetting } from "../storage";

const MarkdownPreview = lazy(() => import("./MarkdownPreview"));
type ConversationEntry = { kind: "message"; item: AgentMessage; createdAt: number } | { kind: "activity"; item: TimelineActivity; createdAt: number };

export function AgentWorkspace({ project, projects, models, selection, onSelection, onProject, onOpen, onRename, onDelete, onNew }: { project: ProjectDetail; projects: ProjectRecord[]; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; onProject: (value: ProjectDetail) => void; onOpen: (id: string) => void; onRename: (id: string, title: string) => Promise<void>; onDelete: (project: ProjectRecord) => Promise<void>; onNew: () => void }) {
  const [text, setText] = useState(""); const [files, setFiles] = useState<File[]>([]); const [contexts, setContexts] = useState<string[]>([]); const [interrupt, setInterrupt] = useState(false); const [busy, setBusy] = useState(false); const [stopping, setStopping] = useState(false); const [error, setError] = useState(""); const [studioUrl, setStudioUrl] = useState(""); const [mobilePanel, setMobilePanel] = useState<"thread" | "canvas">("thread"); const [canvasTab, setCanvasTab] = useState<"preview" | "artifacts">("preview"); const fileRef = useRef<HTMLInputElement>(null); const composerRef = useRef<HTMLTextAreaElement>(null); const timelineRef = useRef<HTMLElement>(null);
  const [artifactPreview, setArtifactPreview] = useState<{ artifact: Artifact; content: string; loading: boolean; error: string } | null>(null);
  const [canvasOpen, setCanvasOpen] = useState(true); const [sidebarWidth, setSidebarWidth] = useState(() => savedWidth("yingya-sidebar-width", 270)); const [canvasWidth, setCanvasWidth] = useState(() => savedWidth("yingya-canvas-width", 440));
  const [editingTitle, setEditingTitle] = useState(false); const [titleDraft, setTitleDraft] = useState(""); const [renaming, setRenaming] = useState(false); const [titleError, setTitleError] = useState("");
  const [dismissedCheckpoint, setDismissedCheckpoint] = useState("");
  const running = Boolean(project.activeTurnId);
  const refresh = useCallback(async () => { try { onProject(await api.getProject(project.id)); } catch { /* retain last stable project */ } }, [onProject, project.id]);
  const { events } = useAgentEvents(project.id, refresh);
  const assistantTexts = useMemo(() => new Set(project.messages.filter(message => message.role === "assistant").map(message => message.text.trim())), [project.messages]);
  const activities = useMemo(() => buildTimeline(events, assistantTexts), [events, assistantTexts]);
  const conversation = useMemo<ConversationEntry[]>(() => [
    ...project.messages.map(item => ({ kind: "message" as const, item, createdAt: item.createdAt })),
    ...activities.map(item => ({ kind: "activity" as const, item, createdAt: item.createdAt })),
  ].sort((left, right) => left.createdAt - right.createdAt), [activities, project.messages]);
  const waitingInputMessage = useMemo(() => project.status === "waiting_input"
    ? [...project.messages].reverse().find(message => message.role === "assistant")
    : undefined, [project.messages, project.status]);
  const waitingInputChoices = useMemo(() => extractInputChoices(waitingInputMessage?.text ?? ""), [waitingInputMessage?.text]);
  useEffect(() => { const timeline = timelineRef.current; if (timeline) timeline.scrollTop = timeline.scrollHeight; }, [project.messages.length, activities.length]);

  async function send(event: FormEvent) {
    event.preventDefault(); if (!text.trim() || busy) return; setBusy(true); setError("");
    try { const uploaded: string[] = []; for (const file of files) uploaded.push((await api.uploadAsset(project.id, file)).path); await api.sendTurn(project.id, { text: text.trim(), attachments: uploaded, context: contexts, interrupt, ...selection }); if (project.manifest.checkpoint?.id) setDismissedCheckpoint(project.manifest.checkpoint.id); setText(""); setFiles([]); setContexts([]); setInterrupt(false); await refresh(); }
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
  async function resumeQueue() { setBusy(true); setError(""); try { await api.resume(project.id); await refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "恢复队列失败"); } finally { setBusy(false); } }
  function selectQuickReply(value: string) { setText(value); composerRef.current?.focus(); }
  async function answerWaitingInput(choice: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await api.sendTurn(project.id, { text: `选择${choice.replace("（推荐）", "")}，请继续制作。`, ...selection });
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "确认发送失败"); }
    finally { setBusy(false); }
  }
  function focusWaitingComposer() {
    requestAnimationFrame(() => composerRef.current?.focus());
  }
  function addTimedFeedback(versionLabel: string, feedback: Array<{ time: number; description: string }>) {
    const feedbackText = [`${versionLabel} 时间点修改：`, ...feedback.map(item => `- ${formatTimestamp(item.time)} ${item.description.trim()}`)].join("\n");
    setText(current => [current.trim(), feedbackText].filter(Boolean).join("\n\n"));
    const context = `${versionLabel} · ${feedback.length} 条时间点反馈`;
    setContexts(items => items.includes(context) ? items : [...items, context]);
    setMobilePanel("thread");
    requestAnimationFrame(() => composerRef.current?.focus());
  }
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
  const checkpointSuperseded = running || project.queue.length > 0 || project.status === "queued";
  const visibleCheckpoint = project.manifest.checkpoint && project.manifest.checkpoint.kind !== "draft" && !checkpointSuperseded && project.manifest.checkpoint.id !== dismissedCheckpoint ? project.manifest.checkpoint : undefined;
  const checkpointArtifact = visibleCheckpoint?.artifactIds.map(id => project.manifest.artifacts.find(artifact => artifact.id === id)).find(Boolean);
  const workspaceStyle = { "--sidebar-width": `${sidebarWidth}px`, "--canvas-width": `${canvasWidth}px` } as CSSProperties;
  function dragSidebar(event: ReactPointerEvent<HTMLDivElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) setSidebarWidth(Math.min(360, Math.max(190, event.clientX))); }
  function dragCanvas(event: ReactPointerEvent<HTMLDivElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) setCanvasWidth(Math.min(720, Math.max(320, window.innerWidth - event.clientX))); }
  function finishResize(event: ReactPointerEvent<HTMLDivElement>, key: string, value: number) { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); writeNumberSetting(key, value); }
  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>, value: number, setValue: (next: number) => void, key: string, min: number, max: number, direction: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const arrowDirection = event.key === "ArrowLeft" ? -1 : 1;
    const next = Math.min(max, Math.max(min, value + arrowDirection * direction * (event.shiftKey ? 24 : 8)));
    setValue(next);
    writeNumberSetting(key, next);
  }
  return <div className={`workspace ${showCanvas ? "workspace--canvas" : ""} workspace-mobile--${mobilePanel}`} style={workspaceStyle}>
    <ProjectSidebar projects={projects} activeId={project.id} onOpen={onOpen} onDelete={onDelete} onNew={onNew}/>
    <div className="workspace-splitter workspace-splitter--sidebar" role="separator" aria-label="调整项目栏宽度" aria-orientation="vertical" aria-valuemin={190} aria-valuemax={360} aria-valuenow={sidebarWidth} tabIndex={0} onKeyDown={event => resizeWithKeyboard(event, sidebarWidth, setSidebarWidth, "yingya-sidebar-width", 190, 360, 1)} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={dragSidebar} onPointerUp={event => finishResize(event, "yingya-sidebar-width", sidebarWidth)} onPointerCancel={event => finishResize(event, "yingya-sidebar-width", sidebarWidth)}/>
    {showCanvas ? <div className="workspace-splitter workspace-splitter--canvas" role="separator" aria-label="调整产物栏宽度" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={720} aria-valuenow={canvasWidth} tabIndex={0} onKeyDown={event => resizeWithKeyboard(event, canvasWidth, setCanvasWidth, "yingya-canvas-width", 320, 720, -1)} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={dragCanvas} onPointerUp={event => finishResize(event, "yingya-canvas-width", canvasWidth)} onPointerCancel={event => finishResize(event, "yingya-canvas-width", canvasWidth)}/> : null}
    {showCanvas ? <nav className="workspace-tabs" aria-label="工作区视图"><button className={mobilePanel === "thread" ? "active" : ""} onClick={() => setMobilePanel("thread")}>对话</button><button className={mobilePanel === "canvas" && canvasTab === "artifacts" ? "active" : ""} onClick={() => { setMobilePanel("canvas"); setCanvasTab("artifacts"); }}>产物</button><button className={mobilePanel === "canvas" && canvasTab === "preview" ? "active" : ""} onClick={() => { setMobilePanel("canvas"); setCanvasTab("preview"); }}>预览</button></nav> : null}
    <main className="thread">
      <header className="thread-header"><div className="thread-title"><span>VIDEO PROJECT</span>{editingTitle ? <form className="thread-title-editor" onSubmit={saveTitle}><input aria-label="项目标题" autoFocus maxLength={48} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setEditingTitle(false); setTitleError(""); } }}/><button aria-label="保存项目标题" disabled={!titleDraft.trim() || renaming}><Check/></button><button type="button" aria-label="取消修改标题" onClick={() => { setEditingTitle(false); setTitleError(""); }}><X/></button></form> : <button className="thread-title-button" aria-label={`修改项目标题：${project.title}`} title="修改项目标题" onClick={() => { setTitleDraft(project.title); setTitleError(""); setEditingTitle(true); }}><h1>{project.title}</h1><PencilSimple/></button>}{titleError ? <small className="thread-title-error">{titleError}</small> : null}</div><div className="thread-meta"><span className={`project-state project-state--${project.status}`}>{project.statusLabel}</span>{hasCanvas && !canvasOpen ? <button className="open-canvas-button" onClick={() => { setCanvasOpen(true); setMobilePanel("canvas"); }}><File/>项目产物</button> : null}<span className="spec-chip">{project.aspectRatio}</span></div></header>
      <section className="timeline" ref={timelineRef}><div className="timeline-inner">
        <ConversationFeed entries={conversation} onQuickReply={selectQuickReply}/>
        {waitingInputMessage ? <WaitingInputCard choices={waitingInputChoices} busy={busy} onAnswer={choice => void answerWaitingInput(choice)} onCompose={focusWaitingComposer}/> : null}
        {(project.status === "failed" || project.status === "incomplete") && project.manifest.dirty ? <WorkflowRecoveryCard briefing={project.manifest.phase === "briefing"} incomplete={project.status === "incomplete"} statusLabel={project.statusLabel} onRecover={selectQuickReply}/> : null}
        {visibleCheckpoint ? <CheckpointCard kind={visibleCheckpoint.kind} title={visibleCheckpoint.title} summary={visibleCheckpoint.summary} busy={busy} onPreview={checkpointArtifact ? () => void previewArtifact(checkpointArtifact) : undefined} onConfirm={() => void confirm()}/> : null}
        {project.queue.length ? <section className="queue-card"><header><Queue/><b>{project.queuePaused ? "队列已暂停" : "待处理消息"}</b><span>{project.queue.length}</span>{project.queuePaused ? <button className="queue-resume" disabled={busy} onClick={() => void resumeQueue()}>继续处理</button> : null}</header>{project.queue.map((turn, index) => <div key={turn.id}><i>{String(index + 1).padStart(2, "0")}</i><span>{turn.text}</span><button aria-label="撤回排队消息" onClick={() => void api.removeQueued(project.id, turn.id).then(refresh)}><X/></button></div>)}</section> : null}
      </div></section>
      <footer className="thread-footer">{contexts.length ? <div className="context-chips">{contexts.map(value => <span key={value}>{value}<button aria-label={`移除 ${value}`} onClick={() => setContexts(items => items.filter(item => item !== value))}>×</button></span>)}</div> : null}<form className="composer" onSubmit={send}><textarea ref={composerRef} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={running ? "继续输入，默认排到当前任务之后…" : "描述修改，或继续推进视频…"}/><div className="attachment-row">{files.map(file => <span key={file.name}>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div><div className="composer-tools"><div><button className="icon-button" type="button" onClick={() => fileRef.current?.click()} aria-label="添加附件"><Paperclip/></button><input ref={fileRef} hidden multiple type="file" onChange={event => setFiles(Array.from(event.target.files ?? []))}/><ModelSelector models={models} value={selection} onChange={onSelection}/>{running ? <label className="interrupt-toggle"><input type="checkbox" checked={interrupt} onChange={event => setInterrupt(event.target.checked)}/><span>{interrupt ? "立即应用" : "排队"}</span></label> : null}</div><div>{running ? <button className="stop-button" type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? <CircleNotch className="spin"/> : <Stop weight="fill"/>}{stopping ? "正在停止" : "停止当前任务"}</button> : null}<button className="send-button" aria-label="发送消息" disabled={!text.trim() || busy}><ArrowUp weight="bold"/></button></div></div></form>{error ? <p className="form-error">{error}</p> : null}</footer>
    </main>
    {showCanvas ? <ArtifactCanvas project={project} activeTab={canvasTab} preview={artifactPreview} onClosePreview={() => setArtifactPreview(null)} onClosePanel={() => { setCanvasOpen(false); setMobilePanel("thread"); }} onTab={setCanvasTab} onPreview={artifact => void previewArtifact(artifact)} onContext={value => setContexts(items => items.includes(value) ? items : [...items, value])} onTimedFeedback={addTimedFeedback} onStudio={() => void openStudio()} onRefresh={refresh}/> : null}
    {studioUrl ? <div className="studio-modal"><header><div><b>HyperFrames Studio</b><span>关闭后会把当前 Draft 标记为待检查</span></div><button aria-label="关闭 Studio" onClick={() => { setStudioUrl(""); void api.markStudioDirty(project.id).then(refresh); }}><X/></button></header><iframe title="HyperFrames Studio" src={studioUrl} allow="autoplay; fullscreen"/></div> : null}
  </div>;
}

function ConversationFeed({ entries, onQuickReply }: { entries: ConversationEntry[]; onQuickReply: (value: string) => void }) {
  const rows: ReactNode[] = [];
  let pendingActivities: TimelineActivity[] = [];
  const visibleActivityIds = new Set(compactTimelineActivities(entries.flatMap(entry => entry.kind === "activity" ? [entry.item] : [])).map(activity => activity.id));
  const flushActivities = () => {
    if (!pendingActivities.length) return;
    const batch = pendingActivities;
    pendingActivities = [];
    rows.push(<ActivityFeed activities={batch} key={`activities-${batch[0].id}`}/>);
  };
  for (const entry of entries) {
    if (entry.kind === "activity") {
      if (visibleActivityIds.has(entry.item.id)) pendingActivities.push(entry.item);
      continue;
    }
    flushActivities();
    rows.push(<MessageRow message={entry.item} onQuickReply={onQuickReply} key={entry.item.id}/>);
  }
  flushActivities();
  return <>{rows}</>;
}

export function compactTimelineActivities(activities: TimelineActivity[]) {
  const latestOperation = [...activities].reverse().find(activity => activity.kind !== "assistant" && activity.kind !== "request");
  return activities.filter(activity => activity.kind === "assistant" || activity.kind === "request" || activity.id === latestOperation?.id);
}

function MessageRow({ message, onQuickReply }: { message: AgentMessage; onQuickReply: (value: string) => void }) {
  const quickReplies = message.role === "assistant" ? extractQuickReplies(message.text) : [];
  return <article className={`message message--${message.role}`}><div className="message-body">{message.context.length ? <div className="context-line">{message.context.map(value => <span key={value}>{value}</span>)}</div> : null}{message.role === "assistant" ? <div className="message-markdown"><Suspense fallback={<div>{message.text}</div>}><MarkdownPreview>{message.text}</MarkdownPreview></Suspense></div> : <div>{message.text}</div>}{message.attachments.length ? <small>{message.attachments.length} 个附件</small> : null}{quickReplies.length ? <div className="quick-replies" aria-label="选择下一步">{quickReplies.map(value => <button type="button" key={value} onClick={() => onQuickReply(value)}><span>{value}</span><ArrowRight/></button>)}</div> : null}</div></article>;
}

export function extractQuickReplies(text: string) {
  const replies: string[] = [];
  for (const match of text.matchAll(/^\s*\d+[.)、]\s+`([^`\n]+)`\s*$/gm)) {
    const value = match[1].trim();
    if (value && !replies.includes(value)) replies.push(value);
    if (replies.length === 4) break;
  }
  return replies;
}

export function extractInputChoices(text: string) {
  const explicitReplies = extractQuickReplies(text);
  if (explicitReplies.length) return explicitReplies;
  const choices: string[] = [];
  for (const match of text.matchAll(/^\s*[-*]\s+([^：:\n]{2,32})[：:]/gm)) {
    const value = match[1].trim();
    if (value && !choices.includes(value)) choices.push(value);
    if (choices.length === 4) break;
  }
  return choices;
}

function WaitingInputActions({ choices, busy, onAnswer, onCompose }: { choices: string[]; busy: boolean; onAnswer: (choice: string) => void; onCompose: () => void }) {
  if (!choices.length) return <button className="primary-button" type="button" onClick={onCompose}>输入回答<ArrowRight/></button>;
  return <>{choices.map((choice, index) => <button className={index === 0 ? "primary-button" : "waiting-choice"} type="button" disabled={busy} key={choice} onClick={() => onAnswer(choice)}><span>{choice}</span>{index === 0 ? <ArrowRight/> : null}</button>)}</>;
}

function WaitingInputCard({ choices, busy, onAnswer, onCompose }: { choices: string[]; busy: boolean; onAnswer: (choice: string) => void; onCompose: () => void }) {
  return <section className="waiting-input-card" aria-label="等待你的确认"><div className="waiting-input-icon"><Warning weight="fill"/></div><div><small>YOUR INPUT NEEDED</small><h2>等待你的确认</h2><p>任务已暂停，回答后才会继续制作。</p></div><div className="waiting-input-actions"><WaitingInputActions choices={choices} busy={busy} onAnswer={onAnswer} onCompose={onCompose}/></div></section>;
}

function ActivityFeed({ activities }: { activities: TimelineActivity[] }) {
  return <>{activities.map(activity => <ActivityRow key={activity.id} activity={activity}/>)}</>;
}

function ActivityRow({ activity }: { activity: TimelineActivity }) {
  if (activity.kind === "assistant") return <article className="agent-update"><p>{activity.summary}</p>{activity.status === "running" ? <CircleNotch className="spin"/> : null}</article>;
  if (activity.kind === "request" && activity.event) return <section className="activity-request"><header><Warning/><b>{activity.title}</b></header><RequestControls event={activity.event}/></section>;
  const icon = activity.kind === "command" ? <Terminal/> : activity.kind === "file" ? <File/> : activity.kind === "plan" ? <Check/> : <Code/>;
  return <div className={`activity-item activity-item--${activity.status}`}><div className="activity-item-content"><span className="activity-icon">{activity.status === "running" ? <CircleNotch className="spin"/> : activity.status === "failed" ? <Warning/> : icon}</span><b>{activity.status === "failed" ? `${activity.title}失败` : activity.title}</b>{activity.summary ? <em>{activity.summary}</em> : null}<small>{activity.status === "running" ? "进行中" : activity.status === "failed" ? "失败" : activity.status === "interrupted" ? "已中断" : "完成"}</small></div></div>;
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

function CheckpointCard({ kind, title, summary, busy, onPreview, onConfirm }: { kind: string; title: string; summary: string; busy: boolean; onPreview?: () => void; onConfirm: () => void }) {
  const draft = kind === "draft";
  return <section className="checkpoint-card"><div className="checkpoint-icon"><CheckCircle weight="fill"/></div><div className="checkpoint-copy"><small>REVIEW CHECKPOINT</small><h2>{title || (draft ? "草稿视频已就绪" : "制作方案已就绪")}</h2><p>{summary || (draft ? "确认草稿后，Agent 才会渲染最终高清成片。" : "确认方向后，Agent 才会开始制作完整 Composition。")}</p></div><div className="checkpoint-actions">{onPreview ? <button className="checkpoint-preview" onClick={onPreview}><Eye/>{draft ? "查看草稿" : "查看计划"}</button> : null}<button className="primary-button kiro-fill" disabled={busy} onClick={onConfirm}>{draft ? "确认并渲染成片" : "确认并制作"}<ArrowUp/></button></div></section>;
}

function WorkflowRecoveryCard({ briefing, incomplete, statusLabel, onRecover }: { briefing: boolean; incomplete: boolean; statusLabel: string; onRecover: (value: string) => void }) {
  const prompt = briefing ? "重新生成制作方案" : "检查并恢复项目流程";
  const detail = briefing ? "检测到视频制作越过了方案确认。已有文件会保留，恢复后将先生成可确认的制作方案。" : incomplete ? "现有文件和有效检查结果已保留。恢复时会先复用已有成果，只补齐缺失的版本与审核登记。" : "项目状态或产物不完整。恢复后会先检查现有文件，再回到正确的确认节点。";
  return <section className={`workflow-recovery ${incomplete ? "workflow-recovery--incomplete" : ""}`} role={incomplete ? "status" : "alert"}><Warning/><div><b>{incomplete ? statusLabel : "制作流程已安全暂停"}</b><p>{detail}</p></div><button type="button" onClick={() => onRecover(prompt)}>{prompt}<ArrowRight/></button></section>;
}

type RenderResolution = "landscape" | "landscape-4k" | "portrait" | "portrait-4k";
type TimeFeedback = { id: number; time: number; description: string };

function ArtifactCanvas({ project, activeTab, preview, onClosePreview, onClosePanel, onTab, onPreview, onContext, onTimedFeedback, onStudio, onRefresh }: { project: ProjectDetail; activeTab: "preview" | "artifacts"; preview: { artifact: Artifact; content: string; loading: boolean; error: string } | null; onClosePreview: () => void; onClosePanel: () => void; onTab: (value: "preview" | "artifacts") => void; onPreview: (artifact: Artifact) => void; onContext: (value: string) => void; onTimedFeedback: (versionLabel: string, feedback: Array<{ time: number; description: string }>) => void; onStudio: () => void; onRefresh: () => Promise<void> }) {
  const portrait = project.aspectRatio === "9:16"; const defaultResolution: RenderResolution = portrait ? "portrait-4k" : "landscape-4k"; const [versionId, setVersionId] = useState(project.manifest.currentDraft ?? project.manifest.versions.at(-1)?.id ?? ""); const [renderResolution, setRenderResolution] = useState<RenderResolution>(defaultResolution); const [renderFps, setRenderFps] = useState<30 | 60>(60); const [rendering, setRendering] = useState(false); const [renderError, setRenderError] = useState(""); const [timeFeedback, setTimeFeedback] = useState<TimeFeedback[]>([]); const nextFeedbackId = useRef(0); const videoRef = useRef<HTMLVideoElement>(null); const version = project.manifest.versions.find(value => value.id === versionId) ?? project.manifest.versions.at(-1); const finalVideoArtifact = [...project.manifest.artifacts].reverse().find(value => value.kind === "final-video" && value.version === version?.id); const videoArtifact = project.manifest.artifacts.find(value => value.kind.includes("video") && value.version === version?.id) ?? project.manifest.artifacts.find(value => value.kind.includes("video")); const videoPath = finalVideoArtifact?.path ?? version?.videoPath ?? videoArtifact?.path; const resolutionLabel = renderResolution === "landscape-4k" ? "3840 × 2160 p" : renderResolution === "landscape" ? "1920 × 1080 p" : renderResolution === "portrait-4k" ? "2160 × 3840 p" : "1080 × 1920 p"; const completedFeedback = timeFeedback.filter(item => item.description.trim());
  useEffect(() => setVersionId(project.manifest.currentDraft ?? project.manifest.versions.at(-1)?.id ?? ""), [project.manifest.currentDraft, project.manifest.versions]);
  useEffect(() => setRenderResolution(defaultResolution), [defaultResolution]);
  useEffect(() => setTimeFeedback([]), [project.id, versionId]);
  function addTimeFeedback() { const time = videoRef.current?.currentTime ?? 0; setTimeFeedback(items => [...items, { id: nextFeedbackId.current++, time, description: "" }]); }
  function updateTimeFeedback(id: number, description: string) { setTimeFeedback(items => items.map(item => item.id === id ? { ...item, description } : item)); }
  function applyTimeFeedback() { if (!version || !completedFeedback.length) return; onTimedFeedback(version.label, completedFeedback); setTimeFeedback([]); }
  async function renderVideo() {
    if (!version || rendering) return;
    setRendering(true); setRenderError("");
    try { await api.renderVideo(project.id, { versionId: version.id, resolution: renderResolution, fps: renderFps }); await onRefresh(); }
    catch (reason) { setRenderError(reason instanceof Error ? reason.message : "视频渲染失败"); }
    finally { setRendering(false); }
  }
  return <aside className="artifact-canvas">
    <header><div><span className="canvas-label">VERSION</span>{project.manifest.versions.length ? <select value={versionId} onChange={event => setVersionId(event.target.value)}>{project.manifest.versions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <h2>项目产物</h2>}</div><div>{project.manifest.dirty ? <span className="dirty-chip">待检查</span> : null}<button className="close-canvas-button" aria-label="关闭项目产物面板" title="关闭项目产物面板" onClick={onClosePanel}><X/></button></div></header>
    {preview ? <InlineArtifactPreview preview={preview} onClose={onClosePreview}/> : <><div className="canvas-tabs" role="tablist" aria-label="预览面板"><button role="tab" aria-selected={activeTab === "artifacts"} className={activeTab === "artifacts" ? "active" : ""} onClick={() => onTab("artifacts")}>项目产物 <span>{project.manifest.artifacts.length}</span></button><button role="tab" aria-selected={activeTab === "preview"} className={activeTab === "preview" ? "active" : ""} onClick={() => onTab("preview")}>视频预览</button></div>
    {activeTab === "preview" ? <section className="preview-panel"><div className="section-heading"><h3>当前画面</h3><span>{project.aspectRatio}</span></div>{project.activeTurnId && version ? <div className="preview-version-notice"><CircleNotch className="spin"/><span>正在生成新版，当前预览为 {version.label}</span></div> : null}<div className="preview-stage-shell"><div className={`video-stage ${project.aspectRatio === "9:16" ? "portrait" : ""}`}>{videoPath ? <video key={`${version?.id}:${videoPath}`} ref={videoRef} src={api.fileUrl(project.id, videoPath)} controls/> : <div className="canvas-empty"><FilmSlate/><b>暂无预览视频</b><span>视频生成后会显示在这里。</span></div>}</div></div>{videoPath ? <><div className="canvas-actions"><button onClick={addTimeFeedback}><Plus/>添加时间点</button>{version && version.id !== project.manifest.currentDraft ? <button onClick={() => void api.rollbackVersion(project.id, version.id)}><ArrowClockwise/>回退版本</button> : null}</div>{timeFeedback.length ? <section className="time-feedback" aria-label="时间点修改"><header><b>时间点修改</b><span>{timeFeedback.length} 条</span></header><div className="time-feedback-list">{timeFeedback.map((item, index) => <div className="time-feedback-row" key={item.id}><time>{formatTimestamp(item.time)}</time><input autoFocus={index === timeFeedback.length - 1} aria-label={`${formatTimestamp(item.time)} 的修改描述`} value={item.description} onChange={event => updateTimeFeedback(item.id, event.target.value)} placeholder="描述这个时间点需要如何修改"/><button aria-label={`删除 ${formatTimestamp(item.time)} 的反馈`} title="删除反馈" onClick={() => setTimeFeedback(items => items.filter(value => value.id !== item.id))}><X/></button></div>)}</div><button className="time-feedback-apply" disabled={!completedFeedback.length} onClick={applyTimeFeedback}><ArrowLeft/>添加到修改描述</button></section> : null}</> : null}{version ? <section className="render-panel" aria-label="导出视频"><header><b>导出视频</b>{finalVideoArtifact ? <span className="render-ready"><Check/>已生成</span> : null}</header><div className="render-options"><label><span>分辨率</span><select value={renderResolution} disabled={rendering} onChange={event => setRenderResolution(event.target.value as RenderResolution)}>{portrait ? <><option value="portrait-4k">2160 × 3840 p</option><option value="portrait">1080 × 1920 p</option></> : <><option value="landscape-4k">3840 × 2160 p</option><option value="landscape">1920 × 1080 p</option></>}</select></label><label><span>帧率</span><select value={renderFps} disabled={rendering} onChange={event => setRenderFps(Number(event.target.value) as 30 | 60)}><option value={60}>60 FPS</option><option value={30}>30 FPS</option></select></label></div><div className="render-actions"><button className="render-primary" disabled={rendering || Boolean(project.activeTurnId)} onClick={() => void renderVideo()}>{rendering ? <CircleNotch className="spin"/> : <FilmSlate/>}{rendering ? "正在后台渲染…" : `渲染 ${resolutionLabel} 成片`}</button>{finalVideoArtifact ? <a className="render-download" href={api.fileUrl(project.id, finalVideoArtifact.path)} download><DownloadSimple/>下载成片</a> : null}</div>{project.activeTurnId ? <p className="render-hint">当前修改完成后即可渲染。</p> : null}{renderError ? <p className="render-error" role="alert"><Warning/>{renderError}</p> : null}</section> : null}</section> : <section className="artifact-list"><div className="section-heading"><h3>全部产物</h3><span>{project.manifest.artifacts.length}</span></div>{project.manifest.artifacts.map(artifact => <div className="artifact-row" key={artifact.id}><button className="artifact-open" onClick={() => onPreview(artifact)}><span>{artifact.kind.includes("report") ? <Check/> : <File/>}</span><div><b>{artifact.label}</b><small>{artifact.path}</small></div><Eye/></button><button className="artifact-context" aria-label={`加入反馈 ${artifact.label}`} title="加入反馈" onClick={() => onContext(`${version?.label ?? "项目"} · ${artifact.label}`)}>+</button></div>)}{!project.manifest.artifacts.length ? <div className="artifact-empty"><File/><b>还没有项目产物</b><p>生成完成后，视频与检查报告会显示在这里。</p></div> : null}</section>}</>}
    {project.manifest.studioEntry ? <div className="canvas-footer"><button className="studio-primary" onClick={onStudio}><Code/>在 Studio 中打开</button></div> : null}
  </aside>;
}

function InlineArtifactPreview({ preview, onClose }: { preview: { artifact: Artifact; content: string; loading: boolean; error: string }; onClose: () => void }) {
  const markdown = /\.md(?:own)?$/i.test(preview.artifact.path); const [source, setSource] = useState(false);
  useEffect(() => setSource(false), [preview.artifact.id]);
  return <section className="artifact-inline-preview" aria-label={`${preview.artifact.label}预览`}><header><button aria-label="返回项目产物" onClick={onClose}><ArrowLeft/></button><div><small>ARTIFACT PREVIEW</small><h2>{preview.artifact.label}</h2><span>{preview.artifact.path}</span></div>{markdown ? <div className="artifact-view-toggle" role="tablist" aria-label="产物查看方式"><button role="tab" aria-selected={!source} className={!source ? "active" : ""} onClick={() => setSource(false)}>预览</button><button role="tab" aria-selected={source} className={source ? "active" : ""} onClick={() => setSource(true)}>源码</button></div> : null}</header><div>{preview.loading ? <div className="artifact-preview-state"><CircleNotch className="spin"/>正在读取产物…</div> : preview.error ? <div className="artifact-preview-state artifact-preview-state--error"><Warning/>{preview.error}</div> : markdown && !source ? <div className="markdown-body"><Suspense fallback={<div className="artifact-preview-state">正在加载预览…</div>}><MarkdownPreview>{preview.content}</MarkdownPreview></Suspense></div> : <pre className="artifact-source">{preview.content}</pre>}</div></section>;
}

function formatTimestamp(seconds: number) { const minutes = Math.floor(seconds / 60); return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`; }
function savedWidth(key: string, fallback: number) { return readNumberSetting(key, fallback); }
