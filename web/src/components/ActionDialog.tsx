import { useLayoutEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { animateElement } from "./motion";

export function ActionDialog({ title, children, busy, onClose, className = "" }: { className?: string; title: string; children: ReactNode; busy?: boolean; onClose: () => void }) {
  const root = useRef<HTMLDialogElement>(null);
  const animation = useRef<Animation | undefined>(undefined);
  const closing = useRef(false);
  const closeCallback = useRef(onClose);
  useLayoutEffect(() => { closeCallback.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = root.current;
    closing.current = false;
    if (dialog) { delete dialog.dataset.closing; dialog.inert = false; }
    dialog?.showModal();
    if (dialog) animation.current = animateElement(dialog, [
      { opacity: 0, transform: "translateY(8px) scale(.985)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], "--motion-slow");
    return () => { animation.current?.cancel(); dialog?.close(); previous?.focus(); };
  }, []);
  function requestClose() {
    if (busy || closing.current) return;
    const dialog = root.current;
    if (!dialog) return;
    closing.current = true;
    const { opacity, transform } = getComputedStyle(dialog);
    animation.current?.cancel();
    dialog.dataset.closing = "true";
    dialog.inert = true;
    animation.current = animateElement(dialog, [
      { opacity, transform },
      { opacity: 0, transform: "translateY(4px) scale(.99)" },
    ], "--motion-quick", "--ease-exit");
    if (animation.current) void animation.current.finished.then(() => closeCallback.current()).catch(() => undefined);
    else closeCallback.current();
  }
  return <dialog ref={root} className={`action-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); requestClose(); }}><header><h2>{title}</h2><button type="button" disabled={busy} aria-label="关闭对话框" onClick={requestClose}><X/></button></header>{children}</dialog>;
}
