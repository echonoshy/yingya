import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from "react";

type Rectangle = { left: number; top: number; width: number; height: number };
type Gesture = { pointerId: number; startX: number; startY: number; clientX: number; clientY: number; base: string[]; additive: boolean; active: boolean };

/** Blank-space selection coexists with native card-to-folder dragging. */
export function useAssetMarquee({ enabled, scope, selected, onSelect, scrollRef }: {
  enabled: boolean; scope: string; selected: string[]; onSelect: (ids: string[]) => void;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const clickTimer = useRef(0);
  const suppressClick = useRef(false);
  const latest = useRef({ selected, onSelect });
  latest.current = { selected, onSelect };
  const [rectangle, setRectangle] = useState<Rectangle | null>(null);

  function updateSelection() {
    const current = gesture.current, grid = gridRef.current;
    if (!current?.active || !grid) return;
    const bounds = grid.getBoundingClientRect(), pane = scrollRef.current;
    if (!pane) return;
    const paneBounds = pane.getBoundingClientRect();
    const left = paneBounds.left + pane.clientLeft, right = left + pane.clientWidth;
    const top = Math.max(0, paneBounds.top), bottom = Math.min(window.innerHeight, paneBounds.bottom);
    const x = Math.max(left, Math.min(right, current.clientX));
    const y = Math.max(top, Math.min(bottom, current.clientY));
    const startX = bounds.left + current.startX, startY = bounds.top + current.startY;
    const selection = { left: Math.min(startX, x), top: Math.min(startY, y), right: Math.max(startX, x), bottom: Math.max(startY, y) };
    // Paint in viewport coordinates so dragging below a short list cannot expand its scroll area.
    const rect = { left: Math.max(left, selection.left), top: Math.max(top, selection.top), width: Math.max(0, Math.min(right, selection.right) - Math.max(left, selection.left)), height: Math.max(0, Math.min(bottom, selection.bottom) - Math.max(top, selection.top)) };
    setRectangle(previous => previous && previous.left === rect.left && previous.top === rect.top && previous.width === rect.width && previous.height === rect.height ? previous : rect);
    const ids = new Set(current.additive ? current.base : []);
    for (const card of grid.querySelectorAll<HTMLElement>("[data-asset-id]")) {
      const box = card.getBoundingClientRect();
      if (box.right > selection.left && box.left < selection.right && box.bottom > selection.top && box.top < selection.bottom) ids.add(card.dataset.assetId!);
    }
    const next = [...ids], previous = latest.current.selected;
    if (next.length !== previous.length || next.some((id, index) => id !== previous[index])) latest.current.onSelect(next);
  }

  function tick() {
    const current = gesture.current;
    if (!current?.active) return;
    const pane = scrollRef.current;
    const scroller = pane && pane.scrollHeight > pane.clientHeight + 1 ? pane : document.scrollingElement;
    if (scroller) {
      const bounds = scroller === pane ? pane!.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const top = Math.max(0, bounds.top), bottom = Math.min(window.innerHeight, bounds.bottom);
      const distance = current.clientY < top + 40 ? current.clientY - top - 40 : current.clientY > bottom - 40 ? current.clientY - bottom + 40 : 0;
      if (distance) scroller.scrollTop += Math.max(-20, Math.min(20, distance / 3));
    }
    updateSelection();
    frame.current = requestAnimationFrame(tick);
  }

  function finish(cancelled: boolean) {
    const current = gesture.current;
    if (!current) return;
    if (cancelled) latest.current.onSelect(current.base);
    else if (current.active) updateSelection();
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    if (scrollRef.current?.hasPointerCapture(current.pointerId)) scrollRef.current.releasePointerCapture(current.pointerId);
    setRectangle(null);
    if (current.active) {
      suppressClick.current = true;
      clearTimeout(clickTimer.current);
      clickTimer.current = window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
  }

  useEffect(() => {
    if (!enabled) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); finish(true); } };
    const cancel = () => finish(true);
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      cancel();
      clearTimeout(clickTimer.current);
      suppressClick.current = false;
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, [enabled, scope]);

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (!enabled || event.button !== 0 || event.pointerType === "touch" || !event.isPrimary) return;
    if (event.target instanceof Element && event.target.closest(".asset-card-item, .asset-list-heading, button, a, input, select, textarea, [role=dialog], [role=combobox]")) return;
    const bounds = gridRef.current?.getBoundingClientRect();
    const paneBounds = event.currentTarget.getBoundingClientRect();
    if (!bounds || event.clientY < bounds.top || event.clientX >= paneBounds.left + event.currentTarget.clientWidth) return;
    event.preventDefault();
    gesture.current = { pointerId: event.pointerId, startX: event.clientX - bounds.left, startY: event.clientY - bounds.top, clientX: event.clientX, clientY: event.clientY, base: [...latest.current.selected], additive: event.shiftKey || event.ctrlKey || event.metaKey, active: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: PointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY);
    if (!current.active && distance < 4) return;
    current.clientX = event.clientX; current.clientY = event.clientY;
    if (!current.active) { current.active = true; frame.current = requestAnimationFrame(tick); }
  }
  return {
    gridRef, rectangle, enabled,
    handlers: {
      onPointerDown, onPointerMove,
      onPointerUp: (event: PointerEvent<HTMLElement>) => { if (gesture.current?.pointerId === event.pointerId) { gesture.current.clientX = event.clientX; gesture.current.clientY = event.clientY; finish(false); } },
      onPointerCancel: () => finish(true),
      onLostPointerCapture: () => finish(true),
      onClickCapture: (event: MouseEvent) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } },
    },
  };
}
