import { X } from "@phosphor-icons/react";
import type { VisualFeedback } from "../types";
import type { FeedbackDraft } from "../hooks/useFeedbackDraft";
import { api } from "../api";
import { useBlobUrl } from "./VideoAnnotationEditor";

export function FeedbackCard({ projectId, feedback, onRemove }: { projectId: string; feedback: VisualFeedback | FeedbackDraft; onRemove?: () => void }) {
  const blobUrl = useBlobUrl("blob" in feedback ? feedback.blob : undefined);
  const url = "screenshotPath" in feedback ? api.fileUrl(projectId, feedback.screenshotPath) : blobUrl;
  return <article className="visual-feedback-card"><a href={url || undefined} target="_blank" rel="noreferrer" aria-label={`查看 ${feedback.timeSeconds.toFixed(2)} 秒的标注截图`}>{url ? <img src={url} alt="带选区的画面截图"/> : <span>截图加载中</span>}</a><div><b>{feedback.versionId} · {feedback.timeSeconds.toFixed(2)} 秒</b><p>{feedback.note}</p>{onRemove ? <small>截图已附上 · 待发送</small> : <a href={`${api.fileUrl(projectId, feedback.videoPath)}#t=${feedback.timeSeconds}`} target="_blank" rel="noreferrer">查看原视频时间点</a>}</div>{onRemove ? <button type="button" onClick={onRemove} aria-label={`移除画面标注 ${feedback.note}`}><X/></button> : null}</article>;
}
