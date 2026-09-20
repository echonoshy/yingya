import { z } from "zod";
export const sceneRevisionSchema = z.object({
  sceneId: z.string().min(1), versionId: z.string().min(1), scenesRevision: z.string().regex(/^[a-f0-9]{64}$/),
  replacementPath: z.string().optional(),
  kind: z.enum(["text", "image", "duration", "narration"]), value: z.string().max(5000),
});
export type SceneRevision = z.infer<typeof sceneRevisionSchema>;
export const sceneRevisionPrefix = "YINGYA_SCENE_REVISION ";
export function sceneRevisionContext(revision: SceneRevision) { return sceneRevisionPrefix + JSON.stringify(sceneRevisionSchema.parse(revision)); }
export function sceneRevisionLabel(revision: SceneRevision) {
  return `修改镜头 ${revision.sceneId} · ${{ text: "文字", image: "截图", duration: "时长", narration: "旁白" }[revision.kind]}`;
}
export function sceneRevisionPrompt(revision: SceneRevision) {
  const action = revision.kind === "text" ? `画面文字改为：${revision.value}` : revision.kind === "narration" ? `旁白改为：${revision.value}` : revision.kind === "duration" ? `停留时间改为 ${revision.value} 秒` : "将主截图替换为本次附加的图片，沿用本镜头版式与动画";
  return `请只修改镜头「${revision.sceneId}」：${action}。其他镜头的内容、素材与设计保持不变；必要时同步后续时间与字幕，检查实际成片后生成新版本。`;
}
