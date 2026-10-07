import { useLayoutEffect, useState, type ReactNode } from "react";
import { initialStudioTheme } from "../studioThemes";

export function StudioThemeProvider({ children }: { children: ReactNode }) {
  const [theme] = useState(() => {
    try { return initialStudioTheme(window.sessionStorage); } catch { return initialStudioTheme(); }
  });
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.studioTheme = theme.id;
    root.dataset.studioMaterial = theme.material;
  }, [theme]);
  return <>{children}</>;
}
