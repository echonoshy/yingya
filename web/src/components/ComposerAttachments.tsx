import { assetName } from "../assetNames";
import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CircleNotch, DownloadSimple, File, FileAudio, FilePdf, FileText, ImageSquare, Play, VideoCamera, Warning, X } from "@phosphor-icons/react";
import { assetDocumentKind } from "../assetDocuments";
import { filePreviewKind } from "../projectFiles";
import { fileRoleKey } from "../workbench";
import type { AssetLibraryItem } from "../types";
import type { UploadItem } from "../hooks/useUploadQueue";
import { ActionDialog } from "./ActionDialog";
import "./composer-attachments.css";

const AssetDocumentPreview = lazy(() => import("./AssetDocumentPreview"));
const AssetPdfPreview = lazy(() => import("./AssetPdfPreview"));
const emptyAssets: AssetLibraryItem[] = [];
const emptyUploads: UploadItem[] = [];

function kindFor(name: string, mime: string) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return filePreviewKind(name);
}

function Attachment({ file, asset, upload, disabled, onRemove }: {
  file?: File; asset?: AssetLibraryItem; upload?: UploadItem; disabled: boolean; onRemove: () => void;
}) {
  const [localUrl, setLocalUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setLocalUrl(url); setThumbnailFailed(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const name = file?.name || (asset ? assetName(asset) : "未命名文件");
  const mime = file?.type || asset?.mimeType || "application/octet-stream";
  const url = file ? localUrl : asset?.url ?? "";
  const kind = kindFor(name, mime);
  const pdf = mime === "application/pdf" || /\.pdf$/i.test(name);
  const media = kind === "image" || kind === "video";
  const Icon = pdf ? FilePdf : kind === "audio" ? FileAudio : kind === "video" ? VideoCamera : kind === "image" ? ImageSquare : kind === "text" || kind === "markdown" || asset?.category === "document" ? FileText : File;
  const extension = name.includes(".") ? name.split(".").at(-1)?.toUpperCase().slice(0, 8) : "文件";
  const size = file ? file.size < 1024 ? `${file.size} B` : file.size < 1024 * 1024 ? `${Math.ceil(file.size / 1024)} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB` : "";
  const pending = upload && ["queued", "uploading", "processing"].includes(upload.status);
  const status = upload?.status === "error" ? "上传失败" : upload?.status === "queued" ? "等待上传" : upload?.status === "processing" ? "正在保存" : `正在上传${upload?.progress === undefined ? "" : ` ${upload.progress}%`}`;
  const previewAsset: AssetLibraryItem = asset ?? { id: fileRoleKey(file!), url, sourceName: name, projectPath: name, mimeType: mime, kind: "uploaded", category: "file", createdAt: 0, prompt: undefined, folderId: undefined };
  return <li className={`composer-attachment${media ? " composer-attachment--media" : ""}`} data-state={upload?.status}>
    <button type="button" className="composer-attachment-preview" aria-label={`预览附件 ${name}`} title={name} disabled={!url} onClick={() => setOpen(true)}>
      {media && !thumbnailFailed && url ? kind === "image" ? <img src={url} alt={name} onError={() => setThumbnailFailed(true)}/> : <><video src={url} muted playsInline preload="metadata" onLoadedMetadata={event => { const video = event.currentTarget; if (Number.isFinite(video.duration)) video.currentTime = Math.min(.1, video.duration / 2); }} onError={() => setThumbnailFailed(true)}/><Play className="composer-attachment-play" weight="fill" aria-hidden="true"/></> : <Icon className="composer-attachment-icon" aria-hidden="true"/>}
      {!media ? <span className="composer-attachment-copy"><b>{name}</b><small>{[extension, size].filter(Boolean).join(" · ")}</small></span> : null}
    </button>
    <button type="button" className="composer-attachment-remove" disabled={disabled} aria-label={`移除 ${name}`} title={`移除 ${name}`} onClick={onRemove}><X aria-hidden="true"/></button>
    {pending || upload?.status === "error" ? <span className="composer-attachment-status" role="status" title={upload?.error || status}>{upload?.status === "error" ? <Warning aria-hidden="true"/> : <CircleNotch className="spin" aria-hidden="true"/>}<span>{status}</span></span> : null}
    {open ? createPortal(<AttachmentPreview asset={previewAsset} kind={kind} pdf={pdf} onClose={() => setOpen(false)}/>, document.body) : null}
  </li>;
}

function AttachmentPreview({ asset, kind, pdf, onClose }: { asset: AssetLibraryItem; kind: ReturnType<typeof kindFor>; pdf: boolean; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const name = assetName(asset);
  const documentKind = assetDocumentKind(asset);
  return <ActionDialog title={name} className="composer-attachment-dialog" closeLabel="关闭附件预览" onClose={onClose} dismissOnBackdrop>
    <div className="composer-attachment-view">
      {failed ? <p role="alert">暂时无法预览此文件，可以下载后查看。</p>
        : kind === "image" ? <img src={asset.url} alt={name} onError={() => setFailed(true)}/>
        : kind === "video" ? <video src={asset.url} controls playsInline preload="metadata" onError={() => setFailed(true)}/>
        : kind === "audio" ? <audio src={asset.url} controls preload="metadata" onError={() => setFailed(true)}/>
        : pdf ? <Suspense fallback={<p role="status">正在读取文件…</p>}><AssetPdfPreview asset={asset}/></Suspense>
        : documentKind ? <Suspense fallback={<p role="status">正在读取文件…</p>}><AssetDocumentPreview asset={asset} kind={documentKind}/></Suspense>
        : <p>此格式暂不支持预览，可以下载后查看。</p>}
    </div>
    <a className="composer-attachment-download" href={asset.url} download={name}><DownloadSimple aria-hidden="true"/>下载文件</a>
  </ActionDialog>;
}

export function ComposerAttachments({ files, assets = emptyAssets, uploads = emptyUploads, disabled = false, onRemoveFile, onRemoveAsset }: {
  files: File[]; assets?: AssetLibraryItem[]; uploads?: UploadItem[]; disabled?: boolean;
  onRemoveFile: (file: File) => void; onRemoveAsset?: (asset: AssetLibraryItem) => void;
}) {
  if (!files.length && !assets.length) return null;
  return <ul className="composer-attachments" aria-label="参考附件">
    {files.map((file, index) => <Attachment key={`${fileRoleKey(file)}:${index}`} file={file} upload={uploads.find(item => item.id === `file:${fileRoleKey(file)}`)} disabled={disabled} onRemove={() => onRemoveFile(file)}/>)}
    {assets.map(asset => <Attachment key={`library:${asset.id}`} asset={asset} upload={uploads.find(item => item.id === `library:${asset.id}`)} disabled={disabled} onRemove={() => onRemoveAsset?.(asset)}/>)}
  </ul>;
}
