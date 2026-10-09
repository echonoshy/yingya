import { describe, expect, it } from "vitest";
import { collectProjectContents, contentCategory } from "./projectContents";
import type { Artifact, ProjectDetail } from "./types";

const artifact = (path: string, label = path): Artifact => ({ id: path, path, label, kind: "file", version: undefined, metadata: {} });
const project = (artifacts: Artifact[] = [], versions: ProjectDetail["manifest"]["versions"] = []) => ({ id: "p", manifest: { artifacts, versions } }) as ProjectDetail;

describe("project content discovery", () => {
  it("combines live files, registered outputs and versions once per project path", () => {
    const result = collectProjectContents(project([artifact("./assets/frame.png", "开场画面")], [{ id: "v1", label: "初稿", videoPath: "video.mp4", sourcePath: ".", reportPath: "report.json", createdAt: 10 }]), [
      { path: "assets/frame.png", name: "frame.png", size: 1024, modifiedAt: 30 },
      { path: "video.mp4", name: "video.mp4", size: 5000, modifiedAt: 40 },
    ], [{ id: "frame", name: "参考图片", projectPath: "assets/frame.png", kind: "image", url: "/file", source: "generated", mediaType: "image/png", createdAt: 5, providerId: undefined, description: undefined }]);
    expect(result.map(file => file.path)).toEqual(["video.mp4", "assets/frame.png", "report.json"]);
    expect(result[1].label).toBe("开场画面");
    expect(result[1].metadata).toMatchObject({ size: 1024, modifiedAt: 30 });
    expect(result[0].version).toBe("v1");
  });

  it("does not expose links outside the project", () => {
    const result = collectProjectContents(project([artifact("../private.md"), artifact("https://example.com/a.png"), artifact("/api/agent-projects/other/files/a.mp4"), artifact("/api/agent-projects/p/files/plans/intro.md")]), [], []);
    expect(result.map(file => file.path)).toEqual(["plans/intro.md"]);
  });

  it("classifies by file format even when the generator supplies a generic kind", () => {
    expect(["movie.MP4", "frame.svg", "voice.wav", "notes.md", "report.PDF", "slides.pptx", "archive.zip"].map(path => contentCategory(artifact(path)))).toEqual(["video", "image", "audio", "document", "document", "document", "other"]);
  });

  it("separates saved versions from working video and reports without losing version identity", () => {
    const p = project([artifact(".yingya/versions/v1/render.mp4", "静摩擦力 · 30 秒视频")], [
      { id: "v1", label: "版本 1", videoPath: ".yingya/versions/v1/render.mp4", sourcePath: ".", reportPath: ".yingya/reports/check.json", createdAt: 20 },
    ]);
    p.manifest.currentDraft = "v1";
    const result = collectProjectContents(p, [{ path: "renders/draft-1.mp4", name: "draft-1.mp4", size: 2048, modifiedAt: 30 }], []);
    expect(result.map(({ path, group }) => [path, group])).toEqual([
      ["renders/draft-1.mp4", "media"], [".yingya/reports/check.json", "production"], [".yingya/versions/v1/render.mp4", "versions"],
    ]);
    expect(result.find(file => file.group === "versions")).toMatchObject({ version: "v1", currentVersion: true, label: "静摩擦力 · 30 秒视频" });
  });

  it("keeps registered reference data and readable plans visible while grouping technical files", () => {
    const result = collectProjectContents(project([
      artifact("DESIGN.md"), artifact("assets/captions.json"), artifact(".yingya/reports/check.md"),
      { ...artifact(".yingya/plan.json"), kind: "plan" }, artifact("archive/source.zip"),
    ]), [], [{ id: "reference", name: "参考数据", projectPath: "assets/reference.json", kind: "document", source: "uploaded", url: "/file", createdAt: 1, mediaType: undefined, providerId: undefined, description: undefined }]);
    expect(Object.fromEntries(result.map(file => [file.path, file.group]))).toEqual({
      "DESIGN.md": "documents", "assets/captions.json": "production", ".yingya/reports/check.md": "production",
      ".yingya/plan.json": "documents", "archive/source.zip": "production", "assets/reference.json": "documents",
    });
    expect(result.find(file => file.path === "assets/reference.json")?.source).toBe("uploaded");
  });
});
