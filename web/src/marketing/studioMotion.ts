// Composite independently moving cutouts from the original illustration with
// Canvas 2D, including embedded browsers where WebGL is disabled or unavailable.
const WIDTH = 1942;
const HEIGHT = 809;

type Region = {
  path: string;
  bounds: readonly [number, number, number, number];
  pivot: readonly [number, number];
};
const regions: readonly Region[] = [
  {
    // The gripper and held photograph share one rigid layer.
    path: 'M 213 190 L 418 65 L 549 64 L 596 119 L 697 119 L 728 193 L 715 211 Q 719 211 721 219 L 750 366 Q 752 374 745 376 L 580 395 Q 573 397 572 389 L 555 301 L 541 305 L 513 272 L 507 247 L 478 229 L 446 244 L 438 292 L 461 340 L 463 380 Q 454 402 423 401 L 343 400 Q 311 398 297 379 L 252 295 Z',
    bounds: [197, 49, 580, 370], pivot: [385, 390],
  },
  {
    // Lower link. Its base remains pinned while the elbow follows the upper link.
    path: 'M 1555 280 L 1668 309 L 1626 409 L 1643 437 L 1641 477 L 1490 477 L 1462 449 L 1453 424 L 1478 380 Z',
    bounds: [1435, 264, 245, 230], pivot: [1562, 440],
  },
  {
    // Upper link only: the gripper, screen and contact shadows stay in the original.
    path: 'M 1409 152 Q 1420 115 1480 103 Q 1515 91 1540 111 L 1716 224 Q 1744 250 1740 290 Q 1735 334 1692 350 Q 1663 357 1621 337 L 1458 235 Q 1412 229 1409 190 Z',
    bounds: [1393, 80, 367, 290], pivot: [1499, 171],
  },
];

function cutout(image: HTMLImageElement, region: Region, backing: boolean) {
  const layer = document.createElement('canvas');
  const [x, y, width, height] = region.bounds;
  layer.width = width; layer.height = height;
  const context = layer.getContext('2d');
  if (!context) return null;
  context.translate(-x, -y);
  context.filter = 'blur(0.6px)';
  const path = new Path2D(region.path);
  context.fill(path);
  if (backing) {
    // Cover the old silhouette's antialiased edge as the foreground moves away.
    context.lineWidth = 12;
    context.lineJoin = 'round';
    context.stroke(path);
  }
  context.filter = 'none';
  context.globalCompositeOperation = 'source-in';
  context.drawImage(image, 0, 0, WIDTH, HEIGHT);
  return layer;
}

export function createStudioRenderer(canvas: HTMLCanvasElement, image: HTMLImageElement, plate: HTMLImageElement) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return null;
  const parts = regions.map(region => ({
    region,
    front: cutout(image, region, false),
    back: cutout(plate, region, true),
  }));
  const dispose = () => {
    for (const { front, back } of parts) {
      if (front) front.width = front.height = 0;
      if (back) back.width = back.height = 0;
    }
    context.clearRect(0, 0, WIDTH, HEIGHT);
  };
  if (parts.some(part => !part.front || !part.back)) { dispose(); return null; }
  const paint = (index: number, angle: number) => {
    if (!angle) return;
    const { region, front, back } = parts[index];
    const [left, top] = region.bounds;
    const [pivotX, pivotY] = region.pivot;
    context.drawImage(back!, left, top);
    context.save();
    context.translate(pivotX, pivotY);
    context.rotate(angle);
    context.translate(-pivotX, -pivotY);
    context.drawImage(front!, left, top);
    context.restore();
  };
  const paintRight = (angle: number) => {
    if (!angle) return;
    const lower = parts[1], upper = parts[2];
    // Keep the screen and gripper out of both the erase and redraw passes.
    // The shoulder joint is circular, so it can turn against the fixed wrist.
    context.save();
    context.beginPath();
    context.moveTo(1455, 80); context.lineTo(1800, 80);
    context.lineTo(1800, 480); context.lineTo(1445, 480);
    context.lineTo(1445, 236); context.lineTo(1410, 194);
    context.lineTo(1410, 80); context.closePath(); context.clip();
    for (const part of [lower, upper]) context.drawImage(part.back!, part.region.bounds[0], part.region.bounds[1]);
    const [sx, sy] = upper.region.pivot, [bx, by] = lower.region.pivot;
    const ex = 1612, ey = 328;
    const elbowX = sx + Math.cos(angle) * (ex - sx) - Math.sin(angle) * (ey - sy);
    const elbowY = sy + Math.sin(angle) * (ex - sx) + Math.cos(angle) * (ey - sy);
    // Affine articulation pins the complete base axis, avoiding a pasted-over
    // bearing or a seam across the lower link when the elbow rises.
    context.save(); context.translate(bx, by);
    context.transform(1, 0, (elbowX - ex) / (ey - by), (elbowY - by) / (ey - by), 0, 0);
    context.translate(-bx, -by);
    context.drawImage(lower.front!, lower.region.bounds[0], lower.region.bounds[1]); context.restore();
    context.save(); context.translate(sx, sy); context.rotate(angle); context.translate(-sx, -sy);
    context.drawImage(upper.front!, upper.region.bounds[0], upper.region.bounds[1]); context.restore();
    context.restore();

  };
  return {
    draw(left: number, right: number) {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.round(canvas.clientWidth * scale), height = Math.round(canvas.clientHeight * scale);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      context.setTransform(width / WIDTH, 0, 0, height / HEIGHT, 0, 0);
      context.drawImage(image, 0, 0, WIDTH, HEIGHT);
      paint(0, left);
      paintRight(right);
    },
    dispose,
  };
}
