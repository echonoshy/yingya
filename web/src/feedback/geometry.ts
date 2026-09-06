import type { FeedbackRegion } from "../types";
export type Point = { x: number; y: number };
const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v));
export function pointInFrame(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }): Point {
  return { x: clamp((x - bounds.left) / bounds.width), y: clamp((y - bounds.top) / bounds.height) };
}
export function regionFromPoints(a: Point, b: Point): FeedbackRegion {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
export function keyboardRegion(region: FeedbackRegion, key: string, resize: boolean): FeedbackRegion {
  const dx = key === "ArrowRight" ? .01 : key === "ArrowLeft" ? -.01 : 0;
  const dy = key === "ArrowDown" ? .01 : key === "ArrowUp" ? -.01 : 0;
  return resize ? { ...region, width: clamp(region.width + dx, .02, 1 - region.x), height: clamp(region.height + dy, .02, 1 - region.y) }
    : { ...region, x: clamp(region.x + dx, 0, 1 - region.width), y: clamp(region.y + dy, 0, 1 - region.height) };
}
