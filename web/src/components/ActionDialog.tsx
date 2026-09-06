import { useEffect, useRef, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
export function ActionDialog({ title, children, busy, onClose }: { title: string; children: ReactNode; busy?: boolean; onClose: () => void }) {
  const root = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.showModal();
    return () => previous?.focus();
  }, []);
  return <dialog ref={root} className="action-dialog" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><header><h2>{title}</h2><button type="button" disabled={busy} aria-label="关闭对话框" onClick={onClose}><X/></button></header>{children}</dialog>;
}
