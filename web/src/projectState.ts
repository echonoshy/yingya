import type { ProjectDetail, ProjectRecord } from "./types";

export type ProjectGroup = "active" | "review" | "ready" | "completed" | "failed";
export function projectGroup(project: ProjectRecord): ProjectGroup {
  if (project.activeTurnId || ["starting", "queued", "running"].includes(project.status)) return "active";
  if (project.workflowStatus === "active") return "active";
  if (["failed", "incomplete", "interrupted"].includes(project.status)) return "failed";
  if (project.workflowStatus) return project.workflowStatus;
  if (project.status === "completed") return "completed";
  if (project.status === "draft_review") return "ready";
  return "review";
}
export function projectStatus(project: ProjectRecord): string {
  const group = projectGroup(project);
  if (group === "active") return project.workflowLabel === "正在导出" ? "正在导出" : project.activeTurnId ? "正在制作" : "等待处理";
  if (group === "failed") return project.status === "incomplete" ? "制作待收尾" : project.status === "interrupted" ? "制作已中断" : "制作失败";
  return project.workflowLabel || (group === "ready" ? "视频可导出" : group === "completed" ? "当前版本已导出" : project.statusLabel);
}
export function workflowState(project: ProjectDetail) {
  const rendering = project.renderJobs.some(job => job.status === "queued" || job.status === "running");
  const running = Boolean(project.activeTurnId || ["starting", "queued", "running"].includes(project.status) || rendering);
  const version = project.manifest.versions.find(v => v.id === project.manifest.currentDraft) ?? project.manifest.versions.at(-1);
  const hasVideo = Boolean(version?.videoPath);
  const exported = Boolean(version && project.manifest.artifacts.some(a => a.kind === "final-video" && a.version === version.id));
  const checkpoint = !running && !project.queue.length ? project.manifest.checkpoint : undefined;
  const sourceNotice = hasVideo && project.manifest.dirty && !checkpoint && !running ? "源文件有更新，当前视频可能尚未包含这些修改。" : "";
  let group: ProjectGroup = "review";
  let label = "等待继续制作";
  if (running) { group = "active"; label = rendering && !project.activeTurnId ? "正在导出" : "正在制作"; }
  else if (["failed", "incomplete", "interrupted"].includes(project.status)) { group = "failed"; label = projectStatus(project); }
  else if (project.manifest.phase === "briefing") label = "等待补充要求";
  else if (checkpoint?.kind === "plan") label = "制作方案待确认";
  else if (hasVideo) {
    group = exported ? "completed" : "ready";
    label = group === "completed" ? (project.manifest.dirty ? "已导出 · 源文件有更新" : "当前版本已导出") : sourceNotice ? "已有视频 · 源文件有更新" : "视频可导出";
  }
  return { running, hasVideo, checkpoint, label, sourceNotice, group };
}

export function projectSummary(project: ProjectDetail): ProjectRecord {
  const state = workflowState(project);
  return { ...project, workflowStatus: state.group, workflowLabel: state.label };
}
