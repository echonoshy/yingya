import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Shuffle } from "@phosphor-icons/react";
import { z } from "zod";
import { useSavedState } from "../hooks/useSavedState";
import { initialStudioTheme, randomStudioTheme, studioThemeSessionKey, studioThemes, type StudioArtworkVariant, type StudioTheme } from "../studioThemes";
import { animateElement } from "./motion";

const artworkUrls = import.meta.glob<string>("../assets/themes/*/*.webp", { eager: true, query: "?url", import: "default" });
const motionSchema = z.boolean();
const ThemeContext = createContext<{ theme: StudioTheme; shuffle: () => void }>({ theme: studioThemes[0], shuffle: () => {} });
const MotionContext = createContext({ enabled: true, toggle: () => {} });

export function StudioThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState(() => {
    try { return initialStudioTheme(window.sessionStorage); } catch { return initialStudioTheme(); }
  });
  const [enabled, setEnabled] = useSavedState("yingya-studio-motion", motionSchema, true);
  const shuffle = useCallback(() => {
    const next = randomStudioTheme(theme.id);
    try { window.sessionStorage.setItem(studioThemeSessionKey, next.id); } catch { /* Keep selection in memory. */ }
    setTheme(next);
  }, [theme.id]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.studioTheme = theme.id;
    root.dataset.studioMaterial = theme.material;
    root.dataset.studioAlign = theme.align;
  }, [theme]);
  const themeValue = useMemo(() => ({ theme, shuffle }), [theme, shuffle]);
  const motionValue = useMemo(() => ({ enabled, toggle: () => setEnabled(current => !current) }), [enabled, setEnabled]);
  return <ThemeContext.Provider value={themeValue}><MotionContext.Provider value={motionValue}>{children}</MotionContext.Provider></ThemeContext.Provider>;
}

export const useStudioTheme = () => useContext(ThemeContext);
export const useStudioMotion = () => useContext(MotionContext);

/** Real page-specific illustrations, independent of form state and customer media. */
export function StudioArtwork({ variant, className = "" }: { variant: StudioArtworkVariant; className?: string }) {
  const { theme } = useStudioTheme();
  const { enabled } = useStudioMotion();
  const root = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | undefined>(undefined);
  const src = artworkUrls[`../assets/themes/${theme.id}/${variant}.webp`];
  useEffect(() => {
    animation.current?.cancel();
    if (!enabled || variant !== "home" || document.visibilityState === "hidden") return;
    const element = root.current;
    if (!element || element.closest("[hidden]")) return;
    animation.current = animateElement(element, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }], "--motion-slow");
    return () => animation.current?.cancel();
  }, [theme.id, variant, enabled]);
  // Interaction motion is a single short response, never an ambient loop.
  const greet = () => {
    const element = root.current;
    if (!element || variant !== "home" || !enabled || element.closest(".home-create")?.querySelector(":focus-within") || document.visibilityState === "hidden") return;
    animation.current?.cancel();
    animation.current = animateElement(element, [{ transform: "translateY(0)" }, { transform: "translateY(-3px)", offset: .4 }, { transform: "translateY(0)" }], "--motion-slow");
  };
  return <div ref={root} className={`studio-art studio-art--${variant} ${className}`} data-theme={theme.id} data-artwork={variant} aria-hidden="true" onPointerEnter={event => { if (event.pointerType === "mouse") greet(); }}>
    <img key={src} src={src} alt="" draggable={false} decoding="async" width="768" height="384" onError={event => { event.currentTarget.style.visibility = "hidden"; }}/>
  </div>;
}

export function StudioThemeControl({ compact = false }: { compact?: boolean }) {
  const { theme, shuffle } = useStudioTheme();
  return <button type="button" className={`studio-theme-control${compact ? " studio-theme-control--compact" : ""}`} onClick={shuffle} aria-label={`换个画风，当前：${theme.name}`} title={`换个画风 · ${theme.name}`}><Shuffle/><span>{compact ? "换个画风" : theme.name}</span></button>;
}
