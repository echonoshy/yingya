import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { useSavedState } from "../hooks/useSavedState";
import { initialStudioTheme, studioTheme, type StudioArtworkVariant } from "../studioThemes";
import { stateMaterials, type StudioMaterialName } from "../studioMaterials";
import { MaterialFilm } from "./MaterialFilm";

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
const artworkStates: Record<StudioArtworkVariant, StudioMaterialName> = { home: "start", marketing: "start", projects: "start", assets: "assets", access: "review", account: "ready", workspace: "thinking", empty: "search" };

export function StudioArtwork({ variant, state, motion = false, className = "" }: { variant: StudioArtworkVariant; state?: StudioMaterialName; motion?: boolean; className?: string }) {
  const { enabled } = useStudioMotion();
  const name = state ?? artworkStates[variant];
  return <div className={`studio-art studio-art--${variant}${motion ? " studio-art--motion" : ""} ${className}`} data-theme={studioTheme.id} data-artwork={variant} data-material={name}>
    <MaterialFilm material={stateMaterials[name]} interactive={motion} enabled={enabled} controlLabel={`${stateMaterials[name].label}动画`} />
  </div>;
}
