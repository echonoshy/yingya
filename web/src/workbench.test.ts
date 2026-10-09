import { describe, expect, it } from "vitest";
import { materialOnlyPrompt, sceneAtTime, selectedProjectVersion, sourceClip, sourceFilePath } from "./workbench";
import { agentManifestSchema, workbenchSchema } from "./schemas";
import type { MediaScene, ProjectDetail, SourceBinding } from "./types";

const scenes: MediaScene[] = [
  { id: "one", order: 1, narrativeRole: "搜索", assetIds: [], startSeconds: 0, durationSeconds: 4, sourceClip: { source: "assets/original.mp4", sourceIn: 13, sourceOut: 17 } },
  { id: "two", order: 2, narrativeRole: "选择", assetIds: [], startSeconds: 4, durationSeconds: 5, sourceClip: { source: "assets/original.mp4", sourceIn: 53, sourceOut: 58, focus: { anchor: { x: .98, y: .04 }, zoom: 2 } } },
];
const bindings: SourceBinding[] = [{ id: "one", mediaSrc: "assets/bundled.mp4", sourceIn: 10, sourceOut: 14, startSeconds: 0, durationSeconds: 4 }];
const manifest = agentManifestSchema.parse({ schemaVersion: 1, phase: "draft_review", dirty: false, outputSpec: {}, artifacts: [], versions: [{ id: "old", label: "旧版", sourcePath: "snapshots/old", videoPath: "old.mp4", createdAt: 1 }, { id: "new", label: "新版", sourcePath: "snapshots/new", videoPath: "new.mp4", createdAt: 2 }], currentDraft: "new", studioEntry: "index.html" });

describe("version-bound source interpretation", () => {
  it("keeps material-only creation behind plan confirmation", () => {
    expect(materialOnlyPrompt).toContain("确认方案后再开始制作视频");
  });
  it("follows the playhead instead of selecting the first scene and uses bound source intervals", () => {
    expect(sceneAtTime(scenes, bindings, 3.999)?.id).toBe("one");
    expect(sceneAtTime(scenes, bindings, 4)?.id).toBe("two");
    expect(sceneAtTime(scenes, bindings, 9)).toBeUndefined();
    expect(sourceClip(scenes[0], bindings)).toMatchObject({ source: "assets/bundled.mp4", sourceIn: 10, sourceOut: 14 });
    expect(sourceFilePath(".yingya/versions/old/source", "assets/bundled.mp4")).toBe(".yingya/versions/old/source/assets/bundled.mp4");
  });
  it("does not turn a project-file reference into a network or traversal URL", () => {
    for (const path of ["https://other.test/a.mp4", "//other.test/a.mp4", "../../secret", "javascript:alert(1)", "/etc/passwd"]) expect(sourceFilePath(".", path)).toBeUndefined();
  });
  it("keeps an explicitly selected old version and falls back to the current version only when absent", () => {
    const project = { manifest } as ProjectDetail;
    expect(selectedProjectVersion(project, "old")?.id).toBe("old");
    expect(selectedProjectVersion(project, "missing")?.id).toBe("new");
  });
  it("accepts a planning project without revisions and keeps rendered scenes separate from editable source", () => {
    const result = workbenchSchema.parse({ versionId: null, currentVersionId: null, sourcePath: ".", scenesRevision: null, scenes: [], sourceBindings: null,
      recipeCatalog: { schemaVersion: 1, recipes: [] }, editable: false, editReason: "等待首版", workspace: { scenesRevision: null, scenes, sourceBindings: null },
      warnings: ["来源未复验"], contentIndexValidation: { sourceHashesVerified: false, semanticClaimsVerified: false } });
    expect(result.scenes).toHaveLength(0);
    expect(result.workspace.scenes).toHaveLength(2);
    expect(result.workspace.scenesRevision).toBeNull();
    expect(result.contentIndexValidation?.semanticClaimsVerified).toBe(false);
  });
});
