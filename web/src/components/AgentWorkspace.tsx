import { ArrowClockwise, ArrowLeft, ArrowRight, ArrowUp, CaretLeft, Check, CheckCircle, CircleNotch, Code, DownloadSimple, Eye, File, FileAudio, FileText, FilmSlate, FolderSimple, Images, Paperclip, PencilSimple, Plus, Queue, SquaresFour, Stop, Terminal, VideoCamera, Warning, X } from "@phosphor-icons/react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { api } from "../api";
import type { AgentEvent, AgentMedia, AgentMessage, Artifact, AssetFolder, AssetLibraryItem, CodexModel, MediaScene, ModelSelection, ProjectDetail } from "../types";
import { buildTimeline, type TimelineActivity } from "./eventTimeline";
import { ModelSelector } from "./ModelSelector";
import { VoiceSelector } from "./VoiceSelector";
import { useAgentEvents } from "../hooks/useAgentEvents";
import { readNumberSetting, readStringSetting, writeNumberSetting, writeStringSetting } from "../storage";
import type { AgentConnectionState } from "../hooks/useAgentEvents";
import { LiveHyperFramesPreview as ManagedLiveHyperFramesPreview, RenderPanel as PersistentRenderPanel } from "./HyperFramesWorkspace";

const MarkdownPreview = lazy(() => import("./MarkdownPreview"));
type ConversationEntry = { kind: "message"; item: AgentMessage; createdAt: number } | { kind: "activity"; item: TimelineActivity; createdAt: number };
type CanvasTab = "preview" | "storyboard" | "assets" | "artifacts";

