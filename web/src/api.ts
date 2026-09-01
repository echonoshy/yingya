import type { CodexModel, CreateProjectInput, ProjectDetail, ProjectRecord, TurnAccepted, TurnInput } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({ error: response.statusText })); throw new Error(body.error ?? "请求失败"); }
  if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
  return response.json() as Promise<T>;
}

async function requestText(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) { const body = await response.json().catch(() => ({ error: response.statusText })); throw new Error(body.error ?? "文件读取失败"); }
  return response.text();
}

export const api = {
  listProjects: () => request<ProjectRecord[]>("/api/agent-projects"),
  getProject: (id: string) => request<ProjectDetail>(`/api/agent-projects/${id}`),
  renameProject: (id: string, title: string) => request<ProjectRecord>(`/api/agent-projects/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteProject: (id: string) => request<void>(`/api/agent-projects/${id}`, { method: "DELETE" }),
  listModels: () => request<{ data: CodexModel[] }>("/api/codex/models"),
  createProject: (input: CreateProjectInput) => request<ProjectDetail>("/api/agent-projects", { method: "POST", body: JSON.stringify(input) }),
  sendTurn: (id: string, input: TurnInput) => request<TurnAccepted>(`/api/agent-projects/${id}/turns`, { method: "POST", body: JSON.stringify(input) }),
  interrupt: (id: string) => request<void>(`/api/agent-projects/${id}/interrupt`, { method: "POST", body: "{}" }),
  removeQueued: (id: string, turnId: string) => request<void>(`/api/agent-projects/${id}/queue/${turnId}`, { method: "DELETE" }),
  confirmCheckpoint: (id: string) => request<TurnAccepted>(`/api/agent-projects/${id}/checkpoint`, { method: "POST", body: "{}" }),
  respondToRequest: (id: string, requestId: unknown, result: unknown) => request<void>(`/api/agent-projects/${id}/requests/respond`, { method: "POST", body: JSON.stringify({ id: requestId, result }) }),
  rollbackVersion: (id: string, versionId: string) => request<TurnAccepted>(`/api/agent-projects/${id}/versions/${versionId}/rollback`, { method: "POST", body: "{}" }),
  uploadAsset: async (id: string, file: File) => { const body = new FormData(); body.append("file", file); return request<{ path: string; name: string }>(`/api/agent-projects/${id}/assets`, { method: "POST", body }); },
  studio: (id: string) => request<{ storyboardUrl: string; previewUrl: string }>(`/api/agent-projects/${id}/studio`, { method: "POST", body: "{}" }),
  markStudioDirty: (id: string) => request<void>(`/api/agent-projects/${id}/studio/dirty`, { method: "POST", body: "{}" }),
  readProjectFile: (id: string, path: string) => requestText(`/api/agent-projects/${id}/files/${path.split("/").map(encodeURIComponent).join("/")}`),
  fileUrl: (id: string, path: string) => `/api/agent-projects/${id}/files/${path.split("/").map(encodeURIComponent).join("/")}`,
};
