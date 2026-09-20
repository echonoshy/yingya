export type TrackKind = "visual" | "text" | "audio";
export type ElementKind = "text" | "shape" | "image" | "video" | "audio";
export type EditorElement = {
  id: string;
  kind: ElementKind;
  trackId: string;
  name: string;
  start: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  text: string;
  font: "sans" | "serif" | "mono";
  fontSize: number;
  fontWeight: number;
  align: "left" | "center" | "right";
  color: string;
  fill: string;
  radius: number;
  source: string;
  sourceIn: number;
  sourceDuration: number | null;
  volume: number;
  fit: "cover" | "contain";
  animation: "none" | "fade" | "rise" | "scale";
};
export type EditorScene = {
  id: string;
  name: string;
  duration: number;
  background: string;
  elements: EditorElement[];
  styleId?: string;
};
export type EditorTrack = {
  id: string;
  name: string;
  kind: TrackKind;
  muted: boolean;
  locked: boolean;
};
export type EditorDocument = {
  schemaVersion: 1;
  width: number;
  height: number;
  fps: number;
  scenes: EditorScene[];
  tracks: EditorTrack[];
  brandId?: string;
};
export type EditorCommand =
  | { type: "document.replace"; document: EditorDocument }
  | { type: "document.resize"; width: number; height: number }
  | { type: "element.move"; sceneId: string; elementId: string; index: number }
  | { type: "scene.add"; index: number; scene: EditorScene }
  | { type: "scene.remove"; sceneId: string }
  | { type: "scene.move"; sceneId: string; index: number }
  | {
      type: "scene.update";
      sceneId: string;
      patch: Partial<Pick<EditorScene, "name" | "background" | "duration">>;
    }
  | { type: "scene.split"; sceneId: string; at: number; newSceneId: string }
  | { type: "element.add"; sceneId: string; element: EditorElement }
  | {
      type: "element.update";
      sceneId: string;
      elementId: string;
      patch: Partial<Omit<EditorElement, "id" | "kind">>;
    }
  | { type: "element.remove"; sceneId: string; elementId: string }
  | { type: "track.add"; track: EditorTrack }
  | {
      type: "track.update";
      trackId: string;
      patch: Partial<Omit<EditorTrack, "id" | "kind">>;
    }
  | { type: "track.remove"; trackId: string }
  | {
      type: "brand.apply";
      brand: {
        logoSource?: string;
        accent?: string;
        id: string;
        foreground: string;
        background: string;
        font: EditorElement["font"];
      };
    }
  | { type: "batch"; commands: EditorCommand[] }
  | { type: "undo" | "redo" };
export type EditorState = {
  schemaVersion: 1;
  revision: number;
  document: EditorDocument;
  past: { document: EditorDocument; label: string }[];
  future: { document: EditorDocument; label: string }[];
  updatedAt: number;
  receipts: { requestId: string; body: string }[];
};
export const SCHEMA_VERSION: number;
export const TRACK_KINDS: TrackKind[];
export const ELEMENT_KINDS: ElementKind[];
export const FONTS: EditorElement["font"][];
export const ANIMATIONS: EditorElement["animation"][];
export function assetPath(value: unknown): boolean;
export function validateDocument(doc: unknown): EditorDocument;
export function emptyDocument(aspect?: string): EditorDocument;
export function newElement(
  id: string,
  kind: ElementKind,
  scene: EditorScene,
  doc: EditorDocument,
): EditorElement;
export function sceneSchedule(
  doc: EditorDocument,
): (EditorScene & { start: number })[];
export function documentDuration(doc: EditorDocument): number;
export function applyCommand(
  doc: EditorDocument,
  command: EditorCommand,
): EditorDocument;
export function initialState(doc: EditorDocument): EditorState;
export function transact(
  state: EditorState,
  request: {
    requestId: string;
    expectedRevision: number;
    command: EditorCommand;
  },
): EditorState;
