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

describe("model overload recovery", () => {
  const overloaded = event(1, "error", {params: {error: {codexErrorInfo: "serverOverloaded", message: "Selected model is at capacity."}, willRetry: false}});
  const failed = event(2, "turn/completed", {params: {turn: {status: "failed"}}});
  const retry = (seq: number, status: string, failedTurnId: string | null = "turn-1") => event(seq, "project/modelRetry", {params: {retryId: "retry-1", failedTurnId, status, attempt: 1, maxAttempts: 5, delaySeconds: 5}});
  it("labels old overload errors accurately", () => {
    expect(buildTimeline([overloaded], new Set())[0]).toMatchObject({title: "模型暂时繁忙", summary: "当前模型服务繁忙，请稍后重试或切换模型。"});
  });
  it("shows retry progress instead of a failed turn while waiting", () => {
    const rows = buildTimeline([overloaded, failed, retry(3, "waiting")], new Set(), {status: "running", activeTurnId: "job"});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({status: "waiting", title: "模型暂时繁忙", summary: "5 秒后自动重试（1/5），可随时停止。"});
  });
  it.each(["completed", "failed", "interrupted"])("settles the same retry row as %s", status => {
    const rows = buildTimeline([overloaded, failed, retry(3, "waiting"), retry(4, "running"), retry(5, status, null)], new Set());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(status);
  });
  it("preserves other errors encountered during recovery", () => {
    const rows = buildTimeline([overloaded, failed, retry(3, "waiting"), event(4, "error", {params: {error: {message: "context too long"}}}, "turn-2"), retry(5, "failed", null)], new Set());
    expect(rows).toHaveLength(2);
    expect(rows[1].summary).toBe("context too long");
  });
  it("settles a retry abandoned by a lost worker", () => {
    const rows = buildTimeline([retry(3, "waiting")], new Set(), {status: "failed", activeTurnId: undefined});
    expect(rows[0].status).toBe("interrupted");
  });
});
