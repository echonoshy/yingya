import { explanationPlanSchema, type PlanReceipt } from "./explanationPlan";
import { scopedUrl, sessionHeaders, sessionFetch } from "./session";
import { assetRoleSchema, workbenchSchema, sceneEditResultSchema, feedbackAssetSchema } from "./schemas";
import { z } from "zod";
import { mediaAssetSchema, agentMediaSchema, assetFolderSchema, assetLibraryItemSchema, assetLibrarySchema, codexModelSchema, eventPageSchema, imageLibrarySchema, imageTurnSchema, projectDetailSchema, projectRecordSchema, renderVideoResultSchema, turnAcceptedSchema, uploadedVoiceSchema, voiceListSchema } from "./schemas";
import type { CreateProjectInput, TurnInput } from "./types";
import { createClientRequestId } from "./requestId";

const errorSchema = z.object({ code: z.string().optional(), message: z.string().optional(), error: z.string().optional() });

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "ApiError"; }
}

async function parseError(response: Response) {
  const body = errorSchema.safeParse(await response.json().catch(() => ({})));
  return body.success ? body.data.message ?? body.data.error ?? response.statusText : response.statusText;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const signal = !init?.method || init.method === "GET" ? (init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)) : init.signal;
  const response = await sessionFetch(scopedUrl(path), { ...init, signal, headers: init?.body instanceof FormData ? { ...sessionHeaders(), ...init.headers } : { ...sessionHeaders(), "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return schema.parse(await response.json());
}

async function requestWithNetworkRetry<T>(path: string, schema: z.ZodType<T>, init: RequestInit): Promise<T> {
  try { return await request(path, schema, init); }
  catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return request(path, schema, init);
  }
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const signal = !init?.method || init.method === "GET" ? (init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)) : init.signal;
  const response = await sessionFetch(scopedUrl(path), { ...init, signal, headers: init?.body instanceof FormData ? { ...sessionHeaders(), ...init.headers } : { ...sessionHeaders(), "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
}

async function requestText(path: string): Promise<string> {
  const response = await sessionFetch(scopedUrl(path), { signal: AbortSignal.timeout(30000), headers: sessionHeaders() });
  if (!response.ok) throw new ApiError((await response.text()) || response.statusText || "文件读取失败", response.status);
  return response.text();
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const signal = !init?.method || init.method === "GET" ? (init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000)) : init.signal;
  const response = await sessionFetch(scopedUrl(path), { ...init, signal, headers: { ...sessionHeaders(), "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new ApiError(await parseError(response), response.status);
  return response.blob();
}

const modelListSchema = z.object({ data: z.array(codexModelSchema) });
const uploadSchema = z.object({ path: z.string(), name: z.string() });
const imageUploadSchema = z.object({ url: z.string(), hyperframesPath: z.string() });
const threadStartedSchema = z.object({ threadId: z.string() });

export const api = {
  uploadFeedbackAsset: async (id: string, uploadId: string, file: Blob) => { const body = new FormData(); body.append("uploadId", uploadId); body.append("file", file, "frame.png"); return request(`/api/agent-projects/${id}/feedback-assets`, feedbackAssetSchema, { method: "POST", body }); },
  listProjects: () => request("/api/agent-projects", z.array(projectRecordSchema)),
  getProject: (id: string) => request(`/api/agent-projects/${id}`, projectDetailSchema),
  renameProject: (id: string, title: string) => request(`/api/agent-projects/${id}`, projectRecordSchema, { method: "PATCH", body: JSON.stringify({ title }) }),
  setProjectVoice: (id: string, voiceId: string) => request(`/api/agent-projects/${id}`, projectRecordSchema, { method: "PATCH", body: JSON.stringify({ voiceId }) }),
  deleteProject: (id: string) => requestVoid(`/api/agent-projects/${id}`, { method: "DELETE" }),
  listModels: () => request("/api/codex/models", modelListSchema),
  createProject: (input: CreateProjectInput) => {
    const stableInput = { ...input, clientRequestId: input.clientRequestId ?? createClientRequestId() };
    return requestWithNetworkRetry("/api/agent-projects", projectDetailSchema, { method: "POST", body: JSON.stringify(stableInput) });
  },
  sendTurn: (id: string, input: TurnInput) => {
    const stableInput = { ...input, clientRequestId: input.clientRequestId ?? createClientRequestId() };
    return requestWithNetworkRetry(`/api/agent-projects/${id}/turns`, turnAcceptedSchema, { method: "POST", body: JSON.stringify(stableInput) });
  },
  interrupt: (id: string) => requestVoid(`/api/agent-projects/${id}/interrupt`, { method: "POST", body: "{}" }),
  resume: (id: string) => requestVoid(`/api/agent-projects/${id}/resume`, { method: "POST", body: "{}" }),
  removeQueued: (id: string, turnId: string) => requestVoid(`/api/agent-projects/${id}/queue/${turnId}`, { method: "DELETE" }),
  executeQueued: (id: string, turnId: string) => requestVoid(`/api/agent-projects/${id}/queue/${turnId}/execute`, { method: "POST", body: "{}" }),
  getPlan: (id: string, signal?: AbortSignal) => request(`/api/agent-projects/${id}/plan`, explanationPlanSchema, { signal }),
  confirmCheckpoint: (id: string, input: PlanReceipt & { clientRequestId: string; model?: string; reasoningEffort?: string }) => requestWithNetworkRetry(`/api/agent-projects/${id}/checkpoint`, turnAcceptedSchema, { method: "POST", body: JSON.stringify(input) }),
  renderVideo: (id: string, input: { versionId: string; resolution: "landscape" | "landscape-4k" | "portrait" | "portrait-4k" | "square" | "square-4k"; fps: number }) => request(`/api/agent-projects/${id}/render`, renderVideoResultSchema, { method: "POST", body: JSON.stringify(input) }),
  respondToRequest: (id: string, requestId: unknown, result: unknown) => requestVoid(`/api/agent-projects/${id}/requests/respond`, { method: "POST", body: JSON.stringify({ id: requestId, result }) }),
  rollbackVersion: (id: string, versionId: string) => request(`/api/agent-projects/${id}/versions/${versionId}/rollback`, turnAcceptedSchema, { method: "POST", body: "{}" }),
  uploadAsset: async (id: string, file: File) => { const body = new FormData(); body.append("file", file); return request(`/api/agent-projects/${id}/assets`, uploadSchema, { method: "POST", body }); },
  getWorkbench: (id: string, versionId?: string) => request(`/api/agent-projects/${id}/workbench${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`, workbenchSchema),
  setAssetRole: (id: string, path: string, role: import("./types").AssetRole) => request(`/api/agent-projects/${id}/asset-roles`, z.object({ assetRoles: z.array(z.object({ path: z.string(), role: assetRoleSchema })) }), { method: "PATCH", body: JSON.stringify({ path, role }) }),
  editScene: (id: string, sceneId: string, input: { baseVersionId: string; expectedScenesRevision: string; patch: { title?: string; recipe?: string; focus?: { rect: { x: number; y: number; width: number; height: number } } } }) => request(`/api/agent-projects/${id}/editorial/scenes/${encodeURIComponent(sceneId)}`, sceneEditResultSchema, { method: "PATCH", body: JSON.stringify(input) }),
  getProjectMedia: (id: string) => request(`/api/agent-projects/${id}/media`, agentMediaSchema),
  eventLog: (id: string, before?: number, limit = 500) => request(`/api/agent-projects/${id}/event-log?${new URLSearchParams({ ...(before ? { before: String(before) } : {}), limit: String(limit) })}`, eventPageSchema),
  readProjectFile: (id: string, path: string) => requestText(`/api/agent-projects/${id}/files/${path.split("/").map(encodeURIComponent).join("/")}`),
  fileUrl: (id: string, path: string) => scopedUrl(`/api/agent-projects/${id}/files/${path.split("/").map(encodeURIComponent).join("/")}`),
  searchAudio: (query: string, type: "music" | "sound_effects") => request(`/api/heygen/audio?${new URLSearchParams({ query, type, limit: "20" })}`, z.object({ data: z.array(z.object({ id: z.string(), name: z.string(), description: z.string(), audioUrl: z.string(), duration: z.number(), type: z.string() })), hasMore: z.boolean().default(false) })),
  importAudio: (id: string, input: { id: string; query: string; type: string }) => request(`/api/agent-projects/${id}/heygen/audio`, mediaAssetSchema, { method: "POST", body: JSON.stringify(input) }),
  listVoices: () => request("/api/voices", voiceListSchema),
  designVoice: (input: { name: string; description: string }) => request("/api/voices/design", uploadedVoiceSchema, { method: "POST", body: JSON.stringify(input) }),
  cloneVoice: (input: { name: string; description: string; refText: string; audio: File; authorized: boolean }) => {
    const body = new FormData();
    body.append("name", input.name); body.append("description", input.description); body.append("refText", input.refText); body.append("authorized", String(input.authorized)); body.append("audio", input.audio);
    return request("/api/voices", uploadedVoiceSchema, { method: "POST", body });
  },
  previewVoice: (voiceId: string, text?: string) => requestBlob("/api/voices/preview", { method: "POST", body: JSON.stringify({ voiceId, ...(text ? { text } : {}) }) }),
  listImages: () => request("/api/assets/images", imageLibrarySchema),
  listAssetLibrary: () => request("/api/assets/library", assetLibrarySchema),
  uploadLibraryAsset: async (file: File, folderId?: string) => { const body = new FormData(); body.append("file", file); if (folderId) body.append("folderId", folderId); return request("/api/assets/library", assetLibraryItemSchema, { method: "POST", body }); },
  importLibraryAsset: (id: string, projectId: string) => request(`/api/assets/library/${encodeURIComponent(id)}/projects/${projectId}`, uploadSchema, { method: "POST", body: "{}" }),
  renameLibraryAsset: (id: string, name: string) => requestVoid(`/api/assets/library/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteLibraryAsset: (id: string) => requestVoid(`/api/assets/library/${encodeURIComponent(id)}`, { method: "DELETE" }),
  renameAssetFolder: (id: string, name: string) => requestVoid(`/api/assets/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteAssetFolder: (id: string) => requestVoid(`/api/assets/folders/${id}`, { method: "DELETE" }),
  moveLibraryAsset: (id: string, folderId?: string) => requestVoid(`/api/assets/library/${id}`, { method: "PATCH", body: JSON.stringify({ folderId }) }),
  listAssetFolders: () => request("/api/assets/folders", z.array(assetFolderSchema)),
  createAssetFolder: (name: string) => request("/api/assets/folders", assetFolderSchema, { method: "POST", body: JSON.stringify({ name }) }),
  uploadImage: async (file: File) => { const body = new FormData(); body.append("file", file); return request("/api/assets/images", imageUploadSchema, { method: "POST", body }); },
  startImageThread: () => request("/api/codex/threads", threadStartedSchema, { method: "POST", body: "{}" }),
  generateImage: (threadId: string, input: { prompt: string; referenceImages: string[]; model: string; reasoningEffort: string }) => request(`/api/codex/threads/${threadId}/images`, imageTurnSchema, { method: "POST", body: JSON.stringify(input) }),
};