export function AgentWorkspace({ project, models, selection, onSelection, onVoice, onProject, onRename, onBack }: { project: ProjectDetail; models: CodexModel[]; selection: ModelSelection; onSelection: (value: ModelSelection) => void; onVoice: (voiceId: string) => void | Promise<void>; onProject: (value: ProjectDetail) => void; onRename: (id: string, title: string) => Promise<void>; onBack: () => void }) {
  const [text, setText] = useState(""); const [files, setFiles] = useState<File[]>([]); const [contexts, setContexts] = useState<string[]>([]); const [interrupt, setInterrupt] = useState(false); const [busy, setBusy] = useState(false); const [stopping, setStopping] = useState(false); const [error, setError] = useState(""); const [mobilePanel, setMobilePanel] = useState<"thread" | "canvas">("thread"); const [canvasTab, setCanvasTab] = useState<CanvasTab>(() => savedCanvasTab(project.id)); const fileRef = useRef<HTMLInputElement>(null); const composerRef = useRef<HTMLTextAreaElement>(null); const timelineRef = useRef<HTMLElement>(null);
  const [artifactPreview, setArtifactPreview] = useState<{ artifact: Artifact; content: string; loading: boolean; error: string } | null>(null);
  const [threadWidth, setThreadWidth] = useState(() => savedWidth("yingya-thread-width", 468));
  const [libraryAssets, setLibraryAssets] = useState<AssetLibraryItem[]>([]);
  const [libraryFolders, setLibraryFolders] = useState<AssetFolder[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<AssetLibraryItem[]>([]);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [media, setMedia] = useState<AgentMedia>({ scenes: [], assets: [] });
  const [editingTitle, setEditingTitle] = useState(false); const [titleDraft, setTitleDraft] = useState(""); const [renaming, setRenaming] = useState(false); const [titleError, setTitleError] = useState("");
  const [dismissedCheckpoint, setDismissedCheckpoint] = useState("");
  const refreshGeneration = useRef(0);
  const running = Boolean(project.activeTurnId);
  const refreshMedia = useCallback(async () => { try { setMedia(await api.getProjectMedia(project.id)); } catch { /* media is optional for older projects */ } }, [project.id]);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    try {
      const [detail, latestMedia] = await Promise.all([api.getProject(project.id), api.getProjectMedia(project.id).catch(() => undefined)]);
      if (generation !== refreshGeneration.current) return;
      if (latestMedia) setMedia(latestMedia);
      onProject(detail);
    } catch { /* retain last stable project */ }
  }, [onProject, project.id]);
  const { events, connectionState, stalled, resync } = useAgentEvents(project.id, refresh, running);
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
  useEffect(() => {
    void refreshMedia();
    void Promise.all([api.listAssetLibrary(), api.listAssetFolders()])
      .then(([library, folders]) => { setLibraryAssets(library.assets); setLibraryFolders(folders); })
      .catch(() => undefined);
  }, [refreshMedia]);
  function selectCanvasTab(tab: CanvasTab) { setCanvasTab(tab); writeStringSetting(`yingya-canvas-tab:${project.id}`, tab); }

  async function send(event: FormEvent) {
    event.preventDefault(); if ((!text.trim() && !files.length && !selectedAssets.length) || busy) return; setBusy(true); setError("");
    try {
      const uploaded = await Promise.all([
        ...files.map(file => api.uploadAsset(project.id, file)),
        ...selectedAssets.map(asset => uploadLibraryAsset(project.id, asset)),
      ]);
      const assetContexts = selectedAssets.map(asset => `创作参考 · ${assetName(asset)}`);
      await api.sendTurn(project.id, { text: text.trim() || "请结合所选素材继续创作。", attachments: uploaded.map(item => item.path), context: [...new Set([...contexts, ...assetContexts])], interrupt, ...selection });
      if (project.manifest.checkpoint?.id) setDismissedCheckpoint(project.manifest.checkpoint.id); setText(""); setFiles([]); setSelectedAssets([]); setContexts([]); setInterrupt(false); await refresh();
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "消息发送失败"); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError("");
    try {
      const checkpointId = project.manifest.checkpoint?.id;
      const checkpointKind = project.manifest.checkpoint?.kind;
      await api.confirmCheckpoint(project.id);
      if (checkpointId) setDismissedCheckpoint(checkpointId);
      setArtifactPreview(null);
      if (checkpointKind === "plan") { selectCanvasTab("preview"); setMobilePanel("canvas"); }
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "确认失败"); }
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
    setMobilePanel("canvas");
    if (artifact.kind.includes("video")) { setArtifactPreview(null); selectCanvasTab("preview"); return; }
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
  const checkpointSuperseded = running || project.queue.length > 0 || project.status === "queued";
  const visibleCheckpoint = project.manifest.checkpoint && project.manifest.checkpoint.kind !== "draft" && !checkpointSuperseded && project.manifest.checkpoint.id !== dismissedCheckpoint ? project.manifest.checkpoint : undefined;
  const checkpointArtifact = visibleCheckpoint?.artifactIds.map(id => project.manifest.artifacts.find(artifact => artifact.id === id)).find(Boolean);
  const workspaceStyle = { "--thread-width": `${threadWidth}px` } as CSSProperties;
  function dragThread(event: ReactPointerEvent<HTMLDivElement>) { if (event.currentTarget.hasPointerCapture(event.pointerId)) setThreadWidth(Math.min(620, Math.max(380, event.clientX))); }
  function finishResize(event: ReactPointerEvent<HTMLDivElement>, key: string, value: number) { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); writeNumberSetting(key, value); }
  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>, value: number, setValue: (next: number) => void, key: string, min: number, max: number, direction: number) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const arrowDirection = event.key === "ArrowLeft" ? -1 : 1;
    const next = Math.min(max, Math.max(min, value + arrowDirection * direction * (event.shiftKey ? 24 : 8)));
    setValue(next);
    writeNumberSetting(key, next);
  }
  function selectReferenceAssets(assets: AssetLibraryItem[]) {
    setSelectedAssets(items => {
      const selectedIds = new Set(items.map(item => item.id));
      return [...items, ...assets.filter(asset => !selectedIds.has(asset.id))];
    });
  }
  return <div className={`workspace workspace--canvas workspace-mobile--${mobilePanel}`} style={workspaceStyle}>
    <header className="project-header"><div className="project-header-brand"><img src="/brand/invideo-favicon-black.ico" alt=""/><b>映芽</b></div><button className="project-back" onClick={onBack}><CaretLeft/>所有项目</button><div className="project-heading">{editingTitle ? <form className="thread-title-editor" onSubmit={saveTitle}><input aria-label="项目标题" autoFocus maxLength={48} value={titleDraft} onChange={event => setTitleDraft(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setEditingTitle(false); setTitleError(""); } }}/><button aria-label="保存项目标题" disabled={!titleDraft.trim() || renaming}><Check/></button><button type="button" aria-label="取消修改标题" onClick={() => { setEditingTitle(false); setTitleError(""); }}><X/></button></form> : <button className="thread-title-button" aria-label={`修改项目标题：${project.title}`} title="修改项目标题" onClick={() => { setTitleDraft(project.title); setTitleError(""); setEditingTitle(true); }}><h1>{project.title}</h1><PencilSimple/></button>}<span className={`project-state project-state--${project.status}`}>{project.statusLabel}</span></div><div className="project-header-actions"><ConnectionBadge state={connectionState}/><span className="spec-chip">{project.aspectRatio}</span><button className="export-button" onClick={() => { selectCanvasTab("preview"); setMobilePanel("canvas"); }}><DownloadSimple/>导出</button></div></header>
    <div className="workspace-splitter workspace-splitter--thread" role="separator" aria-label="调整创作对话宽度" aria-orientation="vertical" aria-valuemin={380} aria-valuemax={620} aria-valuenow={threadWidth} tabIndex={0} onKeyDown={event => resizeWithKeyboard(event, threadWidth, setThreadWidth, "yingya-thread-width", 380, 620, 1)} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={dragThread} onPointerUp={event => finishResize(event, "yingya-thread-width", threadWidth)} onPointerCancel={event => finishResize(event, "yingya-thread-width", threadWidth)}/>
    <nav className="workspace-tabs" aria-label="工作区视图"><button className={mobilePanel === "thread" ? "active" : ""} onClick={() => setMobilePanel("thread")}>对话</button>{(["preview", "storyboard", "assets", "artifacts"] as CanvasTab[]).map(tab => <button key={tab} className={mobilePanel === "canvas" && canvasTab === tab ? "active" : ""} onClick={() => { setMobilePanel("canvas"); selectCanvasTab(tab); }}>{canvasTabLabel(tab)}</button>)}</nav>
    <main className="thread">
      <header className="thread-header"><div><span>创作对话</span><b>{running ? "正在制作，可继续补充要求" : "与创作助手继续完善视频"}</b></div>{titleError ? <small className="thread-title-error">{titleError}</small> : null}</header>
      <section className="timeline" ref={timelineRef}><div className="timeline-inner">
        {stalled || connectionState === "disconnected" ? <ConnectionNotice stalled={stalled} onRetry={() => void resync()}/> : null}
        <ConversationFeed entries={conversation} onQuickReply={selectQuickReply}/>
        {waitingInputMessage ? <WaitingInputCard choices={waitingInputChoices} busy={busy} onAnswer={choice => void answerWaitingInput(choice)} onCompose={focusWaitingComposer}/> : null}
        {(project.status === "failed" || project.status === "incomplete") && project.manifest.dirty ? <WorkflowRecoveryCard briefing={project.manifest.phase === "briefing"} incomplete={project.status === "incomplete"} statusLabel={project.statusLabel} onRecover={selectQuickReply}/> : null}
        {visibleCheckpoint ? <CheckpointCard kind={visibleCheckpoint.kind} title={visibleCheckpoint.title} summary={visibleCheckpoint.summary} busy={busy} onPreview={checkpointArtifact ? () => void previewArtifact(checkpointArtifact) : undefined} onConfirm={() => void confirm()}/> : null}
        {project.queue.length ? <section className="queue-card"><header><Queue/><b>{project.queuePaused ? "队列已暂停" : "待处理消息"}</b><span>{project.queue.length}</span>{project.queuePaused ? <button className="queue-resume" disabled={busy} onClick={() => void resumeQueue()}>继续处理</button> : null}</header>{project.queue.map((turn, index) => <div key={turn.id}><i>{String(index + 1).padStart(2, "0")}</i><span>{turn.text}</span><button aria-label="撤回排队消息" onClick={() => void api.removeQueued(project.id, turn.id).then(refresh)}><X/></button></div>)}</section> : null}
      </div></section>
      <footer className="thread-footer">
        {assetPickerOpen ? <ComposerAssetPicker assets={libraryAssets} selected={selectedAssets} onClose={() => setAssetPickerOpen(false)} onToggle={asset => setSelectedAssets(items => items.some(item => item.id === asset.id) ? items.filter(item => item.id !== asset.id) : [...items, asset])}/> : null}
        {selectedAssets.length ? <div className="selected-asset-chips" aria-label="已选择素材">{selectedAssets.map(asset => <span key={asset.id}><AssetReferenceThumb asset={asset}/><span><b>{assetName(asset)}</b><small>{assetTypeLabel(asset)} · 创作参考</small></span><button aria-label={`移除素材 ${assetName(asset)}`} onClick={() => setSelectedAssets(items => items.filter(item => item.id !== asset.id))}><X/></button></span>)}</div> : null}
        {contexts.length ? <div className="context-chips">{contexts.map(value => <span key={value}>{value}<button aria-label={`移除 ${value}`} onClick={() => setContexts(items => items.filter(item => item !== value))}>×</button></span>)}</div> : null}
        <form className="composer" onSubmit={send}><textarea ref={composerRef} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={running ? "继续输入，默认排到当前任务之后…" : "描述修改，或继续推进视频…"}/><div className="attachment-row">{files.map(file => <span key={file.name}>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setFiles(value => value.filter(item => item !== file))}>×</button></span>)}</div><div className="composer-tools"><div><button className="icon-button" type="button" onClick={() => fileRef.current?.click()} aria-label="添加附件" title="添加附件"><Paperclip/></button><input ref={fileRef} hidden multiple type="file" onChange={event => setFiles(Array.from(event.target.files ?? []))}/><button className={`asset-picker-trigger ${selectedAssets.length ? "active" : ""}`} type="button" aria-expanded={assetPickerOpen} onClick={() => setAssetPickerOpen(open => !open)}><Images/>选择素材{selectedAssets.length ? <span>{selectedAssets.length}</span> : null}</button><VoiceSelector value={project.voiceId} onChange={onVoice} disabled={running}/><ModelSelector models={models} value={selection} onChange={onSelection}/>{running ? <label className="interrupt-toggle"><input type="checkbox" checked={interrupt} onChange={event => setInterrupt(event.target.checked)}/><span>{interrupt ? "立即应用" : "排队"}</span></label> : null}</div><div>{running ? <button className="stop-button" type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? <CircleNotch className="spin"/> : <Stop weight="fill"/>}{stopping ? "正在停止" : "停止当前任务"}</button> : null}<button className="send-button" aria-label="发送消息" disabled={(!text.trim() && !files.length && !selectedAssets.length) || busy}><ArrowUp weight="bold"/></button></div></div></form>{error ? <p className="form-error">{error}</p> : null}
      </footer>
    </main>
    <ArtifactCanvas project={project} activeTab={canvasTab} preview={artifactPreview} media={media} libraryAssets={libraryAssets} libraryFolders={libraryFolders} selectedAssets={selectedAssets} onClosePreview={() => setArtifactPreview(null)} onTab={selectCanvasTab} onPreview={artifact => void previewArtifact(artifact)} onContext={value => setContexts(items => items.includes(value) ? items : [...items, value])} onSelectAssets={selectReferenceAssets} onTimedFeedback={addTimedFeedback} onRefresh={refresh}/>
  </div>;
}

