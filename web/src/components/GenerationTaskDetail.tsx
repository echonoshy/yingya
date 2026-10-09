import type { ImageJob, VoiceJob } from "../schemas";
import { ActionDialog } from "./ActionDialog";
import { GenerationStatus, ImageJobDetail } from "./ImageGeneration";
export function GenerationTaskDetail({ image, voice, onClose, onReuse, onLibrary, onVoices }: { image?: ImageJob; voice?: VoiceJob; onClose: () => void; onReuse: () => void; onLibrary: () => void; onVoices: () => void }) {
  if (!image && !voice) return null;
  return <ActionDialog className="image-job-dialog" title={image ? "图片生成记录" : "音色创建记录"} dismissOnBackdrop onClose={onClose}>
    {image ? <ImageJobDetail job={image} onReuse={onReuse} onLibrary={onLibrary}/> : voice ? <div className="image-job-detail"><GenerationStatus status={voice.status}/><h3>{voice.name}</h3><p role="status">{voice.status === "running" ? "音色正在创建，关闭页面后任务会继续。" : voice.status === "completed" ? "音色已保存。可到音色库试听和管理；已删除的音色仍保留此创建记录。" : voice.error || "创建未完成，请编辑后重试。"}</p><p>{voice.mode === "design" ? "描述生成" : "克隆音色"} · {new Date(voice.createdAt).toLocaleString("zh-CN")}</p><section><h3>声音描述</h3><p>{voice.description || "未填写说明"}</p></section>{voice.refText ? <section><h3>参考音频原文</h3><p>{voice.refText}</p><small>{voice.referenceName}</small></section> : null}<div className="generation-result-actions">{voice.status !== "running" ? <button onClick={onReuse}>{voice.status === "failed" ? "编辑后重试" : "复用参数"}</button> : null}{voice.status === "completed" ? <button onClick={onVoices}>前往音色库</button> : null}</div></div> : null}
  </ActionDialog>;
}
