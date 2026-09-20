import type { EditorDocument, EditorScene, EditorElement } from "./model.mjs";
export type EditorStyle = {
  id: string;
  name: string;
  category: string;
  description: string;
  background: string;
  foreground: string;
  accent: string;
  font: EditorElement["font"];
  animation: EditorElement["animation"];
  title: string;
  subtitle: string;
};
export const styles: EditorStyle[];
export function templateScene(
  styleId: string,
  sceneId: string,
  doc?: EditorDocument,
): EditorScene;
