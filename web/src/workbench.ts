import type { MediaScene, ProjectDetail, SourceBinding } from "./types";

export const assetRoleLabels = { auto: "自动判断", source: "主要内容", required: "必须使用", supplement: "补充素材", brand: "品牌素材", reference: "仅供参考" } as const;
export const materialOnlyPrompt = "请先分析我提供的素材，说明内容、可用片段和不确定之处，再提出制作方案供我确认。此阶段只分析与规划，确认方案后再开始制作视频。";
export const regeneratePreviewPrompt = "请基于当前已保存的镜头修改生成新版预览。沿用现有素材、源起止、镜头顺序和音轨，仅应用已保存的镜头标题、效果与聚焦区域；保留其他镜头与原声安排，不重新选段或重写组件。完成实际视频校验后注册新的预览版本。";
export function fileRoleKey(file: Pick<File, "name" | "size" | "lastModified">) { return `file:${file.name}:${file.size}:${file.lastModified}`; }
export function sourceClip(scene: MediaScene, bindings: SourceBinding[] = []) {
  const bound = bindings.find(item => item.id === scene.id);
  const authored = scene.sourceClip && typeof scene.sourceClip === "object" ? scene.sourceClip as Record<string, unknown> : undefined;
  const source = bound?.mediaSrc ?? (typeof authored?.source === "string" ? authored.source : undefined);
  const sourceIn = bound?.sourceIn ?? authored?.sourceIn;
  const sourceOut = bound?.sourceOut ?? authored?.sourceOut;
  if (!source || typeof sourceIn !== "number" || typeof sourceOut !== "number" || !Number.isFinite(sourceIn) || !Number.isFinite(sourceOut) || sourceIn < 0 || sourceOut <= sourceIn) return undefined;
  return { source, sourceIn, sourceOut, audioMode: bound?.audioMode ?? authored?.audioMode };
}
export function sceneStart(scene: MediaScene, bindings: SourceBinding[] = []) {
  const value = bindings.find(item => item.id === scene.id)?.startSeconds ?? scene.startSeconds;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
export function sceneAtTime(scenes: MediaScene[], bindings: SourceBinding[], time: number) {
  return scenes.find(scene => {
    const start = sceneStart(scene, bindings);
    const clip = sourceClip(scene, bindings);
    const duration = bindings.find(item => item.id === scene.id)?.durationSeconds ?? scene.durationSeconds ?? (clip ? clip.sourceOut - clip.sourceIn : undefined);
    return start !== undefined && typeof duration === "number" && time >= start && time < start + duration;
  });
}
export function sceneTitle(scene: MediaScene) {
  return typeof scene.onScreenText === "string" ? scene.onScreenText : Array.isArray(scene.onScreenText) ? scene.onScreenText.filter(v => typeof v === "string").join(" · ") : typeof scene.title === "string" ? scene.title : "";
}
export function sourceFilePath(sourcePath: string, relative: string) {
  if (/^(?:[a-z]+:|\/)/i.test(relative)) return undefined;
  const parts = [...sourcePath.split("/"), ...relative.split("/")].filter(part => part && part !== ".");
  if (parts.includes("..")) return undefined;
  return parts.join("/");
}
export function defaultExportFps(project: Pick<ProjectDetail, "manifest">) {
  const value = project.manifest.outputSpec.fps ?? project.manifest.outputSpec.frameRate;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 120 ? value : 30;
}
export function selectedProjectVersion(project: ProjectDetail, requested: string) {
  return project.manifest.versions.find(version => version.id === requested)
    ?? project.manifest.versions.find(version => version.id === project.manifest.currentDraft)
    ?? project.manifest.versions.at(-1);
}
