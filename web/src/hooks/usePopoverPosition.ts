import { useLayoutEffect, useState, type RefObject, type CSSProperties } from 'react';

export function usePopoverPosition(open: boolean, anchor: RefObject<HTMLElement | null>, preferredWidth = 420): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const update = () => {
      const rect = anchor.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const width = Math.min(preferredWidth, viewportWidth - 32);
      const below = viewportTop + viewportHeight - rect.bottom - 24;
      const above = rect.top - viewportTop - 24;
      const down = below >= Math.min(360, above);
      const height = Math.min(viewportHeight - 32, Math.max(80, down ? below : above));
      const top = down ? Math.min(Math.max(viewportTop + 16, rect.bottom + 8), viewportTop + viewportHeight - height - 16) : Math.max(viewportTop + 16, rect.top - height - 8);
      setStyle({ position: 'fixed', left: Math.max(viewportLeft + 16, Math.min(rect.left, viewportLeft + viewportWidth - width - 16)), right: 'auto', width, top: down ? top : 'auto', bottom: down ? 'auto' : Math.max(16, window.innerHeight - Math.max(viewportTop + height + 16, Math.min(rect.top - 8, viewportTop + viewportHeight - 16))), maxHeight: height });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    const observer = new ResizeObserver(update); observer.observe(anchor.current);
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); window.visualViewport?.removeEventListener('resize', update); window.visualViewport?.removeEventListener('scroll', update); observer.disconnect(); };
  }, [open, anchor, preferredWidth]);
  return style;
}
