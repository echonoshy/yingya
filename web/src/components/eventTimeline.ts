import type { AgentEvent } from "../types";

type ActivityKind = "assistant" | "command" | "file" | "plan" | "tool" | "request" | "system";
export interface TimelineActivity {
  id: string;
  kind: ActivityKind;
  title: string;
  summary: string;
  output: string;
  status: "running" | "completed" | "failed" | "interrupted" | "waiting";
  firstSeq: number;
  lastSeq: number;
  createdAt: number;
  turnId?: string;
  event?: AgentEvent;
}

type JsonObject = Record<string, unknown>;

export function buildTimeline(events: AgentEvent[], persistedAssistantTexts: Set<string>): TimelineActivity[] {
  const activities: TimelineActivity[] = [];
  const byId = new Map<string, TimelineActivity>();
  const completedTurns = new Map<string, string>();

  for (const event of events) {
    if (event.method !== "turn/completed" || !event.turnId) continue;
    const turn = asObject(asObject(asObject(event.payload).params).turn);
    completedTurns.set(event.turnId, stringValue(turn.status) || "completed");
  }

  function activity(id: string, kind: ActivityKind, event: AgentEvent, title: string) {
    let item = byId.get(id);
    if (!item) {
      item = { id, kind, title, summary: "", output: "", status: "running", firstSeq: event.seq, lastSeq: event.seq, createdAt: event.createdAt, turnId: event.turnId };
      byId.set(id, item);
      activities.push(item);
    }
    item.lastSeq = event.seq;
    return item;
  }

  for (const event of events) {
    const payload = asObject(event.payload);
    const params = asObject(payload.params);
    const item = asObject(params.item);
    const itemId = stringValue(params.itemId) || stringValue(item.id);

    if (event.method === "error" || event.method === "warning") {
      const error = asObject(params.error);
      const retrying = params.willRetry === true;
      const row = activity(`system-${event.turnId ?? "current"}`, "system", event, retrying ? "等待网络恢复" : "创作服务连接异常");
      row.summary = retrying
        ? "暂时无法连接创作服务，正在自动重试。"
        : stringValue(error.message) || stringValue(params.message) || "暂时无法连接创作服务。";
      row.status = retrying ? "waiting" : "failed";
      continue;
    }

    if (isRequest(event, payload)) {
      activities.push({ id: `request-${event.seq}`, kind: "request", title: requestTitle(event.method), summary: stringValue(params.reason) || stringValue(params.message), output: "", status: "waiting", firstSeq: event.seq, lastSeq: event.seq, createdAt: event.createdAt, event });
      continue;
    }

    if (event.method === "item/agentMessage/delta" && itemId) {
      const row = activity(`message-${itemId}`, "assistant", event, "Codex");
      row.summary += stringValue(params.delta);
      continue;
    }

    if ((event.method === "item/started" || event.method === "item/completed") && itemId) {
      const type = stringValue(item.type);
      if (type === "userMessage" || type === "reasoning") continue;
      if (type === "agentMessage") {
        const row = activity(`message-${itemId}`, "assistant", event, "Codex");
        const text = stringValue(item.text);
        if (text) row.summary = text;
        row.status = event.method === "item/completed" ? "completed" : "running";
        continue;
      }
      if (type === "commandExecution") {
        const command = stringValue(item.command);
        const row = activity(`command-${itemId}`, "command", event, commandTitle(command));
        if (command) row.summary = compactCommand(command);
        const aggregated = stripAnsi(stringValue(item.aggregatedOutput));
        if (aggregated) row.output = aggregated;
        row.status = commandStatus(item, event.method);
        continue;
      }
      if (type === "fileChange") {
        const row = activity(`file-${itemId}`, "file", event, "修改文件");
        row.summary = fileSummary(item);
        row.status = stringValue(item.status) === "failed" ? "failed" : event.method === "item/completed" ? "completed" : "running";
        continue;
      }
      const row = activity(`tool-${itemId}`, "tool", event, toolTitle(item));
      row.summary = stringValue(item.name) || stringValue(item.tool) || type;
      row.status = event.method === "item/completed" ? (stringValue(item.status) === "failed" ? "failed" : "completed") : "running";
      continue;
    }

    if (event.method === "item/commandExecution/outputDelta" && itemId) {
      const row = activity(`command-${itemId}`, "command", event, "运行命令");
      row.output += stripAnsi(stringValue(params.delta));
      continue;
    }

    if (event.method.includes("plan") && event.method.includes("updated")) {
      const id = `plan-${event.turnId ?? "current"}`;
      const row = activity(id, "plan", event, "更新计划");
      row.summary = planSummary(params);
      row.status = "completed";
    }
  }

  for (const item of activities) {
    const turnStatus = item.turnId ? completedTurns.get(item.turnId) : undefined;
    if (item.status === "running" && turnStatus) item.status = turnStatus === "interrupted" ? "interrupted" : turnStatus === "failed" ? "failed" : "completed";
  }

  return activities.filter(item => {
    if (item.kind === "assistant") return Boolean(item.summary.trim()) && !persistedAssistantTexts.has(item.summary.trim());
    return Boolean(item.title || item.summary || item.output);
  });
}

function asObject(value: unknown): JsonObject { return value && typeof value === "object" ? value as JsonObject : {}; }
function stringValue(value: unknown) { return typeof value === "string" ? value : ""; }
function isRequest(event: AgentEvent, payload: JsonObject) { return payload.id !== undefined && (event.method.includes("requestApproval") || event.method.includes("requestUserInput") || event.method.includes("elicitation/request") || event.method === "execCommandApproval" || event.method === "applyPatchApproval"); }
function requestTitle(method: string) { if (method.includes("requestUserInput")) return "需要你的输入"; if (method.includes("permissions")) return "需要权限"; return "等待批准"; }
function commandStatus(item: JsonObject, method: string): TimelineActivity["status"] { const status = stringValue(item.status); if (status === "failed" || Number(item.exitCode) > 0) return "failed"; if (method === "item/completed" || status === "completed") return "completed"; return "running"; }
function commandTitle(command: string) { if (/hyperframes\s+capture/.test(command)) return "抓取网站"; if (/hyperframes\s+(lint|validate|inspect|check)/.test(command)) return "检查 HyperFrames"; if (/hyperframes\s+render/.test(command)) return "渲染视频"; if (/hyperframes\s+skills/.test(command)) return "检查工作流能力"; if (/find\s|sed\s|rg\s/.test(command)) return "读取项目信息"; return "运行命令"; }
function compactCommand(command: string) { return stripAnsi(command).replace(/^\/bin\/bash\s+-lc\s+/, "").replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ").trim(); }
function stripAnsi(value: string) { return value.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "").replace(/\r/g, ""); }
function fileSummary(item: JsonObject) { const changes = Array.isArray(item.changes) ? item.changes : []; const paths = changes.map(change => stringValue(asObject(change).path)).filter(Boolean); return paths.length ? paths.slice(0, 3).join("、") + (paths.length > 3 ? ` 等 ${paths.length} 个文件` : "") : "项目文件已更新"; }
function toolTitle(item: JsonObject) { const type = stringValue(item.type); if (type.toLowerCase().includes("mcp")) return "调用插件"; if (type.toLowerCase().includes("image")) return "生成图片"; return "使用工具"; }
function planSummary(params: JsonObject) { const message = stringValue(params.message); if (message) return message; const plan = params.plan; if (!Array.isArray(plan)) return "计划已更新"; return plan.map(entry => stringValue(asObject(entry).step)).filter(Boolean).join(" · "); }
