import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../types";
import { buildTimeline } from "./eventTimeline";

function event(seq: number, method: string, payload: unknown, turnId = "turn-1"): AgentEvent {
  return { seq, projectId: "project", turnId, method, payload, createdAt: seq };
}

describe("buildTimeline", () => {
  it("updates one command activity from deltas and completion", () => {
    const timeline = buildTimeline([
      event(1, "item/started", { params: { item: { id: "cmd", type: "commandExecution", command: "hyperframes lint" } } }),
      event(2, "item/commandExecution/outputDelta", { params: { itemId: "cmd", delta: "checking\n" } }),
      event(3, "item/completed", { params: { item: { id: "cmd", type: "commandExecution", command: "hyperframes lint", status: "completed", aggregatedOutput: "passed\n" } } }),
    ], new Set());

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ id: "command-cmd", title: "检查 HyperFrames", status: "completed", output: "passed\n", firstSeq: 1, lastSeq: 3, createdAt: 1 });
  });

  it("does not repeat an assistant message already persisted", () => {
    const timeline = buildTimeline([
      event(1, "item/completed", { params: { item: { id: "reply", type: "agentMessage", text: "方案完成" } } }),
    ], new Set(["方案完成"]));
    expect(timeline).toEqual([]);
  });

  it("shows upstream connection retries instead of silently dropping them", () => {
    const timeline = buildTimeline([
      event(1, "error", { params: { error: { message: "Reconnecting... waiting for network" }, willRetry: true } }),
      event(2, "error", { params: { error: { message: "Reconnecting... waiting for network" }, willRetry: true } }),
    ], new Set());

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      id: "system-turn-1",
      kind: "system",
      title: "等待网络恢复",
      summary: "暂时无法连接创作服务，正在自动重试。",
      status: "waiting",
      firstSeq: 1,
      lastSeq: 2,
    });
  });
});


describe("lost execution connection", () => {
  const started = event(1, "item/started", { params: { item: { id: "cmd", type: "commandExecution", command: "base64 audio.wav" } } });
  it("settles an orphaned command when the project has failed without a final event", () => {
    expect(buildTimeline([started], new Set(), { status: "failed", activeTurnId: undefined })[0]).toMatchObject({status: "interrupted"});
  });
  it("keeps the current running command active", () => {
    expect(buildTimeline([started], new Set(), {status: "running", activeTurnId: "request-id"})[0].status).toBe("running");
  });
  it("does not revive old commands when a later run starts", () => {
    const ended = event(2, "project/executionEnded", {params: {status: "interrupted"}});
    expect(buildTimeline([started, ended], new Set(), {status: "running", activeTurnId: "next-request"})[0].status).toBe("interrupted");
  });
  it("clears a stale automatic-retry indicator after completion", () => {
    const retry = event(2, "error", {params: {willRetry: true}});
    const done = event(3, "turn/completed", {params: {turn: {status: "completed"}}});
    expect(buildTimeline([retry, done], new Set())[0].status).toBe("completed");
  });
});
