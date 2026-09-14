import { Paperclip } from "@phosphor-icons/react";
import { useRef, useState, type ComponentProps, type DragEvent } from "react";

type Props = ComponentProps<"form"> & {
  onFiles: (files: File[]) => void;
  filesDisabled?: boolean;
};

export function ComposerForm({ onFiles, filesDisabled = false, className = "", children, ...props }: Props) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
  function resetDrag() { depth.current = 0; setDragging(false); }

  return <form {...props} className={`${className} composer-file-drop`} onChange={event => { setNotice(""); props.onChange?.(event); }} onSubmit={event => { setNotice(""); props.onSubmit?.(event); }} onDragEnter={event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    depth.current += 1;
    setDragging(true);
  }} onDragOver={event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = filesDisabled ? "none" : "copy";
  }} onDragLeave={event => {
    if (!isFileDrag(event)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(false);
  }} onDrop={event => {
    if (!isFileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); resetDrag();
    if (filesDisabled) { setNotice("请等待当前操作完成后再添加附件"); return; }
    const items = Array.from(event.dataTransfer.items);
    const hasDirectory = items.some(item => item.webkitGetAsEntry?.()?.isDirectory);
    const files = items.length
      ? items.filter(item => item.kind === "file" && !item.webkitGetAsEntry?.()?.isDirectory).map(item => item.getAsFile()).filter((file): file is File => file !== null)
      : Array.from(event.dataTransfer.files);
    if (files.length) onFiles(files);
    setNotice(hasDirectory ? "暂不支持拖入文件夹，请选择其中的文件" : files.length ? `已添加 ${files.length} 个附件，发送时上传` : "未读取到文件，请使用添加附件按钮重试");
  }} onDragEnd={resetDrag}>
    {children}
    {dragging ? <div className="composer-drop-overlay"><Paperclip aria-hidden="true"/><span>{filesDisabled ? "请等待当前操作完成" : "松开以添加附件"}</span></div> : null}
    <div className="composer-drop-notice" role="status" aria-live="polite">{notice}</div>
  </form>;
}
