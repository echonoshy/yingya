import { GlobalWorkerOptions, PDFWorker, getDocument } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?worker&url";

// Vite gives auxiliary PDF resources immutable URLs, served from our own origin.
const resources = import.meta.glob<string>([
  "../../node_modules/pdfjs-dist/cmaps/*.bcmap",
  "../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
  "../../node_modules/pdfjs-dist/wasm/*.wasm",
], { query: "?url&no-inline", import: "default", eager: true });
const resourceUrls = new Map(Object.entries(resources).map(([path, url]) => [path.split("/").slice(-2).join("/"), url]));
class PdfResources {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const folder = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" }[kind];
    const url = resourceUrls.get(`${folder}/${filename}`);
    if (!url) throw new Error("PDF 资源不可用");
    const response = await fetch(url);
    if (!response.ok) throw new Error("PDF 资源加载失败");
    return new Uint8Array(await response.arrayBuffer());
  }
}

GlobalWorkerOptions.workerSrc = workerUrl;
let worker: PDFWorker | undefined;
export function loadPdf(url: string) {
  worker ??= new PDFWorker();
  return getDocument({ url, worker, BinaryDataFactory: PdfResources, useWorkerFetch: false, cMapPacked: true });
}
