import { useLayoutEffect, type RefObject } from "react";

// Keep restored drafts, wrapped lines and hidden mobile panels sized like typed text.
export function useAutosizeTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxRows = 4) {
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    let active = true;
    const resize = () => {
      if (!active || !field.clientWidth) return;
      const style = getComputedStyle(field);
      const line = parseFloat(style.lineHeight);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const minimum = Math.max(parseFloat(style.minHeight) || 0, line + padding + border);
      const maximum = Math.max(minimum, line * maxRows + padding + border);
      field.style.height = "0px";
      field.style.overflowY = "hidden";
      const needed = value ? field.scrollHeight + border : minimum;
      field.style.height = `${Math.min(maximum, Math.max(minimum, needed))}px`;
      field.style.overflowY = needed > maximum ? "auto" : "hidden";
    };
    resize();
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      // Ignore our own height changes, but remeasure after wrapping or showing a panel.
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      resize();
    });
    observer.observe(field);
    void document.fonts.ready.then(resize);
    return () => { active = false; observer.disconnect(); };
  }, [ref, value, maxRows]);
}
