import { createClientRequestId } from "../requestId";
import { z } from "zod";
import { scopedUrl, sessionFetch, sessionHeaders } from "../session";
import {
  validateDocument,
  type EditorDocument,
  type EditorCommand,
} from "../../../runtime/editor/model.mjs";
export type Composition = {
  available: true;
  revision: number;
  document: EditorDocument;
  canUndo: boolean;
  canRedo: boolean;
  updatedAt: number;
};
const compositionSchema = z.object({
  available: z.literal(true),
  revision: z.number().int().nonnegative(),
  document: z.unknown().transform(validateDocument),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  updatedAt: z.number(),
});
async function call(
  id: string,
  action?: string,
  request?: unknown,
  signal?: AbortSignal,
) {
  const response = await sessionFetch(
    scopedUrl(`/api/agent-projects/${id}/composition`),
    {
      method: action ? "POST" : "GET",
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(action ? 125000 : 15000),
          ])
        : AbortSignal.timeout(action ? 125000 : 15000),
      headers: { ...sessionHeaders(), "Content-Type": "application/json" },
      ...(action ? { body: JSON.stringify({ action, request }) } : {}),
    },
  );
  const value = await response.json();
  if (!response.ok) throw Error(value.message ?? value.error ?? "工程保存失败");
  return value;
}
export type BrandKit = {
  id: string;
  name: string;
  font: "sans" | "serif" | "mono";
  foreground: string;
  background: string;
  accent: string;
  logoPath?: string;
  logoSource?: string;
  revision: number;
};
export type SavedTemplate = {
  id: string;
  name: string;
  revision: number;
  width: number;
  height: number;
  scene: import("../../../runtime/editor/model.mjs").EditorScene;
  tracks: import("../../../runtime/editor/model.mjs").EditorTrack[];
};
export type EditorLibrary = { brands: BrandKit[]; templates: SavedTemplate[] };
export const editorApi = {
  library: async (id: string): Promise<EditorLibrary> =>
    call(id, "library-list", {}),
  loadBrand: async (
    id: string,
    brandId: string,
  ): Promise<{ brand: BrandKit }> => call(id, "brand-load", { id: brandId }),
  saveBrand: async (id: string, brand: BrandKit) =>
    call(id, "brand-save", { brand, expectedRevision: brand.revision }),
  removeLibraryItem: async (
    id: string,
    kind: "brands" | "templates",
    item: { id: string; revision: number },
  ) =>
    call(id, "library-delete", {
      kind,
      id: item.id,
      expectedRevision: item.revision,
    }),
  saveTemplate: async (
    id: string,
    revision: number,
    sceneId: string,
    name: string,
  ) => call(id, "template-save", { expectedRevision: revision, sceneId, name }),
  loadTemplate: async (
    id: string,
    templateId: string,
  ): Promise<{ command: EditorCommand }> =>
    call(id, "template-load", { id: templateId }),
  get: async (
    id: string,
    signal?: AbortSignal,
  ): Promise<Composition | null> => {
    const value = await call(id, undefined, undefined, signal);
    return value.available ? compositionSchema.parse(value) : null;
  },
  init: async (id: string, document: EditorDocument) =>
    compositionSchema.parse(await call(id, "init", { document })),
  command: async (
    id: string,
    revision: number,
    command: EditorCommand,
    requestId = createClientRequestId(),
  ) =>
    compositionSchema.parse(
      await call(id, "command", {
        expectedRevision: revision,
        command,
        requestId,
      }),
    ),
  checkpoint: async (id: string, revision: number) =>
    z
      .object({
        versionId: z.string(),
        sourcePath: z.string(),
        revision: z.number(),
      })
      .parse(
        await call(id, "checkpoint", {
          expectedRevision: revision,
          requestId: createClientRequestId(),
        }),
      ),
  restore: async (id: string, revision: number, versionId: string) =>
    compositionSchema.parse(
      await call(id, "restore", { expectedRevision: revision, versionId }),
    ),
};
