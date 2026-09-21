import { describe, expect, it } from "vitest";
import { initialStudioTheme, studioThemeSessionKey } from "./studioThemes";

describe("comic theme migration", () => {
  it.each(["comic", "paper", "letterpress", "pencil", "watercolor", "felt", "cel", "crayon", "wood", "screenprint", "glass", ""])("migrates %s without changing drafts or account preferences", previous => {
    const values = new Map([[studioThemeSessionKey, previous], ["draft", "保留创作内容"], ["avatar", "cat"]]);
    const storage = { setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(initialStudioTheme(storage).id).toBe("comic");
    expect(values.get(studioThemeSessionKey)).toBe("comic");
    expect(values.get("draft")).toBe("保留创作内容");
    expect(values.get("avatar")).toBe("cat");
    expect(initialStudioTheme(storage).id).toBe("comic");
  });
  it("works with blocked or absent storage", () => {
    expect(initialStudioTheme().id).toBe("comic");
    expect(initialStudioTheme({ setItem() { throw new Error("blocked"); } }).id).toBe("comic");
  });
});
