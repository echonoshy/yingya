import type { Artifact, MediaAsset, ProjectDetail } from "./types";
import { filePreviewKind, projectFilePath } from "./projectFiles";

export type ContentFile = { path: string; name: string; size: number; modifiedAt: number };
export const contentCategories = [
  { id: "all", label: "全部" }, { id: "video", label: "视频" },
  { id: "image", label: "图片" }, { id: "audio", label: "音频" },
  { id: "document", label: "文档" }, { id: "other", label: "其他" },
] as const;
export type ContentCategory = typeof contentCategories[number]["id"];

export function contentCategory(artifact: Artifact): ContentCategory {
  const kind = filePreviewKind(artifact.path);
  if (kind === "video" || kind === "image" || kind === "audio") return kind;
  if (kind === "markdown" || /\.(pdf|txt|csv|json|docx|xlsx|pptx|html?)$/i.test(artifact.path)) return "document";
  return "other";
}

export function collectProjectContents(project: ProjectDetail, files: ContentFile[], assets: MediaAsset[]): Artifact[] {
  const byPath = new Map<string, Artifact>();
  function add(artifact: Artifact) {
    const path = projectFilePath(artifact.path, project.id);
    if (!path) return;
    const previous = byPath.get(path);
    byPath.set(path, { ...previous, ...artifact, path, id: path, metadata: { ...previous?.metadata, ...artifact.metadata, modifiedAt: Math.max(Number(previous?.metadata.modifiedAt ?? 0), Number(artifact.metadata.modifiedAt ?? 0)) } });
  }
  for (const file of files) add({ id: file.path, path: file.path, label: file.name, kind: "file", version: undefined, metadata: { size: file.size, modifiedAt: file.modifiedAt } });
  for (const asset of assets) add({ id: asset.id, path: asset.projectPath, label: asset.name, kind: asset.kind, version: undefined, metadata: { modifiedAt: asset.createdAt } });
  for (const version of project.manifest.versions) {
    if (version.videoPath) add({ id: version.id, path: version.videoPath, label: version.label, kind: "video", version: version.id, metadata: { modifiedAt: version.createdAt } });
    if (version.reportPath) add({ id: `${version.id}-report`, path: version.reportPath, label: `${version.label}检查报告`, kind: "report", version: version.id, metadata: { modifiedAt: version.createdAt } });
  }
  for (const artifact of project.manifest.artifacts) add(artifact);
  return [...byPath.values()].sort((a, b) => Number(b.metadata.modifiedAt ?? 0) - Number(a.metadata.modifiedAt ?? 0) || a.path.localeCompare(b.path));
}
