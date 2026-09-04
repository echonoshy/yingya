import { ArrowClockwise, Check, CircleNotch, Code, DownloadSimple, FilmSlate, LinkBreak, Warning } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { DraftVersion, ProjectDetail, RenderJob } from "../types";

type StudioSession = Awaited<ReturnType<typeof api.studio>>;
type StudioState = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";
type RenderResolution = "landscape" | "landscape-4k" | "portrait" | "portrait-4k" | "square" | "square-4k";

const resolutionLabels: Record<RenderResolution, string> = {
  landscape: "1920 × 1080 p",
  "landscape-4k": "3840 × 2160 p",
  portrait: "1080 × 1920 p",
  "portrait-4k": "2160 × 3840 p",
  square: "1080 × 1080 p",
  "square-4k": "2160 × 2160 p",
};

function defaultResolution(aspectRatio: string): RenderResolution {
  if (aspectRatio === "9:16") return "portrait-4k";
  if (aspectRatio === "1:1") return "square-4k";
  return "landscape-4k";
}

function resolutionOptions(aspectRatio: string): RenderResolution[] {
  if (aspectRatio === "9:16") return ["portrait-4k", "portrait"];
  if (aspectRatio === "1:1") return ["square-4k", "square"];
  return ["landscape-4k", "landscape"];
}

