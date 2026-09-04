import { describe, expect, it } from "vitest";
import { eventPageSchema, projectDetailSchema } from "./schemas";

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
    expect(parsed.renderJobs).toEqual([]);
    expect("events" in parsed).toBe(false);
  });

  it("parses persistent render jobs", () => {
    const parsed = projectDetailSchema.parse({
      id: "p", title: "测试", status: "rendering", statusLabel: "正在渲染", threadId: null,
      activeTurnId: null, queueDepth: 0, queuePaused: false, model: "model", reasoningEffort: "medium",
      aspectRatio: "16:9", voiceId: "default", createdAt: 1, updatedAt: 2, messages: [], queue: [], eventCursor: 42,
      renderJobs: [{ id: "job", versionId: "draft-1", status: "running", quality: "high", resolution: "landscape-4k", fps: 60, progress: 44, message: "正在渲染", startedAt: 1, updatedAt: 2 }],
      manifest: { schemaVersion: 1, phase: "draft_review", dirty: false, checkpoint: null, outputSpec: {}, artifacts: [], versions: [], currentDraft: null, studioEntry: "" },
    });
    expect(parsed.renderJobs[0]).toMatchObject({ id: "job", status: "running", progress: 44 });
  });
});

describe("eventPageSchema", () => {
  it("normalizes the null cursor emitted by Rust when there are no older events", () => {
    const parsed = eventPageSchema.parse({ items: [], nextBefore: null, latestSeq: 9, hasMore: false });
    expect(parsed.nextBefore).toBeUndefined();
  });
});
