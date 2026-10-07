import type { AssetLibraryItem } from "./types";

export type DocumentKind = "html" | "json" | "markdown" | "text" | "csv" | "docx" | "xlsx" | "pptx";
export type DocumentSection = { title?: string; text?: string; rows?: string[][] };
export type DocumentContent = { text: string; sections?: DocumentSection[]; truncated: boolean };
export const isOfficeDocument = (kind: DocumentKind) => ["docx", "xlsx", "pptx"].includes(kind);

export function assetDocumentKind(asset: AssetLibraryItem): DocumentKind | null {
  const extension = (asset.sourceName?.match(/\.([a-z0-9]+)$/i)?.[1] ?? asset.url.split(/[?#]/)[0].split(".").pop())?.toLowerCase();
  const mime = asset.mimeType.split(";")[0].trim().toLowerCase();
  for (const [kind, subtype] of [["docx", "wordprocessingml.document"], ["xlsx", "spreadsheetml.sheet"], ["pptx", "presentationml.presentation"]] as const) {
    if (extension === kind || mime === `application/vnd.openxmlformats-officedocument.${subtype}`) return kind;
  }
  if (["html", "htm"].includes(extension ?? "") || mime === "text/html") return "html";
  if (extension === "json" || mime === "application/json" || mime.endsWith("+json")) return "json";
  if (["md", "markdown"].includes(extension ?? "") || mime === "text/markdown") return "markdown";
  if (extension === "csv" || mime === "text/csv") return "csv";
  if (mime.startsWith("text/") || ["txt", "yaml", "yml", "xml", "log", "js", "jsx", "ts", "tsx", "css", "py", "rs", "sql", "sh"].includes(extension ?? "")) return "text";
  return null;
}

export async function readDocument(asset: AssetLibraryItem, kind: DocumentKind, signal: AbortSignal, thumbnail = false): Promise<DocumentContent> {
  const office = isOfficeDocument(kind);
  const limit = office ? 12 * 1024 * 1024 : thumbnail ? 32 * 1024 : 2 * 1024 * 1024;
  const response = await fetch(asset.url, { signal });
  if (!response.ok) throw new Error("文件读取失败，请重试");
  if ((!thumbnail || office) && Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("文件较大，请下载后查看");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("文件内容无法读取");
  const chunks: Uint8Array[] = [];
  let size = 0, truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > limit) {
        if (!thumbnail || office) throw new Error("文件较大，请下载后查看");
        chunks.push(value.subarray(0, limit - size)); size = limit; truncated = true; break;
      }
      chunks.push(value); size += value.byteLength;
    }
  } finally { await reader.cancel(); }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (office) return (await import("./officePreview")).readOfficeDocument(bytes, kind, signal, thumbnail);
  const text = new TextDecoder().decode(bytes);
  return { text, truncated };
}

export function csvRows(text: string, maxRows = 200): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const pushCell = () => { if (row.length < 30) row.push(cell); cell = ""; };
  for (let i = 0; i < text.length && rows.length < maxRows; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { if (cell.length < 2000) cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ",") pushCell();
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      pushCell(); rows.push(row); row = [];
    } else if (cell.length < 2000) cell += char;
  }
  if ((cell || row.length) && rows.length < maxRows) { pushCell(); rows.push(row); }
  return rows;
}

export function htmlExcerpt(text: string) {
  const html = new DOMParser().parseFromString(text, "text/html");
  html.querySelectorAll("script, style, noscript, template, iframe, object").forEach(element => element.remove());
  return (html.body.textContent ?? "").replace(/\n\s*\n/g, "\n\n").trim();
}
