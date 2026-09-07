import { useLayoutEffect, useRef } from "react";
import { animateElement } from "./motion";

/** One continuous selection marker; interruption starts from the visible frame. */
export function SelectionIndicator({ value, line = false }: { value: string; line?: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const animation = useRef<Animation | undefined>(undefined);
  const destination = useRef("");
  useLayoutEffect(() => {
    const marker = root.current;
    const parent = marker?.parentElement;
    const target = parent?.querySelector<HTMLElement>("button.active");
    if (!marker || !parent || !target) return;
    const measure = (move: boolean) => {
      const box = target.getBoundingClientRect();
      if (!box.width) return;
      const container = parent.getBoundingClientRect();
      const inset = line ? 12 : 0;
      const x = box.left - container.left - parent.clientLeft + parent.scrollLeft + inset;
      const y = box.top - container.top - parent.clientTop + parent.scrollTop + (line ? box.height - 2 : 0);
      const width = Math.max(1, box.width - inset * 2);
      const height = line ? 2 : box.height;
      const next = `${x}:${y}:${width}:${height}`;
      if (destination.current === next) return;
      const previous = marker.getBoundingClientRect();
      const visible = Boolean(destination.current);
      animation.current?.cancel();
      Object.assign(marker.style, { width: `${width}px`, height: `${height}px`, transform: `translate(${x}px, ${y}px)`, opacity: "1" });
      if (move && visible) {
        const fromX = previous.left - container.left - parent.clientLeft + parent.scrollLeft;
        const fromY = previous.top - container.top - parent.clientTop + parent.scrollTop;
        animation.current = animateElement(marker, [
          { transform: `translate(${fromX}px, ${fromY}px) scaleX(${previous.width / width})` },
          { transform: `translate(${x}px, ${y}px) scaleX(1)` },
        ]);
      }
      destination.current = next;
    };
    measure(true);
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(parent);
    parent.querySelectorAll("button").forEach(button => observer.observe(button));
    return () => observer.disconnect();
  }, [value, line]);
  useLayoutEffect(() => () => animation.current?.cancel(), []);
  return <span ref={root} aria-hidden="true" className={`selection-indicator${line ? " selection-indicator--line" : ""}`}/>;
}
