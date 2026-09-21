import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { useSavedState } from "../hooks/useSavedState";
import { initialStudioTheme, type StudioArtworkVariant } from "../studioThemes";
import { animateElement } from "./motion";

import homeArtwork from "../assets/kami/hero-paper-v2.webp";
import pencilArtwork from "../assets/themes/pencil/projects.webp";
const artworkUrls = import.meta.glob<string>("../assets/themes/paper/*.webp", { eager: true, query: "?url", import: "default" });
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
  const src = variant === "home" ? homeArtwork : artworkUrls[`../assets/themes/paper/${variant}.webp`];
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
  return <div ref={root} className={`studio-art studio-art--${variant} ${className}`} data-theme="paper" data-artwork={variant} aria-hidden="true" onPointerEnter={event => { if (event.pointerType === "mouse") greet(); }}>
    <img key={src} src={src} alt="" draggable={false} decoding="async" width={variant === "home" ? 2170 : 768} height={variant === "home" ? 725 : 384} onError={event => { event.currentTarget.style.visibility = "hidden"; }}/>
  </div>;
}

/** Reuse a paper illustration as a small print, never as customer media. */
export function PaperAccent() {
  return <div className="paper-accent" aria-hidden="true"><img src={pencilArtwork} width="536" height="268" alt="" draggable={false} loading="lazy" decoding="async" /></div>;
}
