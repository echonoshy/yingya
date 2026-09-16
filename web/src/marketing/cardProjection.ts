// Rotate a rigid card around its bottom edge, then project it onto the canvas.
// Original illustration coordinates are preserved exactly at rest.
export function projectCardPoint(x: number, y: number, pivot: readonly [number, number], angle: number) {
  const length = Math.hypot(1, -.2), ax = 1 / length, ay = -.2 / length;
  const dx = x - pivot[0], dy = y - pivot[1];
  const along = dx * ax + dy * ay, across = -dx * ay + dy * ax;
  const depth = across * Math.sin(angle);
  const perspective = 650 / (650 + depth);
  return [pivot[0] + (along * ax - across * Math.cos(angle) * ay) * perspective,
    pivot[1] + (along * ay + across * Math.cos(angle) * ax) * perspective] as const;
}
