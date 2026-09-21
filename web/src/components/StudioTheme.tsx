import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useSavedState } from "../hooks/useSavedState";
import { initialStudioTheme, studioTheme, type StudioArtworkVariant } from "../studioThemes";
import { animateElement } from "./motion";

const artworkUrls = import.meta.glob<string>(["../assets/comic/*.webp", "!../assets/comic/ghost-*.webp", "!../assets/comic/scene-*.webp"], { eager: true, query: "?url", import: "default" });
const motionSchema = z.boolean();
const MotionContext = createContext({ enabled: true, toggle: () => {} });

export function StudioThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState(() => {
    try { return initialStudioTheme(window.sessionStorage); } catch { return initialStudioTheme(); }
  });
  const [enabled, setEnabled] = useSavedState("yingya-studio-motion", motionSchema, true);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.studioTheme = theme.id;
    root.dataset.studioMaterial = theme.material;
  }, [theme]);
  const motionValue = useMemo(() => ({ enabled, toggle: () => setEnabled(current => !current) }), [enabled, setEnabled]);
  return <MotionContext.Provider value={motionValue}>{children}</MotionContext.Provider>;
}

export const useStudioMotion = () => useContext(MotionContext);

/** Real page-specific illustrations, independent of form state and customer media. */
export function StudioArtwork({ variant, className = "" }: { variant: StudioArtworkVariant; className?: string }) {
  const { enabled } = useStudioMotion();
  const root = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | undefined>(undefined);
  const src = artworkUrls[`../assets/comic/${variant}.webp`];
  useEffect(() => {
    animation.current?.cancel();
    if (!enabled || variant !== "home" || document.visibilityState === "hidden") return;
    const element = root.current;
    if (!element || element.closest("[hidden]")) return;
    animation.current = animateElement(element, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }], "--motion-slow");
    return () => animation.current?.cancel();
  }, [variant, enabled]);
  // Interaction motion is a single short response, never an ambient loop.
  const greet = () => {
    const element = root.current;
    if (!element || variant !== "home" || !enabled || element.closest(".home-create")?.querySelector(":focus-within") || document.visibilityState === "hidden") return;
    animation.current?.cancel();
    animation.current = animateElement(element, [{ transform: "translateY(0)" }, { transform: "translateY(-3px)", offset: .4 }, { transform: "translateY(0)" }], "--motion-slow");
  };
  return <div ref={root} className={`studio-art studio-art--${variant} ${className}`} data-theme={studioTheme.id} data-artwork={variant} aria-hidden="true" onPointerEnter={event => { if (event.pointerType === "mouse") greet(); }}>
    <img key={src} src={src} alt="" draggable={false} decoding="async" width={variant === "home" || variant === "marketing" ? 2172 : 1536} height={variant === "home" || variant === "marketing" ? 724 : 1024} onError={event => { event.currentTarget.style.visibility = "hidden"; }}/>
  </div>;
}
