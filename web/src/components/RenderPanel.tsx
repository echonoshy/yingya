import { Check, CircleNotch, DownloadSimple, FilmSlate, Warning, DotsThree, CaretDown } from "@phosphor-icons/react";
import { ShareDialog, type ShareSource } from "../sharing/ShareDialog";
import { ShareNetwork } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultExportFps } from "../workbench";
import { api } from "../api";
import type { DraftVersion, ProjectDetail, RenderJob } from "../types";

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
  if (aspectRatio === "9:16") return "portrait";
  if (aspectRatio === "1:1") return "square";
  return "landscape";
}

function resolutionOptions(aspectRatio: string): RenderResolution[] {
  if (aspectRatio === "9:16") return ["portrait", "portrait-4k"];
  if (aspectRatio === "1:1") return ["square", "square-4k"];
  return ["landscape", "landscape-4k"];
}

export function RenderPanel({ project, version, videoPath, exportRequest = 0, onRefresh }: { project: ProjectDetail; version?: DraftVersion; videoPath?: string; exportRequest?: number; onRefresh: () => Promise<void>; onGeneratePreview?: () => void; generationDisabled?: boolean }) {
  const [sharing, setSharing] = useState<ShareSource | null>(null);
  const [resolution, setResolution] = useState<RenderResolution>(() => defaultResolution(project.aspectRatio));
  const [fps, setFps] = useState(() => defaultExportFps(project));
  const projectFps = defaultExportFps(project);
  useEffect(() => setFps(projectFps), [project.id, projectFps]);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");
  const activeJob = project.renderJobs.find(job => job.status === "queued" || job.status === "running");
  const rendering = requested || Boolean(activeJob);
  const [exportOpen, setExportOpen] = useState(Boolean(activeJob));
  useEffect(() => { if (exportRequest) setExportOpen(true); }, [exportRequest]);
  useEffect(() => { if (activeJob) setExportOpen(true); }, [activeJob?.id]);
  const options = useMemo(() => resolutionOptions(project.aspectRatio), [project.aspectRatio]);
  const videoArtifact = project.manifest.artifacts.find(artifact => artifact.path === videoPath && artifact.version === version?.id && ["final-video", "video", "draft-video"].includes(artifact.kind));
  const source: ShareSource | null = !version || !videoPath ? null
    : videoArtifact?.kind === "final-video" ? { artifactId: videoArtifact.id, path: videoPath, label: version.label }
    : videoPath === version.videoPath ? { versionId: version.id, path: videoPath, label: version.label }
    : videoArtifact ? { artifactId: videoArtifact.id, path: videoPath, label: version.label } : null;
  const editableSnapshot = Boolean(version?.id.startsWith("editor-"));
  const finalJob = project.renderJobs.find(job => job.status === "completed" && job.outputPath === videoPath);
  const recordedResolution = finalJob ? resolutionLabels[finalJob.resolution as RenderResolution] ?? finalJob.resolution : videoArtifact?.metadata.resolution;
  const recordedFps = finalJob?.fps ?? videoArtifact?.metadata.frameRate ?? videoArtifact?.metadata.fps;
  const downloadSpec = ["MP4", typeof recordedResolution === "string" ? recordedResolution : null, typeof recordedFps === "number" ? `${recordedFps} FPS` : null].filter(Boolean).join(" · ");
  useEffect(() => setResolution(defaultResolution(project.aspectRatio)), [project.aspectRatio]);

  async function render(input: { versionId: string; resolution: RenderResolution; fps: number }) {
    if (rendering) return;
    setRequested(true);
    setError("");
    try {
      await api.renderVideo(project.id, input);
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "视频导出失败");
    } finally {
      setRequested(false);
    }
  }

  function retry(job: RenderJob) {
    if (!isRenderResolution(job.resolution)) return;
    void render({ versionId: job.versionId, resolution: job.resolution, fps: job.fps });
  }

  return <section className="render-panel" aria-label="视频分享与导出">
    {source ? <div className="current-video-actions">
      <p className="render-existing-spec">{downloadSpec}</p>
      <div className="current-video-buttons">
        <button className="render-download" aria-label="分享当前视频" onClick={() => setSharing(source)}><ShareNetwork/>分享</button>
        <VideoDownloadMenu projectId={project.id} path={source.path}/>
      </div>
    </div> : null}
    <details className="export-settings" open={exportOpen} onToggle={event => setExportOpen(event.currentTarget.open)}>
      <summary>导出其他规格{rendering ? <span><CircleNotch className="spin"/>导出中</span> : null}<CaretDown className="export-chevron"/></summary>
      <p className="render-hint">{editableSnapshot ? "导出这个已保存版本；之后的修改需重新保存版本后导出。" : project.manifest.dirty ? "按所选分辨率和帧率导出已有版本，不包含未渲染的源文件修改。" : "按所选分辨率和帧率生成新的 MP4。"}</p>
      {activeJob ? <div className="render-progress" role="status"><div><span style={{ width: `${Math.max(4, activeJob.progress)}%` }}/></div><p>{activeJob.status === "queued" ? "等待导出" : `已完成 ${Math.round(activeJob.progress)}%`}</p></div> : null}
    <div className="render-options">
      <label><span>分辨率</span><select value={resolution} disabled={rendering} onChange={event => setResolution(event.target.value as RenderResolution)}>{options.map(value => <option value={value} key={value}>{resolutionLabels[value]}</option>)}</select></label>
      <label><span>帧率</span><select value={fps} disabled={rendering} onChange={event => setFps(Number(event.target.value))}>{[...new Set([projectFps, 30, 60])].map(value => <option value={value} key={value}>{value} FPS{value === projectFps ? " · 项目帧率" : ""}</option>)}</select></label>
    </div>
    <div className="render-actions">
      <button className="render-primary" disabled={rendering || Boolean(project.activeTurnId) || !version} onClick={() => version && void render({ versionId: version.id, resolution, fps })}>{rendering ? <CircleNotch className="spin"/> : <FilmSlate/>}{rendering ? "正在导出 MP4…" : editableSnapshot ? "导出此版本" : project.manifest.dirty ? "导出已有版本" : "开始导出"}</button>
    </div>
    {project.activeTurnId ? <p className="render-hint">当前修改完成后可导出。</p> : null}
    {error ? <p className="render-error" role="alert"><Warning/>{error}</p> : null}
    {project.renderJobs.length ? <details className="render-history"><summary>导出历史 <span>{project.renderJobs.length}</span></summary><div>
      {project.renderJobs.map(job => <article key={job.id}>
        <div className={`render-history-status render-history-status--${job.status}`}>{job.status === "completed" ? <Check/> : job.status === "running" || job.status === "queued" ? <CircleNotch className="spin"/> : <Warning/>}<span>{renderStatusLabel(job.status)}</span></div>
        <div className="render-history-copy"><b>{resolutionLabels[job.resolution as RenderResolution] ?? job.resolution} · {job.fps} FPS</b><small>{formatJobTime(job.startedAt)} · {versionLabel(project, job.versionId)}</small>{job.error ? <p>{job.error}</p> : null}</div>
        <div className="render-history-actions">{job.status === "completed" && job.outputPath ? <a href={api.fileUrl(project.id, job.outputPath)} download aria-label="下载这次导出的视频"><DownloadSimple/></a> : null}{(job.status === "failed" || job.status === "interrupted") && isRenderResolution(job.resolution) ? <button type="button" disabled={rendering} onClick={() => retry(job)}>重试</button> : null}</div>
      </article>)}
    </div></details> : null}
    </details>
    {sharing ? <ShareDialog projectId={project.id} title={project.title} source={sharing} onClose={() => setSharing(null)}/> : null}
  </section>;
}

function VideoDownloadMenu({ projectId, path }: { projectId: string; path: string }) {
  const root = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) root.current.open = false; };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => { if (root.current) root.current.open = false; }, [path]);
  return <details className="video-download-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={event => {
    if (event.key === "Escape" && event.currentTarget.open) {
      event.preventDefault(); event.stopPropagation(); event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="更多视频操作" title="更多视频操作"><DotsThree/></summary>
    <a href={api.fileUrl(projectId, path)} download aria-label="下载当前视频" onClick={() => { if (root.current) root.current.open = false; }}><DownloadSimple/>下载 MP4</a>
  </details>;
}

function isRenderResolution(value: string): value is RenderResolution {
  return value in resolutionLabels;
}

function renderStatusLabel(status: RenderJob["status"]) {
  return status === "queued" ? "等待中" : status === "running" ? "导出中" : status === "completed" ? "已完成" : status === "interrupted" ? "已中断" : "失败";
}

function formatJobTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}

function versionLabel(project: ProjectDetail, versionId: string) {
  return project.manifest.versions.find(version => version.id === versionId)?.label.replace(/草稿/g, "视频") ?? versionId;
}
