import type { Artifact, MediaAsset, ProjectDetail } from "./types";
import { filePreviewKind, projectFilePath } from "./projectFiles";

export type ContentFile = { path: string; name: string; size: number; modifiedAt: number };
export const contentCategories = [
  { id: "all", label: "全部" }, { id: "video", label: "视频" },
  { id: "image", label: "图片" }, { id: "audio", label: "音频" },
  { id: "document", label: "文档" }, { id: "other", label: "其他" },
] as const;
export type ContentCategory = typeof contentCategories[number]["id"];
export const contentGroups = [
  { id: "versions", label: "成片与版本", description: "已保存的视频版本" },
  { id: "documents", label: "方案与文稿", description: "方案、脚本与参考资料" },
  { id: "media", label: "素材", description: "图片、视频与声音" },
  { id: "production", label: "制作文件", description: "字幕数据、检查报告与工程文件" },
] as const;
export type ContentGroup = typeof contentGroups[number]["id"];
export type ProjectContent = Artifact & { group: ContentGroup; currentVersion: boolean; source?: string };

export function contentCategory(artifact: Artifact): ContentCategory {
  const kind = filePreviewKind(artifact.path);
  if (kind === "video" || kind === "image" || kind === "audio") return kind;
  if (kind === "markdown" || /\.(pdf|txt|csv|json|docx|xlsx|pptx|html?)$/i.test(artifact.path)) return "document";
  return "other";
}

export function collectProjectContents(project: ProjectDetail, files: ContentFile[], assets: MediaAsset[]): ProjectContent[] {
  const byPath = new Map<string, Artifact>();
  function add(artifact: Artifact) {
    const path = projectFilePath(artifact.path, project.id);
    if (!path) return;
    const previous = byPath.get(path);
    byPath.set(path, { ...previous, ...artifact, path, id: path, version: artifact.version ?? previous?.version, metadata: { ...previous?.metadata, ...artifact.metadata, modifiedAt: Math.max(Number(previous?.metadata.modifiedAt ?? 0), Number(artifact.metadata.modifiedAt ?? 0)) } });
  }
  for (const file of files) add({ id: file.path, path: file.path, label: file.name, kind: "file", version: undefined, metadata: { size: file.size, modifiedAt: file.modifiedAt } });
  for (const asset of assets) add({ id: asset.id, path: asset.projectPath, label: asset.name, kind: asset.kind, version: undefined, metadata: { modifiedAt: asset.createdAt } });
  for (const version of project.manifest.versions) {
    if (version.videoPath) add({ id: version.id, path: version.videoPath, label: version.label, kind: "video", version: version.id, metadata: { modifiedAt: version.createdAt } });
    if (version.reportPath) add({ id: `${version.id}-report`, path: version.reportPath, label: `${version.label}检查报告`, kind: "report", version: version.id, metadata: { modifiedAt: version.createdAt } });
  }
  for (const artifact of project.manifest.artifacts) add(artifact);
  const mediaByPath = new Map(assets.map(asset => [projectFilePath(asset.projectPath, project.id), asset]));
  const versionsByPath = new Map(project.manifest.versions.map(version => [projectFilePath(version.videoPath, project.id), version]));
  const reports = new Set(project.manifest.versions.flatMap(version => version.reportPath ? [projectFilePath(version.reportPath, project.id)] : []));
  return [...byPath.values()].map((artifact): ProjectContent => {
    const version = versionsByPath.get(artifact.path), media = mediaByPath.get(artifact.path);
    const category = contentCategory(artifact);
    // Only registered versions are promoted to finished work. Media registration
    // keeps imported reference data visible, including JSON supplied by the user.
    const group: ContentGroup = version ? "versions"
      : reports.has(artifact.path) || artifact.kind === "report" ? "production"
      : media ? (["video", "image", "audio"].includes(category) ? "media" : "documents")
      : ["plan", "script", "storyboard"].includes(artifact.kind) ? "documents"
      : artifact.path.startsWith(".yingya/") ? "production"
      : ["video", "image", "audio"].includes(category) ? "media"
      : category === "document" && !/\.json$/i.test(artifact.path) ? "documents" : "production";
    return { ...artifact, group, currentVersion: Boolean(version && version.id === project.manifest.currentDraft), source: media?.source };
  }).sort((a, b) => Number(b.metadata.modifiedAt ?? 0) - Number(a.metadata.modifiedAt ?? 0) || a.path.localeCompare(b.path));
}
