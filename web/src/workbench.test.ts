import { describe, expect, it } from "vitest";
import { creationRequirements, creationSettingsSchema } from "./components/CreationSettings";
import { defaultExportFps, materialOnlyPrompt, sceneAtTime, selectedProjectVersion, sourceClip, sourceFilePath } from "./workbench";
import { agentManifestSchema, workbenchSchema } from "./schemas";
import type { MediaScene, ProjectDetail, SourceBinding } from "./types";

const scenes: MediaScene[] = [
  { id: "one", order: 1, narrativeRole: "搜索", assetIds: [], startSeconds: 0, durationSeconds: 4, sourceClip: { source: "assets/original.mp4", sourceIn: 13, sourceOut: 17 } },
  { id: "two", order: 2, narrativeRole: "选择", assetIds: [], startSeconds: 4, durationSeconds: 5, sourceClip: { source: "assets/original.mp4", sourceIn: 53, sourceOut: 58, focus: { anchor: { x: .98, y: .04 }, zoom: 2 } } },
];
const bindings: SourceBinding[] = [{ id: "one", mediaSrc: "assets/bundled.mp4", sourceIn: 10, sourceOut: 14, startSeconds: 0, durationSeconds: 4 }];
const manifest = agentManifestSchema.parse({ schemaVersion: 1, phase: "draft_review", dirty: false, outputSpec: {}, artifacts: [], versions: [{ id: "old", label: "旧版", sourcePath: "snapshots/old", videoPath: "old.mp4", createdAt: 1 }, { id: "new", label: "新版", sourcePath: "snapshots/new", videoPath: "new.mp4", createdAt: 2 }], currentDraft: "new", studioEntry: "index.html" });

describe("material-first creation", () => {
  it("migrates old settings without inventing narration and sends structured constraints", () => {
    const old = creationSettingsSchema.parse({ duration: "30 秒", audience: "新用户", style: "品牌绿色", subtitles: "不添加字幕", music: "不添加配乐" });
    expect(creationRequirements(old)).toEqual({ targetDurationSeconds: 30, durationMode: "target", audience: "新用户", styleNotes: "品牌绿色", subtitles: "none", music: "off", audioMode: "auto" });
    expect(creationRequirements({ ...old, audioMode: "replace", durationMode: "exact" })).toMatchObject({ audioMode: "replace", durationMode: "exact" });
    expect(materialOnlyPrompt).toContain("确认方案后再开始制作视频");
  });
  it("normalizes cached mute/music conflicts and keeps the submitted task silent", () => {
    const cached = { duration: "30 秒", audience: "", style: "", subtitles: "", music: "添加适合主题的配乐", audioMode: "mute" as const, durationMode: "target" as const };
    expect(creationSettingsSchema.parse(cached).music).toBe("不添加配乐");
    expect(creationRequirements(cached)).toMatchObject({ audioMode: "mute", music: "off" });
    expect(creationRequirements({ ...cached, music: "" }).music).toBe("off");
  });
  it("drops exact or maximum duration constraints when no target remains", () => {
    for (const durationMode of ["exact", "max"] as const) {
      const cached = { duration: "", audience: "", style: "", subtitles: "", music: "", audioMode: "auto" as const, durationMode };
      expect(creationSettingsSchema.parse(cached).durationMode).toBe("target");
      expect(creationRequirements(cached).durationMode).toBe("target");
      expect(creationRequirements(cached)).not.toHaveProperty("targetDurationSeconds");
    }
  });
});

describe("version-bound source interpretation", () => {
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

describe("bounded scene effects and export defaults", () => {
  it("uses the project frame rate and falls back to 30 for invalid or absent metadata", () => {
    expect(defaultExportFps({ manifest })).toBe(30);
    expect(defaultExportFps({ manifest: { ...manifest, outputSpec: { fps: 24 } } })).toBe(24);
    expect(defaultExportFps({ manifest: { ...manifest, outputSpec: { frameRate: 60 } } })).toBe(60);
    expect(defaultExportFps({ manifest: { ...manifest, outputSpec: { fps: 0 } } })).toBe(30);
  });
});
