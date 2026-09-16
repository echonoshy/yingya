import { describe, expect, it } from "vitest";
import { projectRecordSchema } from "./schemas";
import { visualStyles, visualStyleRequest, visualStyleIdSchema, stylePreviewPath } from "./visualStyles";

describe("visual style selection", () => {
  it("sends a stable id and version rather than expanding the user's prompt", () => {
    expect(visualStyleRequest("precise-tech")).toEqual({ visualStyleId: "precise-tech", visualStyleVersion: 1 });
    expect(visualStyleRequest("auto")).toEqual({ visualStyleId: "auto" });
    expect(() => visualStyleRequest("missing")).toThrow();
    expect(visualStyleIdSchema.safeParse("missing").success).toBe(false);
  });
  it("keeps old project records valid and retains saved style versions", () => {
    const legacy = { id: "old", title: "旧项目", status: "idle", statusLabel: "就绪", queueDepth: 0, model: "test", reasoningEffort: "high", aspectRatio: "16:9", createdAt: 1, updatedAt: 1 };
    expect(projectRecordSchema.parse(legacy).visualStyle).toBeUndefined();
    const style = { id: "quiet-product", name: "极简产品", version: 1 };
    expect(projectRecordSchema.parse({ ...legacy, visualStyle: style }).visualStyle).toEqual(style);
    expect(stylePreviewPath(style, "preview.mp4")).toBe("/visual-styles/quiet-product/v1/preview.mp4");
  });
  it("has distinct complete styles with video motion and Chinese production rules", () => {
    expect(new Set(visualStyles.map(style => style.id)).size).toBe(6);
    for (const style of visualStyles) {
      expect(style.rules.length).toBeGreaterThanOrEqual(3);
      expect(style.motion.enter).toBeGreaterThan(0);
      expect(style.tokens.font).toContain("Noto Sans SC");
    }
  });
});
