import catalog from "../../runtime/visual-styles/catalog.json";
import { z } from "zod";

export const visualStyles = catalog;
export type VisualStyle = typeof catalog[number];
export const visualStyleIdSchema = z.string().refine(id => id === "auto" || catalog.some(style => style.id === id));
export const findVisualStyle = (id: string) => catalog.find(style => style.id === id);
export const stylePreviewPath = (style: { id: string; version: number }, kind: "poster.jpg" | "preview.mp4") => `/visual-styles/${style.id}/v${style.version}/${kind}`;
export function visualStyleRequest(id: string) {
  if (id === "auto") return { visualStyleId: "auto" };
  const style = findVisualStyle(id);
  if (!style) throw new Error("所选视觉风格已不可用，请重新选择。");
  return { visualStyleId: style.id, visualStyleVersion: style.version };
}