function ConnectionBadge({ state }: { state: AgentConnectionState }) {
  if (state === "connected") return null;
  const label = state === "connecting" ? "正在连接" : state === "recovering" ? "正在恢复连接" : "连接已中断";
  return <span className={`connection-badge connection-badge--${state}`} role="status"><i/>{label}</span>;
}

function ConnectionNotice({ stalled, onRetry }: { stalled: boolean; onRetry: () => void }) {
  return <section className="connection-notice" role="status"><Warning/><div><b>{stalled ? "任务长时间没有新进度" : "实时连接已中断"}</b><p>{stalled ? "映芽仍会保留任务和队列，你可以重新同步最新状态。" : "当前内容不会丢失，重新连接后会补齐期间的进度。"}</p></div><button type="button" onClick={onRetry}><ArrowClockwise/>重新同步</button></section>;
}

function ComposerAssetPicker({ assets, selected, onToggle, onClose }: { assets: AssetLibraryItem[]; selected: AssetLibraryItem[]; onToggle: (asset: AssetLibraryItem) => void; onClose: () => void }) {
  return <section className="composer-asset-picker" aria-label="选择创作素材"><header><div><b>选择参考文件</b><span>图片、视频、音频和文档都可随对话进入创作</span></div><button type="button" aria-label="关闭素材选择" onClick={onClose}><X/></button></header>{assets.length ? <div>{assets.map(asset => { const active = selected.some(item => item.id === asset.id); return <button type="button" className={active ? "selected" : ""} aria-pressed={active} key={asset.id} onClick={() => onToggle(asset)}><AssetReferenceThumb asset={asset}/><span><b>{assetName(asset)}</b><small>{assetTypeLabel(asset)} · {asset.kind === "generated" ? "AI 生成" : "已上传"}</small></span>{active ? <Check/> : <Plus/>}</button>; })}</div> : <p>素材库暂时为空，可先在项目外的素材工坊上传文件。</p>}</section>;
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
  return <section className="waiting-input-card" aria-label="等待你的确认"><div className="waiting-input-icon"><Warning weight="fill"/></div><div><small>需要你的输入</small><h2>等待你的确认</h2><p>任务已暂停，回答后才会继续制作。</p></div><div className="waiting-input-actions"><WaitingInputActions choices={choices} busy={busy} onAnswer={onAnswer} onCompose={onCompose}/></div></section>;
}

