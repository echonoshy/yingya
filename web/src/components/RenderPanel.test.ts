import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentManifestSchema } from "../schemas";
import type { ProjectDetail } from "../types";
import { RenderPanel } from "./HyperFramesWorkspace";

function panel({ dirty, current = "v2", active = false, queued = false }: { dirty: boolean; current?: string; active?: boolean; queued?: boolean }) {
  const version = { id: "v2", label: "预览第二版", sourcePath: "snapshots/v2", videoPath: "v2.mp4", reportPath: undefined, createdAt: 2 };
  const project = { id: "project", title: "视频", aspectRatio: "16:9", renderJobs: [], queueDepth: queued ? 1 : 0, activeTurnId: active ? "turn" : null,
    manifest: agentManifestSchema.parse({ schemaVersion: 1, phase: "draft_review", dirty, outputSpec: {}, artifacts: [], versions: [version], currentDraft: current, studioEntry: "index.html" }) } as unknown as ProjectDetail;
  return renderToStaticMarkup(createElement(RenderPanel, { project, version, onRefresh: async () => {}, onGeneratePreview: () => {} }));
}

describe("export distinguishes saved scene edits from rendered versions", () => {
  it("names the existing export version and offers a new preview for unrendered changes", () => {
    const html = panel({ dirty: true });
    expect(html).toContain("本次导出仍是「预览第二版」，不包含这些修改");
    expect(html).toContain("导出已有版本");
    expect(html).not.toContain("开始导出");
    expect(html).toMatch(/<button type="button">生成新版预览<\/button>/);
  });
  it("prevents the new preview action from an old version or while a turn is running or queued", () => {
    for (const args of [{ dirty: true, current: "v3" }, { dirty: true, active: true }, { dirty: true, queued: true }]) {
      expect(panel(args)).toMatch(/<button type="button" disabled="">生成新版预览<\/button>/);
    }
  });
  it("keeps the regular export action when the selected source is already rendered", () => {
    const html = panel({ dirty: false });
    expect(html).toContain("开始导出");
    expect(html).not.toContain("未渲染修改");
    expect(html).not.toContain("生成新版预览");
  });
});
