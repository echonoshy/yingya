import { describe, expect, it } from "vitest";
import { keyboardRegion, pointInFrame, regionFromPoints } from "./geometry";
import { agentMessageSchema, queuedTurnSchema, feedbackRegionSchema } from "../schemas";

describe("video feedback coordinates", () => {
  it("uses the displayed image bounds at different scales, excluding player margins", () => {
    const a = pointInFrame(150, 300, { left: 100, top: 100, width: 200, height: 400 });
    const b = pointInFrame(75, 150, { left: 50, top: 50, width: 100, height: 200 });
    expect(a).toEqual({ x: .25, y: .5 }); expect(b).toEqual(a);
  });
  it("normalizes reverse drags and clamps pointer capture outside the image", () => {
    const outside = pointInFrame(900, -20, { left: 0, top: 0, width: 200, height: 200 });
    expect(regionFromPoints({ x: .5, y: .5 }, outside)).toEqual({ x: .5, y: 0, width: .5, height: .5 });
  });
  it("keeps keyboard movement and resize inside the frame", () => {
    const r = { x: .5, y: .5, width: .5, height: .5 };
    expect(keyboardRegion(r, "ArrowRight", false)).toEqual(r);
    expect(keyboardRegion(r, "ArrowDown", true)).toEqual(r);
    expect(keyboardRegion(r, "ArrowLeft", false).x).toBe(.49);
  });
});

describe("feedback compatibility", () => {
  it("reads old messages and queues without feedback fields", () => {
    const common = { id: "1", text: "修改视频", context: [], attachments: [], createdAt: 1 };
    expect(agentMessageSchema.parse({ ...common, role: "user", status: "queued" }).feedback).toEqual([]);
    expect(queuedTurnSchema.parse(common).feedback).toEqual([]);
  });
  it("rejects malformed or out-of-frame feedback", () => {
    expect(feedbackRegionSchema.safeParse({ x: .9, y: 0, width: .5, height: .5 }).success).toBe(false);
    expect(feedbackRegionSchema.safeParse({ x: .1, y: 0, width: .5, height: .5 }).success).toBe(true);
  });
});
