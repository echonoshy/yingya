import type { ProjectDetail, ProjectRecord } from "./types";

export type ProjectGroup = "active" | "review" | "completed" | "failed";
export function projectGroup(project: ProjectRecord): ProjectGroup {
  if (project.activeTurnId || ["starting", "queued", "running"].includes(project.status)) return "active";
  if (["failed", "incomplete", "interrupted"].includes(project.status)) return "failed";
  if (project.workflowStatus) return project.workflowStatus;
  if (project.status === "completed") return "completed";
  return "review";
}
export function projectStatus(project: ProjectRecord): string {
  const group = projectGroup(project);
  if (group === "active") return project.activeTurnId ? "正在制作" : "等待处理";
  if (group === "failed") return project.status === "incomplete" ? "制作待收尾" : project.status === "interrupted" ? "制作已中断" : "制作失败";
  return project.workflowLabel || project.statusLabel;
}
export function workflowState(project: ProjectDetail) {
  const running = projectGroup(project) === "active";
  const hasVideo = project.manifest.versions.some(version => version.videoPath) || project.manifest.artifacts.some(artifact => artifact.kind.includes("video"));
  const checkpoint = !running && !project.queue.length ? project.manifest.checkpoint : undefined;
  const sourceNotice = hasVideo && project.manifest.dirty && !checkpoint && !running ? "源文件有更新，当前草稿可能尚未包含这些修改。" : "";
  const label = running || projectGroup(project) === "failed" ? projectStatus(project) : project.manifest.phase === "briefing" ? "等待补充要求" : checkpoint ? (checkpoint.kind === "plan" ? "制作方案待确认" : "草稿待确认") : project.manifest.dirty ? (hasVideo ? "修改待检查" : "制作待检查") : projectStatus(project);
  return { running, hasVideo, checkpoint, label, sourceNotice };
}

export function projectSummary(project: ProjectDetail): ProjectRecord {
  const state = workflowState(project);
  const review = !state.running && projectGroup(project) !== "failed" && Boolean(state.checkpoint || project.manifest.dirty);
  return { ...project, workflowStatus: review ? "review" : undefined, workflowLabel: review ? state.label : undefined };
}
