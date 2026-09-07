import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api";
import { projectFilePath } from "../projectFiles";

export default function MarkdownPreview({ children, projectId, compact = false }: { children: string; projectId?: string; compact?: boolean }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: ({ children }) => compact ? <details className="message-technical-detail"><summary>查看文件与执行详情</summary><pre>{children}</pre></details> : <pre>{children}</pre>, a: ({ href, children }) => {
    const path = href && projectId ? projectFilePath(href, projectId) : null;
    const resolved = path && projectId ? api.fileUrl(projectId, path) : href;
    if (!resolved || (!path && !/^(https?:|mailto:|#)/i.test(resolved))) return <span title="文件链接不可用，请从项目文件中查看">{children}（链接不可用）</span>;
    return <a href={resolved} target={resolved.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{children}</a>;
  } }}>{children}</ReactMarkdown>;
}