function ActivityFeed({ activities }: { activities: TimelineActivity[] }) {
  return <>{activities.map(activity => <ActivityRow key={activity.id} activity={activity}/>)}</>;
}

function ActivityRow({ activity }: { activity: TimelineActivity }) {
  if (activity.kind === "assistant") return <article className="agent-update"><p>{activity.summary}</p>{activity.status === "running" ? <CircleNotch className="spin"/> : null}</article>;
  if (activity.kind === "request" && activity.event) return <section className="activity-request"><header><Warning/><b>{activity.title}</b></header><RequestControls event={activity.event}/></section>;
  const icon = activity.kind === "command" ? <Terminal/> : activity.kind === "file" ? <File/> : activity.kind === "plan" ? <Check/> : activity.kind === "system" ? <Warning/> : <Code/>;
  const statusLabel = activity.status === "running" ? "进行中" : activity.status === "waiting" ? "自动重试中" : activity.status === "failed" ? "失败" : activity.status === "interrupted" ? "已中断" : "完成";
  return <div className={`activity-item activity-item--${activity.status}`} role={activity.kind === "system" ? "status" : undefined}><div className="activity-item-content"><span className="activity-icon">{activity.status === "running" ? <CircleNotch className="spin"/> : activity.status === "failed" ? <Warning/> : icon}</span><b>{activity.status === "failed" ? `${activity.title}失败` : activity.title}</b>{activity.summary ? <em>{activity.summary}</em> : null}<small>{statusLabel}</small></div></div>;
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
  return <section className="checkpoint-card"><div className="checkpoint-icon"><CheckCircle weight="fill"/></div><div className="checkpoint-copy"><small>制作检查点</small><h2>{title || (draft ? "草稿视频已就绪" : "制作方案已就绪")}</h2><p>{summary || (draft ? "确认草稿后，Agent 才会渲染最终高清成片。" : "确认方向后，Agent 才会开始制作完整 Composition。")}</p></div><div className="checkpoint-actions">{onPreview ? <button className="checkpoint-preview" onClick={onPreview}><Eye/>{draft ? "查看草稿" : "查看计划"}</button> : null}<button className="primary-button primary-fill" disabled={busy} onClick={onConfirm}>{draft ? "确认并渲染成片" : "确认并制作"}<ArrowUp/></button></div></section>;
}