export function LiveHyperFramesPreview({ project, active, available }: { project: ProjectDetail; active: boolean; available: boolean }) {
  const [session, setSession] = useState<StudioSession | null>(null);
  const [state, setState] = useState<StudioState>("idle");
  const [shouldConnect, setShouldConnect] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setSession(null);
    setState("idle");
    setShouldConnect(true);
    setError("");
    setReloadKey(0);
  }, [project.id]);

  useEffect(() => {
    if (!active || !available || !shouldConnect || session) return;
    let cancelled = false;
    setState(current => current === "idle" ? "connecting" : "reconnecting");
    setError("");
    void api.studio(project.id).then(result => {
      if (cancelled) return;
      setSession(result);
      setState("connected");
    }).catch(reason => {
      if (cancelled) return;
      setState("disconnected");
      setShouldConnect(false);
      setError(reason instanceof Error ? reason.message : "实时预览启动失败");
    });
    return () => { cancelled = true; };
  }, [active, available, project.id, session, shouldConnect]);

  useEffect(() => {
    if (!session || state !== "connected") return;
    const heartbeat = window.setInterval(() => {
      void api.heartbeatStudio(project.id).then(next => {
        setSession(next);
      }).catch(reason => {
        setState("reconnecting");
        setError(reason instanceof Error ? reason.message : "Studio 会话连接已中断");
        setSession(null);
      });
    }, 60_000);
    return () => window.clearInterval(heartbeat);
  }, [project.id, session, state]);

  async function disconnect() {
    setError("");
    try { await api.stopStudio(project.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法断开 Studio"); }
    finally { setShouldConnect(false); setSession(null); setState("disconnected"); }
  }

  const previewUrl = session ? withReloadKey(session.storyboardUrl, reloadKey) : "";
  const connectionLabel = state === "connected" ? "已连接" : state === "connecting" ? "正在连接" : state === "reconnecting" ? "正在重连" : state === "disconnected" ? "已断开" : "等待连接";
  return <section className="live-preview-panel" hidden={!active} aria-label="HyperFrames 实时画面">
    <div className="live-preview-toolbar">
      <div><b>HyperFrames 实时画面</b><span className={`studio-connection studio-connection--${state}`}><i aria-hidden="true"/>{connectionLabel}</span></div>
      {session ? <div>
        <button type="button" aria-label="刷新实时画面" title="刷新实时画面" onClick={() => setReloadKey(value => value + 1)}><ArrowClockwise/></button>
        <button type="button" onClick={() => window.open(session.previewUrl, "_blank", "noopener,noreferrer")}><Code/>编辑源画面</button>
        <button type="button" aria-label="断开 Studio" title="断开 Studio" onClick={() => void disconnect()}><LinkBreak/></button>
      </div> : null}
    </div>
    {!available ? <div className="live-preview-state"><Code/><b>制作方案确认后开放</b><span>确认方向后，映芽会创建 HyperFrames Composition 并在这里实时显示。</span></div>
      : state === "connecting" || state === "reconnecting" ? <div className="live-preview-state"><CircleNotch className="spin"/><b>{connectionLabel}</b><span>首次打开需要启动本地 HyperFrames 服务。</span></div>
      : error ? <div className="live-preview-state live-preview-state--error"><Warning/><b>实时画面暂不可用</b><span>{error}</span><button type="button" onClick={() => { setError(""); setState("reconnecting"); setShouldConnect(true); }}>重新连接</button></div>
      : session ? <div className={`live-preview-frame ${project.aspectRatio === "9:16" ? "portrait" : project.aspectRatio === "1:1" ? "square" : ""}`}><iframe key={reloadKey} title="HyperFrames 实时画面" src={previewUrl} allow="autoplay; fullscreen"/></div>
      : <div className="live-preview-state"><LinkBreak/><b>Studio 已断开</b><span>重新连接后可以继续预览和编辑。</span><button type="button" onClick={() => { setState("reconnecting"); setShouldConnect(true); }}>重新连接</button></div>}
  </section>;
}

export function RenderPanel({ project, version, onRefresh }: { project: ProjectDetail; version?: DraftVersion; onRefresh: () => Promise<void> }) {
  const [resolution, setResolution] = useState<RenderResolution>(() => defaultResolution(project.aspectRatio));
  const [fps, setFps] = useState<30 | 60>(60);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");
  const activeJob = project.renderJobs.find(job => job.status === "queued" || job.status === "running");
  const rendering = requested || Boolean(activeJob);
  const options = useMemo(() => resolutionOptions(project.aspectRatio), [project.aspectRatio]);
  const finalVideo = [...project.manifest.artifacts].reverse().find(artifact => artifact.kind === "final-video" && artifact.version === version?.id);

  useEffect(() => setResolution(defaultResolution(project.aspectRatio)), [project.aspectRatio]);

  async function render(input: { versionId: string; resolution: RenderResolution; fps: 30 | 60 }) {
    if (rendering) return;
    setRequested(true);
    setError("");
    try {
      await api.renderVideo(project.id, input);
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "视频渲染失败");
    } finally {
      setRequested(false);
    }
  }

  function retry(job: RenderJob) {
    if (!isRenderResolution(job.resolution)) return;
    void render({ versionId: job.versionId, resolution: job.resolution, fps: job.fps });
  }

  return <section className="render-panel" aria-label="导出视频">
    <header><b>导出视频</b>{finalVideo ? <span className="render-ready"><Check/>已生成</span> : null}</header>
    {activeJob ? <div className="render-progress" role="status"><div><span style={{ width: `${Math.max(4, activeJob.progress)}%` }}/></div><p>{activeJob.message}</p></div> : null}
    <div className="render-options">
      <label><span>分辨率</span><select value={resolution} disabled={rendering} onChange={event => setResolution(event.target.value as RenderResolution)}>{options.map(value => <option value={value} key={value}>{resolutionLabels[value]}</option>)}</select></label>
      <label><span>帧率</span><select value={fps} disabled={rendering} onChange={event => setFps(Number(event.target.value) as 30 | 60)}><option value={60}>60 FPS</option><option value={30}>30 FPS</option></select></label>
    </div>
    <div className="render-actions">
      <button className="render-primary" disabled={rendering || Boolean(project.activeTurnId) || !version} onClick={() => version && void render({ versionId: version.id, resolution, fps })}>{rendering ? <CircleNotch className="spin"/> : <FilmSlate/>}{rendering ? "正在后台渲染…" : `渲染 ${resolutionLabels[resolution]} 成片`}</button>
      {finalVideo ? <a className="render-download" href={api.fileUrl(project.id, finalVideo.path)} download><DownloadSimple/>下载成片</a> : null}
    </div>
    {project.activeTurnId ? <p className="render-hint">当前修改完成后即可渲染。</p> : null}
    {error ? <p className="render-error" role="alert"><Warning/>{error}</p> : null}
    {project.renderJobs.length ? <details className="render-history"><summary>渲染历史 <span>{project.renderJobs.length}</span></summary><div>
      {project.renderJobs.map(job => <article key={job.id}>
        <div className={`render-history-status render-history-status--${job.status}`}>{job.status === "completed" ? <Check/> : job.status === "running" || job.status === "queued" ? <CircleNotch className="spin"/> : <Warning/>}<span>{renderStatusLabel(job.status)}</span></div>
        <div className="render-history-copy"><b>{resolutionLabels[job.resolution as RenderResolution] ?? job.resolution} · {job.fps} FPS</b><small>{formatJobTime(job.startedAt)} · {versionLabel(project, job.versionId)}</small>{job.error ? <p>{job.error}</p> : null}</div>
        <div className="render-history-actions">{job.status === "completed" && job.outputPath ? <a href={api.fileUrl(project.id, job.outputPath)} download aria-label="下载这次成片"><DownloadSimple/></a> : null}{(job.status === "failed" || job.status === "interrupted") && isRenderResolution(job.resolution) ? <button type="button" disabled={rendering} onClick={() => retry(job)}>重试</button> : null}</div>
      </article>)}
    </div></details> : null}
  </section>;
}

function withReloadKey(value: string, reloadKey: number) {
  const url = new URL(normalizeLocalUrl(value));
  url.searchParams.set("yingyaReload", String(reloadKey));
  return url.toString();
}

function normalizeLocalUrl(value: string) {
  const url = new URL(value, window.location.href);
  if (["0.0.0.0", "127.0.0.1", "localhost"].includes(url.hostname)) url.hostname = window.location.hostname;
  return url.toString();
}

function isRenderResolution(value: string): value is RenderResolution {
  return value in resolutionLabels;
}

function renderStatusLabel(status: RenderJob["status"]) {
  return status === "queued" ? "等待中" : status === "running" ? "渲染中" : status === "completed" ? "已完成" : status === "interrupted" ? "已中断" : "失败";
}

function formatJobTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}

function versionLabel(project: ProjectDetail, versionId: string) {
  return project.manifest.versions.find(version => version.id === versionId)?.label ?? versionId;
}
