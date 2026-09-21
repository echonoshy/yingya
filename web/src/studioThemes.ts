/** One coherent illustration family per visit, shared by every product surface. */
export const studioThemes = [
  { id: "paper", name: "纸上放映室", material: "paper", align: "end" },
  { id: "letterpress", name: "版画故事工坊", material: "print", align: "start" },
  { id: "pencil", name: "铅笔动画工作室", material: "drawing", align: "end" },
  { id: "watercolor", name: "水彩自然手记", material: "drawing", align: "start" },
  { id: "felt", name: "毛毡定格片场", material: "soft", align: "end" },
  { id: "cel", name: "复古动画工作室", material: "drawing", align: "end" },
  { id: "crayon", name: "蜡笔绘本", material: "drawing", align: "start" },
  { id: "wood", name: "彩色木作", material: "soft", align: "end" },
  { id: "screenprint", name: "丝网印刷", material: "print", align: "start" },
] as const;

export type StudioTheme = typeof studioThemes[number];
export type StudioThemeId = StudioTheme["id"];
export type StudioArtworkVariant = "home" | "projects" | "assets" | "access" | "account" | "workspace";
export const studioThemeSessionKey = "yingya-studio-theme-v1";

export function resolveStudioTheme(value: unknown): StudioTheme | undefined {
  return studioThemes.find(theme => theme.id === value);
}

export function randomStudioTheme(previous?: StudioThemeId, random = Math.random): StudioTheme {
  const candidates = studioThemes.filter(theme => theme.id !== previous);
  const sample = random();
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor((Number.isFinite(sample) ? sample : 0) * candidates.length)));
  return candidates[index];
}

// Storage is optional (private mode, embedded browsers); the provider still holds
// the selection in memory so rendering and navigation never reroll the theme.
export function initialStudioTheme(storage?: Pick<Storage, "getItem" | "setItem">): StudioTheme {
  try {
    const saved = resolveStudioTheme(storage?.getItem(studioThemeSessionKey));
    if (saved) return saved;
  } catch { /* Use an in-memory selection when storage is unavailable. */ }
  const next = randomStudioTheme();
  try { storage?.setItem(studioThemeSessionKey, next.id); } catch { /* Optional persistence. */ }
  return next;
}
