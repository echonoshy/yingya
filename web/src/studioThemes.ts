/** A unified character studio; stored preference IDs remain compatible. */
export const studioTheme = { id: "comic", name: "想法成形", material: "print" } as const;
export type StudioArtworkVariant = "home" | "marketing" | "projects" | "assets" | "access" | "account" | "workspace" | "empty";
export const studioThemeSessionKey = "yingya-studio-theme-v1";

/** Migrate only the former theme preference, never drafts or account settings. */
export function initialStudioTheme(storage?: Pick<Storage, "setItem">) {
  try { storage?.setItem(studioThemeSessionKey, studioTheme.id); } catch { /* Storage is optional. */ }
  return studioTheme;
}
