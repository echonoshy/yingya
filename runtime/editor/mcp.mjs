#!/usr/bin/env node
// Local stdio MCP bridge. Set YINGYA_EDITOR_PROJECT for a fixed local project,
// or YINGYA_API_URL + YINGYA_API_COOKIE (or account env) for the authenticated API.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { editStore } from "./store.mjs";
import { styles } from "./catalog.mjs";
import { validateDocument } from "./model.mjs";
const local = process.env.YINGYA_EDITOR_PROJECT
  ? path.resolve(process.env.YINGYA_EDITOR_PROJECT)
  : null;
const library =
  process.env.YINGYA_EDITOR_LIBRARY ||
  (local ? path.join(local, ".yingya/library") : undefined);
const base = new URL(process.env.YINGYA_API_URL ?? "http://127.0.0.1:8797");
if (
  base.protocol !== "https:" &&
  !(
    base.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
  )
)
  throw Error("Remote Yingya API must use HTTPS");
let cookie = process.env.YINGYA_API_COOKIE ?? "",
  scope = "",
  userId = "",
  authPromise;
async function raw(route, method = "GET", body) {
  const response = await fetch(new URL(route, base), {
    method,
    headers: {
      Origin: base.origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(userId ? { "X-Yingya-User": userId } : {}),
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(125000),
    redirect: "error",
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw Error(`Yingya API returned a non-JSON response (${response.status})`);
  }
  if (!response.ok)
    throw Error(
      data.message ?? data.error ?? `Yingya API HTTP ${response.status}`,
    );
  return { data, response };
}
async function auth() {
  if (scope) return;
  if (!authPromise)
    authPromise = (async () => {
      if (!cookie) {
        const email = process.env.YINGYA_API_EMAIL,
          password = process.env.YINGYA_API_PASSWORD;
        if (!email || !password)
          throw Error(
            "Configure YINGYA_API_COOKIE or YINGYA_API_EMAIL / YINGYA_API_PASSWORD in the MCP host environment",
          );
        const { response } = await raw("/api/auth/login", "POST", {
          email,
          password,
        });
        cookie = response.headers
          .getSetCookie()
          .map((value) => value.split(";")[0])
          .join("; ");
      }
      const { data } = await raw("/api/auth/me");
      userId = data.user?.id;
      if (!userId) throw Error("Yingya session is not authenticated");
      scope = `/api/u/${encodeURIComponent(userId)}`;
    })().catch((e) => {
      authPromise = undefined;
      throw e;
    });
  await authPromise;
}
async function api(route, method = "GET", body) {
  await auth();
  return (await raw(scope + route, method, body)).data;
}
async function composition(projectId, action, request = {}) {
  if (local) return editStore(local, action, request, library);
  if (!projectId) throw Error("projectId is required in API mode");
  return api(
    `/agent-projects/${projectId}/composition`,
    action === "read" ? "GET" : "POST",
    action === "read" ? undefined : { action, request },
  );
}
const server = new McpServer({ name: "yingya-video-editor", version: "1.0.0" });
const projectId = z.string().uuid().optional(),
  revision = z.number().int().nonnegative(),
  requestId = z.string().min(1).max(100);
function tool(name, description, inputSchema, action, readOnly = false) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: !readOnly,
        idempotentHint: false,
        openWorldHint: !local,
      },
    },
    async (input) => {
      try {
        const result = await action(input);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: e instanceof Error ? e.message : "Operation failed",
            },
          ],
        };
      }
    },
  );
}
tool(
  "styles_list",
  "List original Yingya editable video styles.",
  {},
  async () => ({ styles }),
  true,
);
tool(
  "composition_read",
  "Read current composition and its revision. Read before edits.",
  { projectId },
  ({ projectId }) => composition(projectId, "read"),
  true,
);
tool(
  "composition_initialize",
  "Initialize a new editable composition; refuses to replace an existing one.",
  { projectId, document: z.unknown() },
  ({ projectId, document }) =>
    composition(projectId, "init", { document: validateDocument(document) }),
);
tool(
  "composition_edit",
  "Apply a scoped scene/element/track command, undo or redo. expectedRevision prevents overwriting concurrent manual edits; reuse requestId only for the identical retry.",
  {
    projectId,
    expectedRevision: revision,
    requestId,
    command: z.object({ type: z.string() }).passthrough(),
  },
  ({ projectId, ...request }) => composition(projectId, "command", request),
);
tool(
  "composition_checkpoint",
  "Save an immutable render snapshot including assets and fonts. Does not claim an MP4 has already been rendered.",
  { projectId, expectedRevision: revision, requestId },
  ({ projectId, ...request }) => composition(projectId, "checkpoint", request),
);
tool(
  "composition_restore",
  "Restore an editor snapshot as a new undoable revision.",
  { projectId, expectedRevision: revision, versionId: z.string() },
  ({ projectId, ...request }) => composition(projectId, "restore", request),
);
tool(
  "library_list",
  "List saved brand kits and scene templates for this user.",
  { projectId },
  ({ projectId }) => composition(projectId, "library-list"),
  true,
);
tool(
  "template_save",
  "Package a scene with its media dependencies for reuse.",
  {
    projectId,
    expectedRevision: revision,
    sceneId: z.string(),
    name: z.string().min(1).max(100),
  },
  ({ projectId, ...request }) =>
    composition(projectId, "template-save", request),
);
tool(
  "template_prepare_insert",
  "Import dependencies and return a scoped insertion command; apply it with composition_edit.",
  { projectId, id: z.string() },
  ({ projectId, ...request }) =>
    composition(projectId, "template-load", request),
);
if (!local) {
  tool(
    "projects_list",
    "List your Yingya projects and task statuses.",
    {},
    () => api("/agent-projects"),
    true,
  );
  tool(
    "project_status",
    "Read project, version, queued messages and render-job state.",
    { projectId: z.string().uuid() },
    ({ projectId }) => api(`/agent-projects/${projectId}`),
    true,
  );
  tool(
    "project_create",
    "Create a project. Creation alone does not submit a generation turn.",
    {
      prompt: z.string().min(1),
      title: z.string().optional(),
      aspectRatio: z.enum(["16:9", "9:16", "1:1"]).default("16:9"),
      model: z.string().default("gpt-5.6-terra"),
      reasoningEffort: z.string().default("high"),
      requirements: z.record(z.string(), z.unknown()).optional(),
      clientRequestId: z.string().optional(),
    },
    (input) => api("/agent-projects", "POST", input),
  );
  tool(
    "project_edit_with_ai",
    "Submit a scoped AI request; provide current baseVersionId and a stable clientRequestId. AI provider availability is checked by the service.",
    {
      projectId: z.string().uuid(),
      text: z.string().min(1),
      baseVersionId: z.string().nullable(),
      clientRequestId: z.string(),
      attachments: z.array(z.string()).default([]),
    },
    ({ projectId, ...input }) =>
      api(`/agent-projects/${projectId}/turns`, "POST", input),
  );
  tool(
    "project_approve_plan",
    "Confirm the currently displayed production checkpoint.",
    { projectId: z.string().uuid() },
    ({ projectId }) =>
      api(`/agent-projects/${projectId}/checkpoint`, "POST", {}),
  );
  tool(
    "project_cancel",
    "Interrupt the active AI production turn without deleting the project.",
    { projectId: z.string().uuid() },
    ({ projectId }) =>
      api(`/agent-projects/${projectId}/interrupt`, "POST", {}),
  );
  tool(
    "project_render",
    "Render an immutable version to MP4. Check project_status for completion and outputPath.",
    {
      projectId: z.string().uuid(),
      versionId: z.string(),
      resolution: z.enum([
        "landscape",
        "landscape-4k",
        "portrait",
        "portrait-4k",
        "square",
        "square-4k",
      ]),
      fps: z.number().int().min(1).max(120).default(30),
    },
    ({ projectId, ...input }) =>
      api(`/agent-projects/${projectId}/render`, "POST", input),
  );

}
await server.connect(new StdioServerTransport());
