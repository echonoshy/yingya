import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { animateElement } from "../components/motion";

/** Keep an inert visual shell mounted until its exit transition has finished. */
export function useMotionPresence<T>(value: T | null) {
  const [retained, setRetained] = useState(value);
  const elementRef = useRef<HTMLElement | null>(null);
  const interrupted = useRef<{ element: HTMLElement; target: HTMLElement; opacity: string; transform: string } | null>(null);
  const ref = useCallback((element: HTMLElement | null) => { elementRef.current = element; }, []);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let cancelled = false;
    const entering = value !== null;
    if (entering) setRetained(value);
    const panel = element.querySelector<HTMLElement>("[data-motion-panel]");
    const target = panel ?? element;
    const previous = interrupted.current;
    const continuing = previous?.element === element && previous.target === target ? previous : null;
    const opacity = [{ opacity: continuing?.opacity ?? (entering ? 0 : 1) }, { opacity: entering ? 1 : 0 }];
    const movement = panel ? ["translateX(8px)", "translateX(0)"] : ["translateY(4px)", "translateY(0)"];
    const positions = entering ? movement : [...movement].reverse();
    if (continuing) positions[0] = continuing.transform;
    const duration = entering ? panel ? "--motion-slow" : "--motion-standard" : "--motion-quick";
    const easing = entering ? "--ease-sprout" : "--ease-exit";
    const animation = animateElement(element, opacity, duration, easing);
    const slide = animateElement(target, positions.map(transform => ({ transform })), duration, easing);
    if (!entering) {
      if (animation) void animation.finished.then(() => { if (!cancelled) setRetained(null); }).catch(() => undefined);
      else setRetained(null);
    }
    return () => {
      cancelled = true;
      // Reverse from the displayed frame instead of flashing back to an endpoint.
      interrupted.current = { element, target, opacity: getComputedStyle(element).opacity, transform: getComputedStyle(target).transform };
      animation?.cancel(); slide?.cancel();
    };
  }, [value]);
  return { value: value ?? retained, ref, exiting: value === null };
}