function WorkflowRecoveryCard({ briefing, incomplete, statusLabel, onRecover }: { briefing: boolean; incomplete: boolean; statusLabel: string; onRecover: (value: string) => void }) {
  const prompt = briefing ? "重新生成制作方案" : "检查并恢复项目流程";
  const detail = briefing ? "检测到视频制作越过了方案确认。已有文件会保留，恢复后将先生成可确认的制作方案。" : incomplete ? "现有文件和有效检查结果已保留。恢复时会先复用已有成果，只补齐缺失的版本与审核登记。" : "项目状态或产物不完整。恢复后会先检查现有文件，再回到正确的确认节点。";
  return <section className={`workflow-recovery ${incomplete ? "workflow-recovery--incomplete" : ""}`} role={incomplete ? "status" : "alert"}><Warning/><div><b>{incomplete ? statusLabel : "制作流程已安全暂停"}</b><p>{detail}</p></div><button type="button" onClick={() => onRecover(prompt)}>{prompt}<ArrowRight/></button></section>;
}
type TimeFeedback = { id: number; time: number; description: string };

function ArtifactCanvas({ project, activeTab, preview, media, libraryAssets, libraryFolders, selectedAssets, onClosePreview, onTab, onPreview, onContext, onSelectAssets, onTimedFeedback, onRefresh }: { project: ProjectDetail; activeTab: CanvasTab; preview: { artifact: Artifact; content: string; loading: boolean; error: string } | null; media: AgentMedia; libraryAssets: AssetLibraryItem[]; libraryFolders: AssetFolder[]; selectedAssets: AssetLibraryItem[]; onClosePreview: () => void; onTab: (value: CanvasTab) => void; onPreview: (artifact: Artifact) => void; onContext: (value: string) => void; onSelectAssets: (assets: AssetLibraryItem[]) => void; onTimedFeedback: (versionLabel: string, feedback: Array<{ time: number; description: string }>) => void; onRefresh: () => Promise<void> }) {
  const [versionId, setVersionId] = useState(() => savedVersionId(project));
  const [timeFeedback, setTimeFeedback] = useState<TimeFeedback[]>([]);
  const nextFeedbackId = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const version = project.manifest.versions.find(value => value.id === versionId) ?? project.manifest.versions.at(-1);
  const finalVideoArtifact = [...project.manifest.artifacts].reverse().find(value => value.kind === "final-video" && value.version === version?.id);
  const videoArtifact = project.manifest.artifacts.find(value => value.kind.includes("video") && value.version === version?.id) ?? project.manifest.artifacts.find(value => value.kind.includes("video"));
  const videoPath = finalVideoArtifact?.path ?? version?.videoPath ?? videoArtifact?.path;
  const completedFeedback = timeFeedback.filter(item => item.description.trim());
  const liveAvailable = project.manifest.phase !== "briefing" && project.manifest.phase !== "plan_review";

  useEffect(() => {
    if (versionId && project.manifest.versions.some(version => version.id === versionId)) return;
    setVersionId(project.manifest.currentDraft ?? project.manifest.versions.at(-1)?.id ?? "");
  }, [project.manifest.currentDraft, project.manifest.versions, versionId]);
  useEffect(() => setTimeFeedback([]), [project.id, versionId]);

  function addTimeFeedback() {
    const time = videoRef.current?.currentTime ?? 0;
    setTimeFeedback(items => [...items, { id: nextFeedbackId.current++, time, description: "" }]);
  }
  function updateTimeFeedback(id: number, description: string) {
    setTimeFeedback(items => items.map(item => item.id === id ? { ...item, description } : item));
  }
  function applyTimeFeedback() {
    if (!version || !completedFeedback.length) return;
    onTimedFeedback(version.label, completedFeedback);
    setTimeFeedback([]);
  }

  return <aside className="artifact-canvas">
    <header><div className="canvas-version"><span className="canvas-label">当前版本</span>{project.manifest.versions.length ? <select value={versionId} onChange={event => { setVersionId(event.target.value); writeStringSetting(`yingya-version:${project.id}`, event.target.value); }}>{project.manifest.versions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select> : <h2>项目工作台</h2>}</div><div className="canvas-tabs" role="tablist" aria-label="项目工作台">{(["preview", "storyboard", "assets", "artifacts"] as CanvasTab[]).map(tab => <button role="tab" aria-selected={activeTab === tab} className={activeTab === tab ? "active" : ""} key={tab} onClick={() => onTab(tab)}>{canvasTabLabel(tab)}{tab === "assets" && selectedAssets.length ? <span>{selectedAssets.length}</span> : tab === "artifacts" && project.manifest.artifacts.length ? <span>{project.manifest.artifacts.length}</span> : null}</button>)}</div><div>{project.manifest.dirty ? <span className="dirty-chip">待检查</span> : null}</div></header>
    {preview ? <InlineArtifactPreview preview={preview} onClose={onClosePreview}/> : <>
      <ManagedLiveHyperFramesPreview project={project} active={activeTab === "preview" && !videoPath && liveAvailable} available={liveAvailable}/>
      {activeTab === "preview" && (videoPath || !liveAvailable) ? <section className="preview-panel preview-panel--with-inspector"><div className="preview-main">
        <div className="section-heading"><h3>{videoPath ? "当前成片" : "作品预览"}</h3><span>{project.aspectRatio}</span></div>
        {project.activeTurnId && version ? <div className="preview-version-notice"><CircleNotch className="spin"/><span>正在生成新版，当前预览为 {version.label}</span></div> : null}
        <div className="preview-stage-shell"><div className={`video-stage ${project.aspectRatio === "9:16" ? "portrait" : project.aspectRatio === "1:1" ? "square" : ""}`}>{videoPath ? <video key={`${version?.id}:${videoPath}`} ref={videoRef} src={api.fileUrl(project.id, videoPath)} controls onLoadedMetadata={event => restoreVideoTime(event.currentTarget, `yingya-video-time:${project.id}:${version?.id ?? "current"}`)} onPause={event => saveVideoTime(event.currentTarget, `yingya-video-time:${project.id}:${version?.id ?? "current"}`)}/> : <div className="canvas-empty"><FilmSlate/><b>暂无草稿视频</b><span>制作过程中可先在“实时画面”查看 HTML 动效。</span></div>}</div></div>
        {videoPath ? <>
          <div className="canvas-actions"><button onClick={addTimeFeedback}><Plus/>添加时间点</button>{version && version.id !== project.manifest.currentDraft ? <button onClick={() => void api.rollbackVersion(project.id, version.id)}><ArrowClockwise/>回退版本</button> : null}</div>
          {timeFeedback.length ? <section className="time-feedback" aria-label="时间点修改"><header><b>时间点修改</b><span>{timeFeedback.length} 条</span></header><div className="time-feedback-list">{timeFeedback.map((item, index) => <div className="time-feedback-row" key={item.id}><time>{formatTimestamp(item.time)}</time><input autoFocus={index === timeFeedback.length - 1} aria-label={`${formatTimestamp(item.time)} 的修改描述`} value={item.description} onChange={event => updateTimeFeedback(item.id, event.target.value)} placeholder="描述这个时间点需要如何修改"/><button aria-label={`删除 ${formatTimestamp(item.time)} 的反馈`} title="删除反馈" onClick={() => setTimeFeedback(items => items.filter(value => value.id !== item.id))}><X/></button></div>)}</div><button className="time-feedback-apply" disabled={!completedFeedback.length} onClick={applyTimeFeedback}><ArrowLeft/>添加到修改描述</button></section> : null}
        </> : null}
        {version ? <PersistentRenderPanel project={project} version={version} onRefresh={onRefresh}/> : null}
      </div><PreviewAssetInspector media={media} libraryAssets={libraryAssets} selectedAssets={selectedAssets} onSelect={asset => onSelectAssets([asset])}/></section> : null}
      {activeTab === "storyboard" ? <StoryboardPanel scenes={media.scenes} assets={media.assets} onContext={onContext}/> : null}
      {activeTab === "assets" ? <ProjectAssetsPanel media={media} libraryAssets={libraryAssets} libraryFolders={libraryFolders} selectedAssets={selectedAssets} onSelect={asset => onSelectAssets([asset])} onSelectFolder={onSelectAssets}/> : null}
      {activeTab === "artifacts" ? <section className="artifact-list"><div className="section-heading"><h3>全部产物</h3><span>{project.manifest.artifacts.length}</span></div>{project.manifest.artifacts.map(artifact => <div className="artifact-row" key={artifact.id}><button className="artifact-open" onClick={() => onPreview(artifact)}><span>{artifact.kind.includes("report") ? <Check/> : <File/>}</span><div><b>{artifact.label}</b><small>{artifact.path}</small></div><Eye/></button><button className="artifact-context" aria-label={`加入反馈 ${artifact.label}`} title="加入反馈" onClick={() => onContext(`${version?.label ?? "项目"} · ${artifact.label}`)}>+</button></div>)}{!project.manifest.artifacts.length ? <div className="artifact-empty"><File/><b>还没有项目产物</b><p>生成完成后，视频与检查报告会显示在这里。</p></div> : null}</section> : null}
    </>}
  </aside>;
}

function StoryboardPanel({ scenes, assets, onContext }: { scenes: MediaScene[]; assets: AgentMedia["assets"]; onContext: (value: string) => void }) {
  const orderedScenes = [...scenes].sort((left, right) => left.order - right.order);
  return <section className="storyboard-panel"><div className="section-heading"><div><h3>分镜</h3><p>场景、旁白与采用素材在这里保持关联。</p></div><span>{orderedScenes.length} 个场景</span></div>{orderedScenes.length ? <div className="storyboard-list">{orderedScenes.map((scene, index) => { const sceneAssets = scene.assetIds.map(id => assets.find(asset => asset.id === id)).filter((asset): asset is AgentMedia["assets"][number] => Boolean(asset)); return <article key={scene.id}><div className="scene-index">{String(index + 1).padStart(2, "0")}</div><div className="scene-copy"><b>场景 {String(scene.order || index + 1).padStart(2, "0")}</b><span>{scene.narrativeRole || "待补充场景描述"}</span></div><div className="scene-assets">{sceneAssets.slice(0, 3).map(asset => asset.url ? <img src={asset.url} alt={asset.name} key={asset.id}/> : null)}{!sceneAssets.length ? <span>暂无素材</span> : null}</div><button onClick={() => onContext(`场景 ${scene.order || index + 1} · ${scene.narrativeRole || "分镜"}`)}>加入反馈</button></article>; })}</div> : <div className="workbench-empty"><SquaresFour/><b>分镜正在准备</b><p>确认制作方案后，场景结构会显示在这里；聊天中选择的素材会随创作要求一起进入分镜。</p></div>}</section>;
}

function ProjectAssetsPanel({ media, libraryAssets, libraryFolders, selectedAssets, onSelect, onSelectFolder }: { media: AgentMedia; libraryAssets: AssetLibraryItem[]; libraryFolders: AssetFolder[]; selectedAssets: AssetLibraryItem[]; onSelect: (asset: AssetLibraryItem) => void; onSelectFolder: (assets: AssetLibraryItem[]) => void }) {
  const [folderId, setFolderId] = useState("*");
  const visibleAssets = folderId === "*" ? libraryAssets : libraryAssets.filter(asset => (asset.folderId ?? "") === folderId);
  const selectableAssets = visibleAssets.filter(asset => !selectedAssets.some(item => item.id === asset.id));
  return <section className="project-assets-panel"><div className="section-heading"><div><h3>参考文件</h3><p>图片、视频、音频、文档及其他文件都可加入当前创作对话。</p></div><span>{media.assets.length} 项已进入项目</span></div>{media.assets.length ? <section className="project-media-section"><h4>项目中</h4><div>{media.assets.map(asset => <article key={asset.id}>{asset.url && asset.mediaType?.startsWith("image/") ? <img src={asset.url} alt=""/> : <span><File/></span>}<div><b>{displayFileName(asset.name)}</b><small>{asset.source === "upload" ? "对话参考" : asset.source}</small></div></article>)}</div></section> : null}<section className="project-library-section"><div className="project-library-heading"><div><h4>全局素材库</h4><span>{visibleAssets.length} 个文件</span></div><div className="project-library-controls"><label><FolderSimple/><select aria-label="筛选素材文件夹" value={folderId} onChange={event => setFolderId(event.target.value)}><option value="*">全部文件夹</option><option value="">未整理</option>{libraryFolders.map(folder => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>{folderId !== "*" && visibleAssets.length ? <button type="button" disabled={!selectableAssets.length} onClick={() => onSelectFolder(selectableAssets)}><FolderSimple/>{selectableAssets.length ? "选择此文件夹" : "文件夹已选择"}</button> : null}</div></div>{visibleAssets.length ? <div className="project-library-grid">{visibleAssets.map(asset => { const selected = selectedAssets.some(item => item.id === asset.id); return <article key={asset.id}><AssetReferenceThumb asset={asset}/><div><b>{assetName(asset)}</b><small>{assetTypeLabel(asset)} · {asset.kind === "generated" ? "AI 生成" : "已上传"}</small></div><button disabled={selected} aria-label={`${selected ? "已选择" : "选择参考文件"} ${assetName(asset)}`} onClick={() => onSelect(asset)}>{selected ? <Check/> : <Plus/>}{selected ? "已选择" : "加入提示"}</button></article>; })}</div> : <div className="workbench-empty"><File/><b>这个文件夹暂无素材</b><p>可前往素材工坊上传任意类型的参考文件。</p></div>}</section></section>;
}

function PreviewAssetInspector({ media, libraryAssets, selectedAssets, onSelect }: { media: AgentMedia; libraryAssets: AssetLibraryItem[]; selectedAssets: AssetLibraryItem[]; onSelect: (asset: AssetLibraryItem) => void }) {
  const scene = [...media.scenes].sort((left, right) => left.order - right.order)[0];
  const sceneAssets = scene ? scene.assetIds.map(id => media.assets.find(asset => asset.id === id)).filter((asset): asset is AgentMedia["assets"][number] => Boolean(asset)) : media.assets.slice(0, 4);
  return <aside className="preview-asset-inspector"><header><div><b>{scene ? `场景 ${String(scene.order || 1).padStart(2, "0")}` : "创作参考"}</b><span>{scene?.narrativeRole || "当前项目上下文"}</span></div><span>{sceneAssets.length}</span></header><section><h4>已使用素材</h4>{sceneAssets.length ? <div className="preview-used-assets">{sceneAssets.map(asset => <article key={asset.id}>{asset.url && asset.mediaType?.startsWith("image/") ? <img src={asset.url} alt=""/> : <span><File/></span>}<div><b>{displayFileName(asset.name)}</b><small>{asset.description || asset.source}</small></div></article>)}</div> : <p>聊天中选择的参考文件会在发送后进入当前项目。</p>}</section><section><div className="inspector-section-title"><h4>全局素材库</h4><span>{libraryAssets.length}</span></div><div className="preview-library-strip">{libraryAssets.slice(0, 6).map(asset => { const selected = selectedAssets.some(item => item.id === asset.id); return <button key={asset.id} disabled={selected} aria-label={`${selected ? "已选择" : "加入提示"} ${assetName(asset)}`} onClick={() => onSelect(asset)}><AssetReferenceThumb asset={asset}/><span>{selected ? <Check/> : <Plus/>}</span></button>; })}</div></section><p className="preview-inspector-hint">选择任意参考文件后可在左侧对话中补充用途，并随剧本、分镜一起创作。</p></aside>;
}

function InlineArtifactPreview({ preview, onClose }: { preview: { artifact: Artifact; content: string; loading: boolean; error: string }; onClose: () => void }) {
  const markdown = /\.md(?:own)?$/i.test(preview.artifact.path); const [source, setSource] = useState(false);
  useEffect(() => setSource(false), [preview.artifact.id]);
  return <section className="artifact-inline-preview" aria-label={`${preview.artifact.label}预览`}><header><button aria-label="返回项目产物" onClick={onClose}><ArrowLeft/></button><div><small>产物预览</small><h2>{preview.artifact.label}</h2><span>{preview.artifact.path}</span></div>{markdown ? <div className="artifact-view-toggle" role="tablist" aria-label="产物查看方式"><button role="tab" aria-selected={!source} className={!source ? "active" : ""} onClick={() => setSource(false)}>预览</button><button role="tab" aria-selected={source} className={source ? "active" : ""} onClick={() => setSource(true)}>源码</button></div> : null}</header><div>{preview.loading ? <div className="artifact-preview-state"><CircleNotch className="spin"/>正在读取产物…</div> : preview.error ? <div className="artifact-preview-state artifact-preview-state--error"><Warning/>{preview.error}</div> : markdown && !source ? <div className="markdown-body"><Suspense fallback={<div className="artifact-preview-state">正在加载预览…</div>}><MarkdownPreview>{preview.content}</MarkdownPreview></Suspense></div> : <pre className="artifact-source">{preview.content}</pre>}</div></section>;
}

function formatTimestamp(seconds: number) { const minutes = Math.floor(seconds / 60); return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(1).padStart(4, "0")}`; }
function canvasTabLabel(tab: CanvasTab) { return ({ preview: "预览", storyboard: "分镜", assets: "素材", artifacts: "产物" } as const)[tab]; }
function savedCanvasTab(projectId: string): CanvasTab { const value = readStringSetting(`yingya-canvas-tab:${projectId}`, "preview"); return value === "storyboard" || value === "assets" || value === "artifacts" ? value : "preview"; }
function savedVersionId(project: ProjectDetail) { const fallback = project.manifest.currentDraft ?? project.manifest.versions.at(-1)?.id ?? ""; const saved = readStringSetting(`yingya-version:${project.id}`, fallback); return project.manifest.versions.some(version => version.id === saved) ? saved : fallback; }
function restoreVideoTime(video: HTMLVideoElement, key: string) { const saved = readNumberSetting(key, 0); if (saved > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(saved, Math.max(0, video.duration - .1)); }
function saveVideoTime(video: HTMLVideoElement, key: string) { if (Number.isFinite(video.currentTime) && video.currentTime > 0) writeNumberSetting(key, video.currentTime); }
function assetName(asset: AssetLibraryItem) { return asset.sourceName?.trim() || asset.prompt?.trim() || "未命名素材"; }
function displayFileName(name: string) { return name.replace(/(\.[a-z0-9]{1,10})\1$/i, "$1"); }
function assetTypeLabel(asset: AssetLibraryItem) { return ({ image: "图片", video: "视频", audio: "音频", document: "文档", file: "文件" } as const)[asset.category]; }
function assetFileName(asset: AssetLibraryItem) {
  const safeName = (asset.sourceName || asset.prompt || asset.id).replace(/[\\/:*?"<>|]/g, "-").slice(0, 64);
  if (/\.[a-z0-9]{1,10}$/i.test(safeName)) return safeName;
  const extension = asset.mimeType.split("/")[1]?.replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "bin";
  return `${safeName}.${extension}`;
}
function AssetReferenceThumb({ asset }: { asset: AssetLibraryItem }) {
  if (asset.category === "image") return <span className="asset-reference-thumb"><img src={asset.url} alt=""/></span>;
  if (asset.category === "video") return <span className="asset-reference-thumb"><VideoCamera/></span>;
  if (asset.category === "audio") return <span className="asset-reference-thumb"><FileAudio/></span>;
  if (asset.category === "document") return <span className="asset-reference-thumb"><FileText/></span>;
  return <span className="asset-reference-thumb"><File/></span>;
}
async function uploadLibraryAsset(projectId: string, asset: AssetLibraryItem) {
  const response = await fetch(asset.url);
  if (!response.ok) throw new Error(`无法读取素材：${assetName(asset)}`);
  const blob = await response.blob();
  return api.uploadAsset(projectId, new window.File([blob], assetFileName(asset), { type: asset.mimeType }));
}
function normalizeLocalUrl(value: string) {
  const url = new URL(value, window.location.href);
  if (["0.0.0.0", "127.0.0.1", "localhost"].includes(url.hostname)) url.hostname = window.location.hostname;
  return url.toString();
}
function withReloadKey(value: string, reloadKey: number) {
  const url = new URL(value, window.location.href);
  url.searchParams.set("yingyaReload", String(reloadKey));
  return url.toString();
}
function savedWidth(key: string, fallback: number) { return readNumberSetting(key, fallback); }
