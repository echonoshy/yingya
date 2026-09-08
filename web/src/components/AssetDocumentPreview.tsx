import { useEffect, useState } from "react";
import { CircleNotch } from "@phosphor-icons/react";
import MarkdownPreview from "./MarkdownPreview";
import type { AssetLibraryItem } from "../types";

type DocumentKind = "html" | "json" | "markdown" | "text";
export function assetDocumentKind(asset: AssetLibraryItem): DocumentKind | null {
  const extension = (asset.sourceName ?? asset.url.split("?")[0]).split(".").pop()?.toLowerCase();
  const mime = asset.mimeType.split(";")[0].toLowerCase();
  if (["html", "htm"].includes(extension ?? "") || mime === "text/html") return "html";
  if (extension === "json" || mime === "application/json" || mime.endsWith("+json")) return "json";
  if (["md", "markdown"].includes(extension ?? "") || mime === "text/markdown") return "markdown";
  if (mime.startsWith("text/") || ["txt", "csv", "yaml", "yml", "xml", "log"].includes(extension ?? "")) return "text";
  return null;
}

const MAX_BYTES = 2 * 1024 * 1024;
export default function AssetDocumentPreview({ asset, kind }: { asset: AssetLibraryItem; kind: DocumentKind }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setContent(null); setError("");
    void (async () => {
      try {
        const response = await fetch(asset.url, { signal: controller.signal });
        if (!response.ok) throw new Error("文件读取失败，请重试。");
        if (Number(response.headers.get("content-length")) > MAX_BYTES) throw new Error("文件较大，请下载后查看。");
        const reader = response.body?.getReader();
        if (!reader) throw new Error("文件内容无法读取。");
        const decoder = new TextDecoder(); let text = ""; let bytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error("文件较大，请下载后查看。"); }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
        if (!controller.signal.aborted) setContent(text);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "文件读取失败，请重试。");
      }
    })();
    return () => controller.abort();
  }, [asset.url, retry]);
  let formatted = content; let invalidJson = false;
  if (content !== null && kind === "json") {
    try { formatted = JSON.stringify(JSON.parse(content), null, 2); } catch { invalidJson = true; }
  }
  const canRender = kind === "html" || kind === "markdown";
  return <div className="asset-document-preview">
    <div className="asset-document-toolbar"><b>文件预览</b>{canRender ? <div role="group" aria-label="文件显示方式"><button aria-pressed={!source} onClick={() => setSource(false)}>预览</button><button aria-pressed={source} onClick={() => setSource(true)}>源码</button></div> : <span>{kind === "json" ? "JSON" : "文本"}</span>}</div>
    {error ? <div className="asset-document-status" role="alert"><p>{error}</p><button onClick={() => setRetry(value => value + 1)}>重新读取</button></div> : content === null ? <p className="asset-document-status" role="status"><CircleNotch className="spin"/>正在读取文件…</p> : content === "" ? <p className="asset-document-status">这是一个空文件。</p> : kind === "html" && !source ? <iframe title={`${asset.sourceName ?? "HTML"} 文件预览`} sandbox="" referrerPolicy="no-referrer" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; base-uri 'none'; form-action 'none'">${content}`}/> : kind === "markdown" && !source ? <div className="asset-document-body markdown-body"><MarkdownPreview>{content}</MarkdownPreview></div> : <>{invalidJson ? <p className="asset-document-status">JSON 格式有误，显示原始内容。</p> : null}<pre className="asset-document-body"><code>{source ? content : formatted}</code></pre></>}
  </div>;
}
