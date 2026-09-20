export function panelBounds(viewport: number) {
  return { min: 280, max: Math.max(280, Math.min(760, viewport - 72 - 360)) };
}
export function clampPanelWidth(width: number, viewport: number) {
  const { min, max } = panelBounds(viewport);
  return Math.max(min, Math.min(max, Number.isFinite(width) ? width : 440));
}
