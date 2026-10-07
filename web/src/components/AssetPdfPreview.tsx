import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, CircleNotch, FilePdf, Minus, Plus } from "@phosphor-icons/react";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import type { AssetLibraryItem } from "../types";
import "./asset-pdf.css";

export function isPdfAsset(asset: AssetLibraryItem) {
  return asset.mimeType.split(";")[0].trim().toLowerCase() === "application/pdf"
    || /\.pdf$/i.test(asset.sourceName ?? "") || /\.pdf$/i.test(asset.url.split(/[?#]/)[0]);
}

function usePdf(url: string, enabled: boolean, retry: number) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setPdf(null); setError("");
    if (!enabled) return;
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    void import("../pdf").then(async ({ loadPdf }) => {
      if (cancelled) return;
      task = loadPdf(url);
      const document = await task.promise;
      if (!cancelled) setPdf(document);
    }).catch(reason => {
      if (!cancelled) setError(reason?.name === "PasswordException" ? "此 PDF 已加密，请下载后输入密码查看" : "PDF 预览未能加载，请重试或下载文件");
    });
    return () => { cancelled = true; void task?.destroy().catch(() => undefined); };
  }, [url, enabled, retry]);
  return { pdf, error };
}

function PdfPage({ pdf, page, zoom = 1, thumbnail = false, onError }: { pdf: PDFDocumentProxy; page: number; zoom?: number; thumbnail?: boolean; onError: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width || !container.current) return;
    const root = container.current;
    let cancelled = false;
    let render: RenderTask | undefined;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `PDF 第 ${page} 页`);
    setReady(false);
    void pdf.getPage(page).then(async documentPage => {
      if (cancelled) return;
      const original = documentPage.getViewport({ scale: 1 });
      const cssWidth = thumbnail ? Math.min(width, (root.clientHeight || width) * original.width / original.height) : width * zoom;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = documentPage.getViewport({ scale: cssWidth / original.width * scale });
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      canvas.style.width = `${cssWidth}px`; canvas.style.height = `${viewport.height / scale}px`;
      render = documentPage.render({ canvas, viewport });
      await render.promise;
      if (!cancelled) { root.replaceChildren(canvas); setReady(true); }
    }).catch(reason => { if (!cancelled && reason?.name !== "RenderingCancelledException") onErrorRef.current(); });
    // Keep the displayed page while its replacement renders offscreen. Removing
    // it here collapses the reader and shifts the drawer heading on every turn.
    return () => { cancelled = true; render?.cancel(); };
  }, [pdf, page, width, zoom, thumbnail]);
  return <div className={`asset-pdf-page ${thumbnail ? "asset-pdf-page--thumbnail" : ""}`} aria-busy={!ready} ref={container}/>;
}

export function PdfThumbnail({ asset }: { asset: AssetLibraryItem }) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const { pdf, error } = usePdf(asset.url, visible, 0);
  useEffect(() => {
    if (!root.current) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "160px" });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  return <span ref={root} className="asset-card-image asset-card-pdf" aria-hidden="true">
    {pdf && !renderFailed ? <PdfPage pdf={pdf} page={1} thumbnail onError={() => setRenderFailed(true)}/> : <FilePdf/>}
    {error || renderFailed ? <span className="asset-pdf-thumb-hint">预览不可用</span> : null}<mark>PDF</mark>
  </span>;
}

export default function AssetPdfPreview({ asset }: { asset: AssetLibraryItem }) {
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [renderFailed, setRenderFailed] = useState(false);
  const { pdf, error } = usePdf(asset.url, true, retry);
  const failure = error || (renderFailed ? "这一页未能显示，请重试或下载文件" : "");
  return <div className="asset-document-preview asset-pdf-preview">
    <div className="asset-pdf-toolbar">
      <div role="group" aria-label="PDF 翻页">
        <button aria-label="上一页" disabled={!pdf || page <= 1} onClick={() => setPage(value => value - 1)}><CaretLeft/></button>
        <span aria-live="polite">{pdf ? `${page} / ${pdf.numPages} 页` : "PDF 预览"}</span>
        <button aria-label="下一页" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(value => value + 1)}><CaretRight/></button>
      </div>
      <div role="group" aria-label="PDF 缩放">
        <button aria-label="缩小 PDF" disabled={zoom <= 0.5 || !pdf} onClick={() => setZoom(value => value - 0.25)}><Minus/></button>
        <button aria-label="PDF 适应宽度" disabled={!pdf} onClick={() => setZoom(1)}>{zoom === 1 ? "适应宽度" : `${Math.round(zoom * 100)}%`}</button>
        <button aria-label="放大 PDF" disabled={zoom >= 2 || !pdf} onClick={() => setZoom(value => value + 0.25)}><Plus/></button>
      </div>
    </div>
    {failure ? <div className="asset-document-status" role="alert"><p>{failure}</p><button onClick={() => { setRenderFailed(false); setRetry(value => value + 1); }}>重新加载 PDF</button><a href={asset.url} download={asset.sourceName ?? "document.pdf"}>下载 PDF</a></div> : !pdf ? <p className="asset-document-status" role="status"><CircleNotch className="spin"/>正在读取 PDF…</p> : <div className="asset-pdf-scroll" tabIndex={0} aria-label="PDF 页面"><PdfPage pdf={pdf} page={page} zoom={zoom} onError={() => setRenderFailed(true)}/></div>}
  </div>;
}
