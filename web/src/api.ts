import { z } from "zod";
import { codexModelSchema, eventPageSchema, projectDetailSchema, projectRecordSchema, turnAcceptedSchema } from "./schemas";
import type { CreateProjectInput, TurnInput } from "./types";

const errorSchema = z.object({ code: z.string().optional(), message: z.string().optional(), error: z.string().optional() });

async function parseError(response: Response) {
  const body = errorSchema.safeParse(await response.json().catch(() => ({})));
  return body.success ? body.data.message ?? body.data.error ?? response.statusText : response.statusText;
}

async function request<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(await parseError(response));
  return schema.parse(await response.json());
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = await fetch(path, { ...init, headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(await parseError(response));
}

async function requestText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) throw new Error((await response.text()) || response.statusText || "文件读取失败");
  return response.text();
}

const modelListSchema = z.object({ data: z.array(codexModelSchema) });
const uploadSchema = z.object({ path: z.string(), name: z.string() });
const studioSchema = z.object({ storyboardUrl: z.string(), previewUrl: z.string() });

export const api = {
  listProjects: () => request("/api/agent-projects", z.array(projectRecordSchema)),
  getProject: (id: string) => request(`/api/agent-projects/${id}`, projectDetailSchema),
  renameProject: (id: string, title: string) => request(`/api/agent-projects/${id}`, projectRecordSchema, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteProject: (id: string) => requestVoid(`/api/agent-projects/${id}`, { method: "DELETE" }),
  listModels: () => request("/api/codex/models", modelListSchema),
  createProject: (input: CreateProjectInput) => request("/api/agent-projects", projectDetailSchema, { method: "POST", body: JSON.stringify(input) }),
  sendTurn: (id: string, input: TurnInput) => request(`/api/agent-projects/${id}/turns`, turnAcceptedSchema, { method: "POST", body: JSON.stringify(input) }),
  interrupt: (id: string) => requestVoid(`/api/agent-projects/${id}/interrupt`, { method: "POST", body: "{}" }),
  resume: (id: string) => requestVoid(`/api/agent-projects/${id}/resume`, { method: "POST", body: "{}" }),
  removeQueued: (id: string, turnId: string) => requestVoid(`/api/agent-projects/${id}/queue/${turnId}`, { method: "DELETE" }),
  confirmCheckpoint: (id: string) => request(`/api/agent-projects/${id}/checkpoint`, turnAcceptedSchema, { method: "POST", body: "{}" }),
  respondToRequest: (id: string, requestId: unknown, result: unknown) => requestVoid(`/api/agent-projects/${id}/requests/respond`, { method: "POST", body: JSON.stringify({ id: requestId, result }) }),
  rollbackVersion: (id: string, versionId: string) => request(`/api/agent-projects/${id}/versions/${versionId}/rollback`, turnAcceptedSchema, { method: "POST", body: "{}" }),
  uploadAsset: async (id: string, file: File) => { const body = new FormData(); body.append("file", file); return request(`/api/agent-projects/${id}/assets`, uploadSchema, { method: "POST", body }); },
  studio: (id: string) => request(`/api/agent-projects/${id}/studio`, studioSchema, { method: "POST", body: "{}" }),
  markStudioDirty: (id: string) => requestVoid(`/api/agent-projects/${id}/studio/dirty`, { method: "POST", body: "{}" }),
  eventLog: (id: string, before?: number, limit = 500) => request(`/api/agent-projects/${id}/event-log?${new URLSearchParams({ ...(before ? { before: String(before) } : {}), limit: String(limit) })}`, eventPageSchema),
  readProjectFile: (id: string, path: string) => requestText(`/api/agent-projects/${id}/files/${path.split("/").map(encodeURIComponent).join("/")}`),
  fileUrl: (id: string, path: string) => `/api/agent-projects/${id}/files/${path.split("/").map(encodeURIComponent).join("/")}`,
};
