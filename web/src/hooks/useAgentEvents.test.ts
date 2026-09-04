import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../types";
import { isAgentProgressEvent, isAgentRunStalled, latestAgentProgressAt, mergeEvents } from "./useAgentEvents";

function event(seq: number): AgentEvent {
  return { seq, projectId: "project", turnId: undefined, method: "queue/updated", payload: {}, createdAt: seq };
}

describe("mergeEvents", () => {
  it("deduplicates replayed sequence numbers and keeps order", () => {
    expect(mergeEvents([event(2), event(3)], [event(1), event(3), event(4)]).map(item => item.seq))
      .toEqual([1, 2, 3, 4]);
  });

  it("caps the ordinary timeline at the latest 2,000 events", () => {
    const result = mergeEvents([], Array.from({ length: 2_100 }, (_, index) => event(index + 1)));
    expect(result).toHaveLength(2_000);
    expect(result[0].seq).toBe(101);
    expect(result.at(-1)?.seq).toBe(2_100);
  });
});

describe("isAgentRunStalled", () => {
  it("only reports a running task after five minutes without progress", () => {
    expect(isAgentRunStalled(false, 0, 600_000)).toBe(false);
    expect(isAgentRunStalled(true, 300_001, 600_000)).toBe(false);
    expect(isAgentRunStalled(true, 300_000, 600_000)).toBe(true);
  });
});

describe("agent progress events", () => {
  it("does not count network retry notices as productive progress", () => {
    expect(isAgentProgressEvent({ ...event(1), method: "error" })).toBe(false);
    expect(isAgentProgressEvent({ ...event(2), method: "warning" })).toBe(false);
    expect(isAgentProgressEvent({ ...event(3), method: "item/started" })).toBe(true);
  });

  it("keeps the latest productive event timestamp when retries follow", () => {
    expect(latestAgentProgressAt([
      { ...event(1), createdAt: 100 },
      { ...event(2), method: "error", createdAt: 200 },
    ], 0)).toBe(100);
  });
});
