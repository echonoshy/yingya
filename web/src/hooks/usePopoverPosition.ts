import { useLayoutEffect, useState, type RefObject, type CSSProperties } from 'react';

export function usePopoverPosition(open: boolean, anchor: RefObject<HTMLElement | null>): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const update = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - 24;
      const above = rect.top - 24;
      const down = below >= Math.min(360, above);
      setStyle({ position: 'fixed', left: Math.max(16, Math.min(rect.left, window.innerWidth - 436)), right: 'auto', width: Math.min(420, window.innerWidth - 32), top: down ? Math.max(16, rect.bottom + 8) : 'auto', bottom: down ? 'auto' : Math.max(16, window.innerHeight - rect.top + 8), maxHeight: Math.max(80, down ? below : above) });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const observer = new ResizeObserver(update); observer.observe(anchor.current);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); observer.disconnect(); };
  }, [open, anchor]);
  return style;
}
