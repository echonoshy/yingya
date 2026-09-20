import type { EditorDocument } from "./model.mjs";
export const fontFamilies: Record<string, string>;
export function compileHTML(
  document: EditorDocument,
  options?: {
    assetUrl?: (path: string) => string;
    gsapUrl?: string;
    fontCss?: string;
    interactive?: boolean;
  },
): string;
