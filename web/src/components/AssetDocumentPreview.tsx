import { useEffect, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import MarkdownPreview from "./MarkdownPreview";
import type { AssetLibraryItem } from "../types";

import { assetDocumentKind, csvRows, isOfficeDocument, readDocument, type DocumentKind, type DocumentContent } from "../assetDocuments";
export { assetDocumentKind };

export function useDocumentContent(asset: AssetLibraryItem, kind: DocumentKind, enabled: boolean, retry = 0, thumbnail = false) {
  const [document, setDocument] = useState<DocumentContent | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setDocument(null); setError("");
    void readDocument(asset, kind, controller.signal, thumbnail).then(value => {
      if (!controller.signal.aborted) setDocument(value);
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "文件读取失败，请重试");
    });
    return () => controller.abort();
  }, [asset.url, kind, enabled, retry, thumbnail]);
  return { document, error };
}

export function DocumentTable({ rows }: { rows: string[][] }) {
  return <table><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{cell}</td>)}</tr>)}</tbody></table>;
}

export function OfficeContent({ document }: { document: DocumentContent }) {
  return <>{document.text ? <pre>{document.text}</pre> : null}{document.sections?.map((section, index) => <section key={index}>{section.title ? <h3>{section.title}</h3> : null}{section.rows ? <DocumentTable rows={section.rows}/> : <pre>{section.text || "这一页没有可预览的文字"}</pre>}</section>)}</>;
}

export default function AssetDocumentPreview({ asset, kind }: { asset: AssetLibraryItem; kind: DocumentKind }) {
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState(false);
  const { document, error } = useDocumentContent(asset, kind, true, retry);
  const content = document?.text ?? null;
  let formatted = content; let invalidJson = false;
  if (content !== null && kind === "json") {
    try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { invalidJson = true; }
  }
  const canRender = kind === "html" || kind === "markdown";
  return <div className="asset-document-preview">
    <div className="asset-document-toolbar"><b>文件预览</b>{canRender ? <div role="group" aria-label="文件显示方式"><button aria-pressed={!source} onClick={() => setSource(false)}>预览</button><button aria-pressed={source} onClick={() => setSource(true)}>源码</button></div> : <span>{isOfficeDocument(kind) ? kind.toUpperCase() : kind === "csv" ? "CSV" : kind === "json" ? "JSON" : "文本"}</span>}</div>
    {error ? <div className="asset-document-status" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>重新读取</button></div> : content === null ? <p className="asset-document-status" role="status"><CircleNotch className="spin"/>正在读取文件…</p> : document && isOfficeDocument(kind) ? <><p className="asset-document-note">文字与表格预览，完整排版请下载文件{document.truncated ? "；较长内容已截取" : ""}</p><div className="asset-document-body asset-office-body"><OfficeContent document={document}/>{!document.text && !document.sections?.length ? <p>文档没有可预览的文字</p> : null}</div></> : content === "" ? <p className="asset-document-status">这是一个空文件</p> : kind === "csv" ? <><p className="asset-document-note">预览前 200 行、30 列，完整数据请下载文件</p><div className="asset-document-body asset-office-body"><DocumentTable rows={csvRows(content)}/></div></> : kind === "html" && !source ? <iframe title={`${asset.sourceName ?? "HTML"} 文件预览`} sandbox="" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; base-uri 'none'; form-action 'none'">${content}`}/> : kind === "markdown" && !source ? <div className="asset-document-body markdown-body"><MarkdownPreview>{content}</MarkdownPreview></div> : <>{invalidJson ? <p className="asset-document-status">JSON 格式有误，显示原始内容</p> : null}<pre className="asset-document-body"><code>{source ? content : formatted}</code></pre></>}
  </div>;
}
