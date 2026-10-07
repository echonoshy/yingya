import { useEffect, useRef, useState } from "react";
import { FileText } from "@phosphor-icons/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AssetLibraryItem } from "../types";
import { csvRows, htmlExcerpt, isOfficeDocument, type DocumentKind } from "../assetDocuments";
import { DocumentTable, OfficeContent, useDocumentContent } from "./AssetDocumentPreview";
import "./asset-documents.css";

export function AssetDocumentThumbnail({ asset, kind, format }: { asset: AssetLibraryItem; kind: DocumentKind; format: string }) {
  const root = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const { document, error } = useDocumentContent(asset, kind, visible, 0, true);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "120px" });
    const size = new ResizeObserver(([entry]) => element.style.setProperty("--document-scale", String(Math.max(0, entry.contentRect.width - 20) / 560)));
    observer.observe(element); size.observe(element);
    return () => { observer.disconnect(); size.disconnect(); };
  }, []);
  let text = document?.text ?? "";
  if (kind === "html") text = htmlExcerpt(text);
  if (kind === "json") { try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* A partial excerpt remains useful. */ } }
  return <span ref={root} className="asset-card-image asset-card-document asset-card-document-content" aria-hidden="true">
    {document && !error ? <span className="asset-document-sheet" inert>
      {isOfficeDocument(kind) ? <OfficeContent document={document}/> : kind === "markdown" ? <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children }) => <span>{children}</span>, img: ({ alt }) => <span>{alt ? `[${alt}]` : "[图片]"}</span>, input: () => null }}>{text.slice(0, 8000)}</ReactMarkdown> : kind === "csv" ? <DocumentTable rows={csvRows(text, 12)}/> : <pre>{text.slice(0, 8000) || "空白文档"}</pre>}
    </span> : <FileText/>}<mark>{format}</mark>
  </span>;
}
