import { describe, expect, it } from "vitest";
import { projectDetailSchema } from "./schemas";

describe("projectDetailSchema", () => {
  it("normalizes nullable Rust option fields and does not require events", () => {
    const parsed = projectDetailSchema.parse({
      id: "p", title: "测试", status: "idle", statusLabel: "空闲", threadId: null,
      activeTurnId: null, queueDepth: 0, queuePaused: false, model: "model", reasoningEffort: "medium",
      aspectRatio: "16:9", createdAt: 1, updatedAt: 2, messages: [], queue: [], eventCursor: 42,
      manifest: { schemaVersion: 1, phase: "planning", dirty: false, checkpoint: null, outputSpec: {}, artifacts: [], versions: [], currentDraft: null, studioEntry: "" },
    });
    expect(parsed.threadId).toBeUndefined();
    expect(parsed.manifest.checkpoint).toBeUndefined();
    expect(parsed.eventCursor).toBe(42);
    expect("events" in parsed).toBe(false);
  });
});
