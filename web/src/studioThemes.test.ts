import { describe, expect, it } from "vitest";
import { initialStudioTheme, randomStudioTheme, resolveStudioTheme, studioThemes, studioThemeSessionKey } from "./studioThemes";

describe("studio theme selection", () => {
  it("makes all nine approved styles reachable without an immediate repeat", () => {
    expect(studioThemes).toHaveLength(9);
    expect(new Set(studioThemes.map(theme => theme.id)).size).toBe(9);
    const selected = Array.from({ length: 9 }, (_, i) => randomStudioTheme(undefined, () => (i + .5) / 9).id);
    expect(selected).toEqual(studioThemes.map(theme => theme.id));
    for (const theme of studioThemes) {
      const next = Array.from({ length: 8 }, (_, i) => randomStudioTheme(theme.id, () => (i + .5) / 8).id);
      expect(new Set(next).size).toBe(8);
      expect(next).not.toContain(theme.id);
    }
  });

  it("keeps the chosen family across page loads in the same visit", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const first = initialStudioTheme(storage);
    expect(values.get(studioThemeSessionKey)).toBe(first.id);
    expect(initialStudioTheme(storage)).toBe(first);
    storage.setItem(studioThemeSessionKey, "felt");
    expect(initialStudioTheme(storage).id).toBe("felt");
  });

  it("recovers from retired themes or unavailable storage", () => {
    expect(resolveStudioTheme("glass")).toBeUndefined();
    expect(resolveStudioTheme(null)).toBeUndefined();
    let replacement = "";
    const result = initialStudioTheme({ getItem: () => "glass", setItem: (_, value) => { replacement = value; } });
    expect(replacement).toBe(result.id);
    expect(() => initialStudioTheme({ getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });
});
