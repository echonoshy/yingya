/** A fixed paper UI; the other illustration families remain in the asset library. */
export const studioTheme = { id: "paper", name: "纸上放映室", material: "paper" } as const;
export type StudioArtworkVariant = "home" | "projects" | "assets" | "access" | "account" | "workspace";
export const studioThemeSessionKey = "yingya-studio-theme-v1";

/** Migrate only the former theme preference, never drafts or account settings. */
export function initialStudioTheme(storage?: Pick<Storage, "setItem">) {
  try { storage?.setItem(studioThemeSessionKey, studioTheme.id); } catch { /* Storage is optional. */ }
  return studioTheme;
}
