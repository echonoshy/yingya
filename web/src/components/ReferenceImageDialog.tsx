import { useUploadQueue } from "../hooks/useUploadQueue";
import { UploadProgressList } from "./UploadProgressList";
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CircleNotch, Image, Plus, Sparkle, X } from '@phosphor-icons/react';
import { api } from '../api';
import type { CodexModel, ModelSelection } from '../types';
import { ActionDialog } from './ActionDialog';
import { ModelSelector } from './ModelSelector';
import './reference-image-dialog.css';

export type GeneratedReference = Awaited<ReturnType<typeof api.generateImage>>['images'][number];

/** Use the existing image service; images are saved in the user's library before selection. */
export function ReferenceImageDialog({ open, brief, models, selection, onSelection, onBusyChange, onChoose, onClose }: {
  open: boolean; brief: string; models: CodexModel[]; selection: ModelSelection;
  onSelection: (value: ModelSelection) => void; onBusyChange: (busy: boolean) => void;
  onChoose: (images: GeneratedReference[]) => void; onClose: () => void;
}) {
  const [description, setDescription] = useState('');
  const [references, setReferences] = useState<File[]>([]);
  const uploads = useUploadQueue<Awaited<ReturnType<typeof api.uploadImage>>>();
  const [images, setImages] = useState<GeneratedReference[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const initialized = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open || initialized.current) return;
    initialized.current = true;
    if (brief.trim()) setDescription(`为以下创作生成一张画面参考，探索构图、色彩和质感：\n${brief.trim()}`);
  }, [open, brief]);
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!description.trim() || submitting.current) return;
    const submitted = { prompt: description.trim(), ...selection };
    submitting.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const referenceImages = (await uploads.run(references.map(file => ({ id: `${file.name}:${file.size}:${file.lastModified}`, name: file.name, size: file.size, run: (options: import("../upload").UploadOptions) => api.uploadImage(file, options) })))).map(image => image.url);
      const { threadId } = await api.startImageThread();
      const result = await api.generateImage(threadId, { ...submitted, referenceImages });
      if (!mounted.current) return;
      if (!result.images.length) throw new Error('这次没有生成图片，请补充画面描述后重试。');
      setImages(result.images); setSelected(result.images.map(image => image.id)); setFailedImages([]);
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : '参考图生成失败，描述和附件已保留，请重试。');
    } finally {
      submitting.current = false;
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  }
  if (!open) return null;
  const chosen = images.filter(image => selected.includes(image.id) && !failedImages.includes(image.id));
  return <ActionDialog title="生成参考图" className="reference-image-dialog" onClose={onClose}>
    <p className="reference-image-intro">先看构图、配色和质感。选中喜欢的图片，再带入视频方案。</p>
    <div className="reference-image-layout">
      <form onSubmit={generate}>
        <label htmlFor="reference-image-description">参考图描述</label>
        <textarea id="reference-image-description" value={description} onChange={event => setDescription(event.target.value)} placeholder="主体是什么？场景、构图、配色与光线是什么样？" rows={6} disabled={busy}/>
        <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={busy} aria-label="上传生成图片的参考图" onChange={event => { const added = Array.from(event.target.files ?? []); setReferences(current => [...current, ...added]); event.target.value = ''; }}/>
        <button className="reference-image-attach" type="button" disabled={busy} onClick={() => fileRef.current?.click()}><Plus/>添加已有参考图</button>
        {references.length ? <ul className="reference-image-files">{references.map((file, index) => <li key={`${file.name}-${index}`}><Image/><span>{file.name}</span><button type="button" disabled={busy} aria-label={`移除参考图 ${file.name}`} onClick={() => setReferences(current => current.filter((_, item) => item !== index))}><X/></button></li>)}</ul> : null}
        <label>生成模型</label><ModelSelector models={models} value={selection} onChange={onSelection} disabled={busy}/>
        <button className="primary-button reference-image-generate" type="submit" disabled={busy || !description.trim()}>{busy ? <CircleNotch className="spin"/> : <Sparkle/>}{busy ? '正在生成参考图' : images.length ? '再生成参考图' : '生成参考图'}</button>
        <UploadProgressList items={uploads.items}/>{error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
      <section className="reference-image-results" aria-label="参考图预览" aria-busy={busy}>
        {busy ? <p role="status">正在生成，完成后会保存到素材库。可以关闭面板，稍后回来查看。</p> : null}
        {images.length ? <><div className="reference-image-grid">{images.map((image, index) => <button key={image.id} type="button" aria-pressed={selected.includes(image.id)} aria-label={`选择参考图 ${index + 1}`} disabled={busy || failedImages.includes(image.id)} onClick={() => setSelected(current => current.includes(image.id) ? current.filter(id => id !== image.id) : [...current, image.id])}>{failedImages.includes(image.id) ? <span>图片未加载，请从素材库重试查看</span> : <img src={image.url} alt={`生成的画面参考 ${index + 1}`} onError={() => setFailedImages(current => [...current, image.id])}/>}<span>{selected.includes(image.id) ? '已选择' : '选择这张'}</span></button>)}</div><p>图片已保存到素材库，选入后默认仅供风格参考。</p><button className="primary-button" type="button" disabled={busy || !chosen.length} onClick={() => { onChoose(chosen); onClose(); }}>加入本次创作 · {chosen.length} 张</button></> : !busy ? <div className="reference-image-empty"><Image/><p>先让画面方向看得见</p><span>补充描述或参考图后开始生成</span></div> : null}
      </section>
    </div>
  </ActionDialog>;
}
