import { createPortal } from "react-dom";
import { ActionDialog } from "./ActionDialog";
import "./render-panel.css";
import { SelectControl } from "./SelectControl";
import { Check, CircleNotch, DownloadSimple, FilmSlate, Warning, CaretDown } from "@phosphor-icons/react";
import { ShareDialog, type ShareSource } from "../sharing/ShareDialog";
import { ShareNetwork } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { sourceFilePath } from "../workbench";
import { api } from "../api";
import type { DraftVersion, ProjectDetail, RenderJob } from "../types";

type RenderResolution = "landscape" | "landscape-4k" | "portrait" | "portrait-4k" | "square" | "square-4k";

const renderConfigSchema = z.object({
  engine: z.literal("remotion"),
  composition: z.object({ fps: z.number().int().min(1).max(120) }),
});

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

export function RenderPanel({ project, version, videoPath, exportRequest = 0, onRefresh }: { project: ProjectDetail; version?: DraftVersion; videoPath?: string; exportRequest?: number; onRefresh: () => Promise<void> }) {
  const [dialogOpen, setDialogOpen] = useState(Boolean(exportRequest));
  const [sharing, setSharing] = useState<ShareSource | null>(null);
  const [resolution, setResolution] = useState<RenderResolution>(() => defaultResolution(project.aspectRatio));
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");
  const activeJob = project.renderJobs.find(job => job.status === "queued" || job.status === "running");
  const rendering = requested || Boolean(activeJob);
  const [exportOpen, setExportOpen] = useState(Boolean(activeJob));
  useEffect(() => { if (exportRequest) setDialogOpen(true); }, [exportRequest]);
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

  async function render(input: { versionId: string; resolution: RenderResolution }) {
    if (rendering) return;
    setRequested(true);
    setError("");
    try {
      // Read the immutable version being exported, including historical retries.
      // Current project metadata and a previous failed job may have a different FPS.
      let fps: number;
      try {
        const selected = project.manifest.versions.find(item => item.id === input.versionId);
        if (!selected) throw new Error("Missing version");
        const source = selected.sourcePath.endsWith(".html")
          ? selected.sourcePath.slice(0, selected.sourcePath.lastIndexOf("/") + 1) || "."
          : selected.sourcePath;
        const configPath = sourceFilePath(source, "remotion.json");
        if (!configPath) throw new Error("Invalid version path");
        const config = renderConfigSchema.parse(JSON.parse(await api.readProjectFile(project.id, configPath)));
        fps = config.composition.fps;
      } catch {
        throw new Error("暂时无法读取这个版本的导出信息，请重试。");
      }
      await api.renderVideo(project.id, { ...input, fps });
      await onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "视频导出失败");
    } finally {
      setRequested(false);
    }
  }

  function retry(job: RenderJob) {
    if (!isRenderResolution(job.resolution)) return;
    void render({ versionId: job.versionId, resolution: job.resolution });
  }

  // Keep request, error and export choices alive when the delivery dialog closes.
  if (!dialogOpen) return null;
  const panel = <ActionDialog title="分享与下载" className="video-delivery-dialog" closeLabel="关闭分享与下载" onClose={() => setDialogOpen(false)}>
    <p className="delivery-version">{version?.label ?? "视频生成后，可在这里分享或下载。"}</p>
    <section className="render-panel" aria-label="视频分享与导出">
    {source ? <div className="current-video-actions">
      <p className="render-existing-spec">{downloadSpec}</p>
      <div className="current-video-buttons">
        <button className="render-download" aria-label="分享当前视频" onClick={() => setSharing(source)}><ShareNetwork/>分享</button>
        <a className="render-download" href={api.fileUrl(project.id, source.path)} download aria-label="下载当前视频"><DownloadSimple/>下载 MP4</a>
      </div>
    </div> : null}
    {version ? <details className="export-settings" open={exportOpen} onToggle={event => setExportOpen(event.currentTarget.open)}>
      <summary>导出其他规格{rendering ? <span><CircleNotch className="spin"/>导出中</span> : null}<CaretDown className="export-chevron"/></summary>
      <p className="render-hint">导出当前所选的已保存版本，不包含之后的修改。</p>
      {activeJob ? <div className="render-progress" role="status"><div><span style={{ width: `${Math.max(4, activeJob.progress)}%` }}/></div><p>{activeJob.status === "queued" ? "等待导出" : `已完成 ${Math.round(activeJob.progress)}%`}</p></div> : null}
    <div className="render-options">
      <label><span>分辨率</span><SelectControl aria-label="分辨率" value={resolution} disabled={rendering} onChange={event => setResolution(event.target.value as RenderResolution)}>{options.map(value => <option value={value} key={value}>{resolutionLabels[value]}</option>)}</SelectControl></label>
    </div>
    <div className="render-actions">
      <button className="render-primary" disabled={rendering || Boolean(project.activeTurnId) || !version} onClick={() => version && void render({ versionId: version.id, resolution })}>{rendering ? <CircleNotch className="spin"/> : <FilmSlate/>}{rendering ? "正在导出 MP4…" : editableSnapshot ? "导出此版本" : project.manifest.dirty ? "导出已有版本" : "开始导出"}</button>
    </div>
    {project.activeTurnId ? <p className="render-hint">当前修改完成后可导出</p> : null}
    {error ? <p className="render-error" role="alert"><Warning/>{error}</p> : null}
    {project.renderJobs.length ? <details className="render-history"><summary>导出历史 <span>{project.renderJobs.length}</span></summary><div>
      {project.renderJobs.map(job => <article key={job.id}>
        <div className={`render-history-status render-history-status--${job.status}`}>{job.status === "completed" ? <Check/> : job.status === "running" || job.status === "queued" ? <CircleNotch className="spin"/> : <Warning/>}<span>{renderStatusLabel(job.status)}</span></div>
        <div className="render-history-copy"><b>{resolutionLabels[job.resolution as RenderResolution] ?? job.resolution} · {job.fps} FPS</b><small>{formatJobTime(job.startedAt)} · {versionLabel(project, job.versionId)}</small>{job.error ? <p>{job.error}</p> : null}</div>
        <div className="render-history-actions">{job.status === "completed" && job.outputPath ? <a href={api.fileUrl(project.id, job.outputPath)} download aria-label="下载这次导出的视频"><DownloadSimple/></a> : null}{(job.status === "failed" || job.status === "interrupted") && isRenderResolution(job.resolution) ? <button type="button" disabled={rendering} onClick={() => retry(job)}>重试</button> : null}</div>
      </article>)}
    </div></details> : null}
    </details> : null}
    </section>
    {sharing ? <ShareDialog projectId={project.id} title={project.title} source={sharing} onClose={() => setSharing(null)}/> : null}
  </ActionDialog>;
  return typeof document === "undefined" ? panel : createPortal(panel, document.body);
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
