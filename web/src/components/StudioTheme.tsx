import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { useSavedState } from "../hooks/useSavedState";
import { initialStudioTheme, studioTheme, type StudioArtworkVariant } from "../studioThemes";

import inkDirector from "../assets/scenery/ink-ai-director.webp";
import inkHanging from "../assets/scenery/ink-ai-hanging.webp";
import inkFilm from "../assets/scenery/ink-ai-film.webp";
import marketingArtwork from "../assets/comic/marketing.webp";

const inkArtwork = {
  home: [inkDirector, 600, 623], projects: [inkDirector, 600, 623],
  assets: [inkFilm, 900, 480], access: [inkDirector, 600, 623],
  account: [inkDirector, 600, 623], workspace: [inkHanging, 400, 500],
  empty: [inkFilm, 900, 480],
} as const;

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
  const ink = variant === "marketing" ? null : inkArtwork[variant];
  const src = ink?.[0] ?? marketingArtwork;
  return <div className={`studio-art studio-art--${variant} ${className}`} data-theme={studioTheme.id} data-artwork={variant} aria-hidden="true">
    <img key={src} src={src} alt="" draggable={false} decoding="async" width={ink?.[1] ?? 2172} height={ink?.[2] ?? 724} onError={event => { event.currentTarget.style.visibility = "hidden"; }}/>
  </div>;
}
