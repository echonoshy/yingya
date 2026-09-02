import { describe, expect, it } from "vitest";
import { compactTimelineActivities, extractInputChoices, extractQuickReplies } from "./AgentWorkspace";
import type { TimelineActivity } from "./eventTimeline";

function activity(id: string, kind: TimelineActivity["kind"]): TimelineActivity {
  return { id, kind, title: id, summary: "", output: "", status: "completed", firstSeq: 1, lastSeq: 1, createdAt: 1 };
}

describe("extractQuickReplies", () => {
  it("extracts concise numbered choices from an assistant reply", () => {
    expect(extractQuickReplies("回复以下任一项：\n\n1. `直接渲染`\n2. `加中文旁白再渲染`\n3. `加中文旁白和轻背景音乐再渲染`")).toEqual([
      "直接渲染",
      "加中文旁白再渲染",
      "加中文旁白和轻背景音乐再渲染",
    ]);
  });

  it("ignores ordinary numbered prose", () => {
    expect(extractQuickReplies("1. 先检查画面\n2. 再导出视频")).toEqual([]);
  });
});

describe("extractInputChoices", () => {
  it("extracts colon-delimited bullet choices from a clarification", () => {
    expect(extractInputChoices("制作前请确认视觉方向：\n\n- 明亮课堂风（推荐）：白/浅蓝底\n- 深色科技讲解：深蓝底\n- 手绘板书风：仿课堂粉笔演示")).toEqual([
      "明亮课堂风（推荐）",
      "深色科技讲解",
      "手绘板书风",
    ]);
  });

  it("prefers explicit quick replies", () => {
    expect(extractInputChoices("1. `继续制作`\n2. `修改方案`\n\n- 说明：不会被当成选项")).toEqual(["继续制作", "修改方案"]);
  });
});

describe("compactTimelineActivities", () => {
  it("keeps narrative updates and requests but only the latest operation", () => {
    expect(compactTimelineActivities([
      activity("intro", "assistant"),
      activity("read", "command"),
      activity("progress", "assistant"),
      activity("approval", "request"),
      activity("write", "file"),
    ]).map(item => item.id)).toEqual(["intro", "progress", "approval", "write"]);
  });

  it("keeps all narrative updates when no operation exists", () => {
    expect(compactTimelineActivities([
      activity("intro", "assistant"),
      activity("progress", "assistant"),
    ]).map(item => item.id)).toEqual(["intro", "progress"]);
  });
});
