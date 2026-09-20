import { useRef } from "react";
import { useAutosizeTextarea } from "../hooks/useAutosizeTextarea";
import { BoundingBox, Clock, X } from "@phosphor-icons/react";
import type { VisualFeedback } from "../types";
import type { FeedbackDraft } from "../hooks/useFeedbackDraft";
import { api } from "../api";
import { useBlobUrl } from "./VideoAnnotationEditor";

export function FeedbackCard({ projectId, feedback, versionLabel, disabled, onRemove, onNote, onAnnotate }: {
  projectId: string; feedback: VisualFeedback | FeedbackDraft; versionLabel?: string; disabled?: boolean;
  onRemove?: () => void; onNote?: (note: string) => void; onAnnotate?: () => void;
}) {
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(noteRef, feedback.note);
  const blobUrl = useBlobUrl("blob" in feedback ? feedback.blob : undefined);
  const url = "screenshotPath" in feedback && feedback.screenshotPath ? api.fileUrl(projectId, feedback.screenshotPath) : blobUrl;
  const label = `${versionLabel ?? feedback.versionId} · ${feedback.timeSeconds.toFixed(2)}${feedback.kind === "video-range" ? `–${feedback.endSeconds.toFixed(2)}` : ""} 秒`;
  return <article className="visual-feedback-card" data-feedback-id={feedback.id}>
    {feedback.kind === "video-frame" ? <a href={url || undefined} target="_blank" rel="noreferrer" aria-label={`查看 ${feedback.timeSeconds.toFixed(2)} 秒的标注截图`}>{url ? <img src={url} alt="带选区的画面截图"/> : <span>截图加载中</span>}</a> : <Clock className="feedback-time-icon" aria-hidden="true"/>}
    <div><b>{label}</b>{onNote ? <textarea ref={noteRef} aria-label={`${label} 的修改要求`} value={feedback.note} onChange={event => onNote(event.target.value)} disabled={disabled} maxLength={2000} rows={1} placeholder="描述这里需要如何修改"/> : <p>{feedback.note}</p>}
      {onRemove ? <div className="feedback-card-actions"><small>{feedback.kind === "video-frame" ? "已附画面标注" : feedback.kind === "video-range" ? "时间范围反馈" : "时间点反馈"} · 待发送</small>{onAnnotate ? <button type="button" onClick={onAnnotate} disabled={disabled}><BoundingBox/>{feedback.kind === "video-frame" ? "重新框选" : "补充画面标注"}</button> : null}</div> : <a href={`${api.fileUrl(projectId, feedback.videoPath)}#t=${feedback.timeSeconds}`} target="_blank" rel="noreferrer">查看原视频时间点</a>}
    </div>{onRemove ? <button type="button" disabled={disabled} onClick={onRemove} aria-label={`移除修改意见 ${feedback.note || label}`}><X/></button> : null}
  </article>;
}
