import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, BoundingBox, X } from "@phosphor-icons/react";
import type { FeedbackRegion } from "../types";
import type { FeedbackDraft } from "../hooks/useFeedbackDraft";
import { createClientRequestId } from "../requestId";
import { keyboardRegion, pointInFrame, regionFromPoints, type Point } from "../feedback/geometry";
import { markFrame, type CapturedFrame } from "../feedback/captureFrame";

export function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) { setUrl(""); return; }
    const next = URL.createObjectURL(blob); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

export function VideoAnnotationEditor({ frame, versionId, versionLabel, videoPath, onAdd, onClose }: {
  frame: CapturedFrame; versionId: string; versionLabel: string; videoPath: string;
  onAdd: (draft: FeedbackDraft) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const origin = useRef<Point | null>(null);
  const [region, setRegion] = useState<FeedbackRegion | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = useBlobUrl(frame.blob);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function save() {
    if (!region || !note.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const color = getComputedStyle(dialog.current!).getPropertyValue("--accent").trim();
      const blob = await markFrame(frame, region, color);
      onAdd({ id: createClientRequestId(), kind: "video-frame", versionId, videoPath, timeSeconds: frame.time, frameWidth: frame.width, frameHeight: frame.height, region, note: note.trim(), blob, createdAt: Date.now() });
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "标注保存失败，请重试"); }
    finally { setBusy(false); }
  }
  return createPortal(<dialog className="annotation-dialog" ref={dialog} aria-labelledby="annotation-heading" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><h2 id="annotation-heading">标注这一帧</h2><p>{versionLabel} · {frame.time.toFixed(2)} 秒 · 已冻结画面</p></div><button type="button" aria-label="关闭画面标注" disabled={busy} onClick={onClose}><X/></button></header>
    <div className="annotation-body"><div className="annotation-stage"><div className="annotation-frame" ref={area} style={{ aspectRatio: `${frame.width} / ${frame.height}` }} tabIndex={0} role="group" aria-label="画面选区" aria-describedby="annotation-help"
      onKeyDown={event => { if (busy || !event.key.startsWith("Arrow")) return; event.preventDefault(); setRegion(keyboardRegion(region ?? { x: .25, y: .25, width: .5, height: .5 }, event.key, event.shiftKey)); }}
      onPointerDown={event => { if (busy || event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); origin.current = pointInFrame(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()); setRegion(null); }}
      onPointerMove={event => { if (!origin.current) return; setRegion(regionFromPoints(origin.current, pointInFrame(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect()))); }}
      onPointerUp={() => { origin.current = null; setRegion(current => current && current.width >= .01 && current.height >= .01 ? current : null); }} onPointerCancel={() => { origin.current = null; }}>
      {url ? <img src={url} alt={`${versionLabel} 在 ${frame.time.toFixed(2)} 秒的冻结画面`} draggable={false}/> : null}
      {region ? <span className="annotation-region" style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}><b>1</b></span> : null}
    </div></div>
    <div className="annotation-fields"><p id="annotation-help">拖动框选修改位置。键盘方向键移动选区，Shift + 方向键调整大小。</p><div className="annotation-tools"><button type="button" disabled={busy} onClick={() => { setRegion({ x: .25, y: .25, width: .5, height: .5 }); area.current?.focus(); }}><BoundingBox/>居中选区</button><button type="button" disabled={!region || busy} onClick={() => setRegion(null)}>清除选区</button></div>
      <label htmlFor="annotation-note">修改要求</label><textarea id="annotation-note" disabled={busy} maxLength={2000} rows={4} value={note} onChange={event => setNote(event.target.value)} placeholder="例如：把框内的字幕放大一点，保留其他画面"/>
      <p>标注将加入输入区，发送后才会开始修改。</p>{error ? <p className="form-error" role="alert">{error}</p> : null}
    </div></div><footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" type="button" disabled={!region || !note.trim() || busy} onClick={() => void save()}><ArrowLeft/>{busy ? "正在保存截图…" : "加入修改要求"}</button></footer>
  </dialog>, document.body);
}
