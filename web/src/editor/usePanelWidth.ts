import { useEffect, useState } from "react";
import { readNumberSetting, writeNumberSetting } from "../storage";
import { clampPanelWidth, panelBounds } from "./panelLayout";
export function usePanelWidth(kind: "chat" | "tools") {
  const [viewport, setViewport] = useState(window.innerWidth);
  const defaultWidth = kind === "chat" ? Math.min(620, viewport * 0.3) : 340;
  const [widths, setWidths] = useState(() => ({
    chat: readNumberSetting(
      "yingya-editor-chat-width",
      Math.min(620, window.innerWidth * 0.3),
    ),
    tools: readNumberSetting("yingya-editor-tools-width", 340),
  }));
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const width = clampPanelWidth(widths[kind], viewport);
  function change(value: number, persist = true) {
    const next = clampPanelWidth(value, viewport);
    setWidths((current) => ({ ...current, [kind]: next }));
    if (persist) writeNumberSetting(`yingya-editor-${kind}-width`, next);
  }
  return {
    width,
    ...panelBounds(viewport),
    change,
    reset: () => change(defaultWidth),
  };
}
