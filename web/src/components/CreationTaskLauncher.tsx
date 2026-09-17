import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, ChartBar, Desktop, FileText, FolderSimple, Image, Link, Scissors, UploadSimple, Waveform, X } from "@phosphor-icons/react";
import { creationTasks, taskPrompt, type CreationTask } from "../creationTasks";
const icons = { text: FileText, web: Link, edit: Scissors, product: Desktop, knowledge: BookOpen, data: ChartBar };

export function CreationTaskLauncher({ onTask, onTool }: { onTask: (task: CreationTask) => void; onTool: (tool: "image" | "voice") => void }) {
  return <section className="creation-launcher" aria-labelledby="creation-launcher-title">
    <header><h2 id="creation-launcher-title">你想完成什么？</h2><p>选一个任务，带上你的内容开始。</p></header>
    <div className="creation-task-grid">{creationTasks.map(task => {
      const Icon = icons[task.id];
      return <button type="button" key={task.id} onClick={() => onTask(task)} aria-label={`开始${task.name}`}><Icon/><span><b>{task.name}</b><small>{task.input}</small></span><ArrowRight/></button>;
    })}</div>
    <div className="creation-tool-links"><span>也可以单独使用</span><button type="button" onClick={() => onTool("image")}><Image/>生成图片<ArrowRight/></button><button type="button" onClick={() => onTool("voice")}><Waveform/>创建音色<ArrowRight/></button></div>
  </section>;
}

export function CreationTaskDialog({ task, hasDraft, fileCount, onFiles, onLibrary, onClose, onApply }: {
  task: CreationTask; hasDraft: boolean; fileCount: number; onFiles: (files: File[]) => void; onLibrary: () => void;
  onClose: () => void; onApply: (prompt: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), upload = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow;
    dialog.current?.showModal(); document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const canApply = task.needsFiles ? fileCount > 0 : Boolean(content.trim());
  return <dialog ref={dialog} className="cap-modal creation-task-dialog" aria-labelledby="task-dialog-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header><h2 id="task-dialog-title">{task.name}</h2><button type="button" className="cap-icon" aria-label="关闭任务引导" onClick={onClose}><X/></button></header>
    <form className="cap-modal-body" onSubmit={event => { event.preventDefault(); if (canApply) onApply(taskPrompt(task, content)); }}>
      <p className="creation-task-outcome">{task.outcome}</p>
      <label className="creation-task-input"><span>{task.label}</span>{task.id === "web" ? <input autoFocus type="url" required pattern="https?://.+" value={content} onChange={event => setContent(event.target.value)} placeholder={task.placeholder}/> : <textarea autoFocus required={!task.needsFiles} value={content} onChange={event => setContent(event.target.value)} placeholder={task.placeholder}/>}</label>
      <div className="creation-task-materials"><button type="button" onClick={() => upload.current?.click()}><UploadSimple/>上传素材</button><button type="button" onClick={onLibrary}><FolderSimple/>从素材库选择</button><input ref={upload} hidden type="file" multiple onChange={event => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}/><span role="status">{fileCount ? `已添加 ${fileCount} 项素材` : task.needsFiles ? "添加素材后即可继续" : "可同时补充素材"}</span></div>
      <p className="creation-task-note">{hasDraft ? "内容会追加到现有草稿，已选表现方式与素材继续保留。" : "先带入创作区，检查内容与设置，再开始制作。"}</p>
      <div className="cap-modal-actions"><button type="submit" className="cap-primary" disabled={!canApply}>{hasDraft ? "追加到创作区" : "带入创作区"}<ArrowRight/></button></div>
    </form>
  </dialog>;
}
