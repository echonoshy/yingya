import { describe, expect, it } from "vitest";
import { initialStudioTheme, studioThemeSessionKey } from "./studioThemes";

describe("fixed paper theme migration", () => {
  it.each(["paper", "letterpress", "pencil", "watercolor", "felt", "cel", "crayon", "wood", "screenprint", "glass", ""])("migrates %s without changing drafts or account preferences", previous => {
    const values = new Map([[studioThemeSessionKey, previous], ["draft", "保留创作内容"], ["avatar", "cat"]]);
    const storage = { setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(initialStudioTheme(storage).id).toBe("paper");
    expect(values.get(studioThemeSessionKey)).toBe("paper");
    expect(values.get("draft")).toBe("保留创作内容");
    expect(values.get("avatar")).toBe("cat");
    expect(initialStudioTheme(storage).id).toBe("paper");
  });
  it("works with blocked or absent storage", () => {
    expect(initialStudioTheme().id).toBe("paper");
    expect(initialStudioTheme({ setItem() { throw new Error("blocked"); } }).id).toBe("paper");
  });
});
