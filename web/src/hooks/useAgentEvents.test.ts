import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../types";
import { mergeEvents } from "./useAgentEvents";

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
