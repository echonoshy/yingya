import type { AssetLibraryItem } from "./schemas";

type NamedAsset = Pick<AssetLibraryItem, "id" | "mimeType"> & Partial<Pick<AssetLibraryItem, "sourceName" | "category" | "projectPath">>;
const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg", "video/mp4": "mp4", "audio/wav": "wav", "audio/mpeg": "mp3", "application/pdf": "pdf", "text/plain": "txt" };

/** Display and download names never use generation prompts. Existing labels win. */
export function assetName(asset: NamedAsset): string {
  if (asset.sourceName?.trim()) return asset.sourceName.trim();
  const extension = extensions[asset.mimeType] || asset.projectPath?.match(/\.([a-z0-9]{1,12})$/i)?.[1] || "bin";
  const kind = asset.category || asset.mimeType.split("/")[0];
  const prefix = ["image", "video", "audio", "document"].includes(kind) ? kind : "file";
  return `${prefix}_${asset.id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36) || "asset"}.${extension}`;
}
