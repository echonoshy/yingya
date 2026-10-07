import { lazy, Suspense, useState } from "react";
import { ArrowClockwise, DownloadSimple, Plus } from "@phosphor-icons/react";
import { api } from "../api";
import { filePreviewKind } from "../projectFiles";
import { assetDocumentKind } from "../assetDocuments";
import type { Artifact, AssetLibraryItem } from "../types";
import { ActionDialog } from "./ActionDialog";
const AssetDocumentPreview = lazy(() => import("./AssetDocumentPreview"));
const AssetPdfPreview = lazy(() => import("./AssetPdfPreview"));

export function ProjectFilePreview({ projectId, artifact, onClose, onContext }: { projectId: string; artifact: Artifact; onClose: () => void; onContext: (value: string) => void }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const url = api.fileUrl(projectId, artifact.path);
  const kind = filePreviewKind(artifact.path);
  const asset: AssetLibraryItem = { id: artifact.id, url, projectPath: artifact.path, sourceName: artifact.path.split("/").at(-1), mimeType: "application/octet-stream", category: "document", kind: "generated", createdAt: 0, prompt: undefined, folderId: undefined };
  const documentKind = assetDocumentKind(asset);
  return <ActionDialog title={artifact.label} className="project-file-dialog" closeLabel="关闭文件预览" dismissOnBackdrop onClose={onClose}>
    <div className="project-file-toolbar"><span title={artifact.path}>{artifact.path}</span><button onClick={() => onContext(`文件「${artifact.label}」（${artifact.path}）`)}><Plus/>加入对话</button><a href={url} download={asset.sourceName}><DownloadSimple/>下载</a></div>
    <div className="project-file-body" key={retry}>
      {failed ? <div className="project-content-empty" role="alert"><p>文件暂时无法预览，请重试或下载查看。</p><button onClick={() => { setFailed(false); setRetry(value => value + 1); }}><ArrowClockwise/>重新加载</button></div>
      : kind === "image" ? <img src={`${url}?preview=${retry}`} alt={artifact.label} onError={() => setFailed(true)}/>
      : kind === "video" ? <video src={url} controls playsInline preload="metadata" onError={() => setFailed(true)}/>
      : kind === "audio" ? <div className="project-file-audio"><p>{artifact.label}</p><audio src={url} controls preload="metadata" onError={() => setFailed(true)}/></div>
      : /\.pdf$/i.test(artifact.path) ? <Suspense fallback={<p role="status">正在加载文档…</p>}><AssetPdfPreview asset={asset}/></Suspense>
      : documentKind ? <Suspense fallback={<p role="status">正在加载文档…</p>}><AssetDocumentPreview asset={asset} kind={documentKind}/></Suspense>
      : <div className="project-content-empty"><p>此格式暂不支持在线预览，可以下载后查看。</p><a href={url} download={asset.sourceName}>下载文件</a></div>}
    </div>
  </ActionDialog>;
}
