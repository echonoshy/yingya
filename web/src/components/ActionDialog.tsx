import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { X } from "@phosphor-icons/react";
import { animateElement } from "./motion";

export function ActionDialog({ title, children, busy, onClose, className = "", closeLabel = "关闭对话框", returnFocus, initialFocus, dismissOnBackdrop = false, resizable = false }: { className?: string; title: string; children: ReactNode; busy?: boolean; onClose: () => void; closeLabel?: string; returnFocus?: RefObject<HTMLElement | null>; initialFocus?: RefObject<HTMLElement | null>; dismissOnBackdrop?: boolean; resizable?: boolean }) {
  const root = useRef<HTMLDialogElement>(null);
  const backdropPointer = useRef(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [width, setWidth] = useState(() => {
    try { const saved = Number(localStorage.getItem("yingya.assets.inspector-width.v1")); return saved >= 360 && saved <= 960 ? saved : 500; } catch { return 500; }
  });
  const [maxWidth, setMaxWidth] = useState(() => Math.min(960, window.innerWidth));
  const minWidth = Math.min(360, maxWidth);
  function resize(next: number) { setWidth(Math.max(minWidth, Math.min(maxWidth, next))); }
  useEffect(() => {
    if (!resizable) return;
    const update = () => { const max = Math.min(960, window.innerWidth); setMaxWidth(max); setWidth(current => Math.max(Math.min(360, max), Math.min(current, max))); };
    update(); window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [resizable]);
  useEffect(() => {
    if (resizable && width >= 360) { try { localStorage.setItem("yingya.assets.inspector-width.v1", String(width)); } catch { /* Resizing still works without storage. */ } }
  }, [resizable, width]);
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
    initialFocus?.current?.focus({ preventScroll: true });
    if (dialog) animation.current = animateElement(dialog, [
      { opacity: 0, transform: "translateY(8px) scale(.985)" },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], "--motion-slow");
    return () => { animation.current?.cancel(); dialog?.close(); (returnFocus?.current ?? previous)?.focus({ preventScroll: true }); };
  }, [returnFocus, initialFocus]);
  function requestClose() {
    if (busy || closing.current) return;
    const dialog = root.current;
    if (!dialog) return;
    closing.current = true;
    const { opacity, transform } = getComputedStyle(dialog);
    const backdropOpacity = getComputedStyle(dialog, '::backdrop').opacity;
    animation.current?.cancel();
    dialog.style.setProperty('--dialog-backdrop-opacity', backdropOpacity);
    dialog.dataset.closing = "true";
    dialog.inert = true;
    animation.current = animateElement(dialog, [
      { opacity, transform },
      { opacity: 0, transform: "translateY(4px) scale(.99)" },
    ], "--motion-quick", "--ease-exit");
    // Keep the transparent final frame until React removes the dialog.
    // Otherwise fill:none restores opacity:1 between finish and unmount.
    animation.current?.effect?.updateTiming({ fill: 'forwards' });
    if (animation.current) void animation.current.finished.then(() => closeCallback.current()).catch(() => undefined);
    else closeCallback.current();
  }
  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab" || event.defaultPrevented || (event.target as HTMLElement).closest("dialog") !== event.currentTarget) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input, textarea, select, summary, audio[controls], video[controls], [tabindex]'))
      .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.checkVisibility() && !element.closest('[inert]'));
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  const outside = (x: number, y: number) => {
    const rect = root.current?.getBoundingClientRect();
    return rect ? x < rect.left || x > rect.right || y < rect.top || y > rect.bottom : false;
  };
  return <dialog ref={root} className={`action-dialog ${className}`} style={resizable ? { "--dialog-width": `${width}px` } as CSSProperties : undefined} aria-label={title} onKeyDown={keepFocus} onCancel={event => { event.preventDefault(); event.stopPropagation(); requestClose(); }}
    onPointerDown={event => { backdropPointer.current = dismissOnBackdrop && event.button === 0 && event.target === event.currentTarget && outside(event.clientX, event.clientY); }}
    onPointerUp={event => { const dismiss = backdropPointer.current && event.target === event.currentTarget && outside(event.clientX, event.clientY); backdropPointer.current = false; if (dismiss) requestClose(); }}
    onPointerCancel={() => { backdropPointer.current = false; }}>
    <header><h2>{title}</h2><button type="button" disabled={busy} aria-label={closeLabel} onClick={requestClose}><X/></button></header>
    {resizable ? <div className="dialog-width-handle" role="separator" aria-label="调整详情宽度" aria-orientation="vertical" aria-valuemin={minWidth} aria-valuemax={maxWidth} aria-valuenow={Math.round(width)} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); drag.current = { x: event.clientX, width: root.current?.getBoundingClientRect().width ?? width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX); }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); resize(event.key === "Home" ? minWidth : event.key === "End" ? maxWidth : width + (event.key === "ArrowLeft" ? 20 : -20)); } }}><span/></div> : null}
    {children}</dialog>;
}
