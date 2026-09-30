import { projectCardPoint } from './cardProjection';
import { cutout, type Region } from './studioLayers';

// Coordinates are in the original 1942 × 809 illustration. Front walls are
// stationary occluders; only the exposed contents are animated behind them.
const box: Region = { path: 'M 118 487 L 234 466 L 239 483 L 322 470 L 333 514 L 367 507 L 388 568 L 203 602 L 138 571 Z', bounds: [100, 450, 310, 165], pivot: [250, 599] };
const cards: Region[] = [
  { path: 'M 122 490 L 232 469 L 252 533 L 142 565 Z', bounds: [118, 464, 142, 115], pivot: [196, 555] },
  { path: 'M 239 485 L 320 473 L 334 521 L 255 544 Z', bounds: [235, 468, 104, 82], pivot: [285, 541] },
  { path: 'M 125 546 L 250 522 L 273 591 L 204 601 L 139 572 Z', bounds: [120, 517, 160, 92], pivot: [210, 599] },
  { path: 'M 271 528 L 364 509 L 385 568 L 285 588 Z', bounds: [266, 504, 126, 93], pivot: [330, 581] },
];
const pair: Region = { path: 'M 301 681 L 493 638 L 535 661 L 690 664 L 665 733 L 467 722 L 352 734 Z', bounds: [288, 626, 420, 123], pivot: [0, 0] };
const ocean: Region = { path: 'M 305 683 L 492 640 L 563 691 L 356 731 Z', bounds: [300, 635, 270, 103], pivot: [355, 721] };
const flower: Region = { path: 'M 526 662 L 690 667 L 662 731 L 465 721 Z', bounds: [458, 655, 240, 84], pivot: [660, 719] };
const visibleFlower = new Path2D('M 529 667 L 689 668 L 661 730 L 466 721 L 467 714 L 566 692 Z');
const sunflower: Region = { path: 'M 1567 699 L 1651 649 L 1804 674 L 1747 742 Z', bounds: [1556, 637, 262, 120], pivot: [1740, 733] };
const stationery: Region = { path: 'M 1779 484 L 1795 410 L 1844 414 L 1842 441 L 1849 421 L 1870 426 L 1853 490 Z', bounds: [1770, 400, 110, 100], pivot: [1815, 485] };
const tools: Region[] = [
  { path: 'M 1795 412 L 1843 416 L 1828 488 L 1781 483 Z', bounds: [1775, 405, 76, 91], pivot: [1810, 486] },
  { path: 'M 1848 422 Q 1859 420 1868 427 L 1852 489 L 1832 485 Z', bounds: [1828, 415, 47, 83], pivot: [1841, 487] },
];
const boxOpening = new Path2D('M 70 420 L 445 420 L 465 551 L 204 599 L 73 535 Z');
const cupOpening = new Path2D('M 1710 395 L 1890 395 L 1890 473 Q 1835 500 1734 476 Z');

export function createStudioProps(image: HTMLImageElement, clean: HTMLImageElement, props: HTMLImageElement) {
  const boxBack = cutout(props, box, true), pairBack = cutout(clean, pair, true);
  const sunBack = cutout(clean, { ...sunflower, path: 'M 1558 684 L 1644 639 L 1815 664 L 1765 755 L 1555 728 Z' }, true), toolsBack = cutout(props, stationery, true);
  const cardFronts = cards.map(region => cutout(image, region, false));
  const toolFronts = tools.map(region => cutout(image, region, false));
  const seaFront = cutout(image, ocean, false), flowerFront = cutout(props, flower, false), sunFront = cutout(image, sunflower, false);
  const layers = [boxBack, pairBack, sunBack, toolsBack, ...cardFronts, ...toolFronts, seaFront, flowerFront, sunFront];
  const dispose = () => { for (const layer of layers) if (layer) layer.width = layer.height = 0; };
  if (layers.some(layer => !layer)) { dispose(); return null; }
  // Preserve the original visible flower pixels. Only its previously hidden
  // portion comes from the generated plate.
  const flowerContext = flowerFront!.getContext('2d')!;
  flowerContext.setTransform(1, 0, 0, 1, 0, 0);
  flowerContext.save(); flowerContext.translate(-flower.bounds[0], -flower.bounds[1]);
  flowerContext.clip(visibleFlower); flowerContext.globalCompositeOperation = 'source-atop';
  flowerContext.drawImage(image, 0, 0, 1942, 809); flowerContext.restore();
  const stamp = (ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, region: Region, x = 0, y = 0, angle = 0, scaleY = 1, shadow = 0) => {
    ctx.save(); ctx.translate(region.pivot[0] + x, region.pivot[1] + y); ctx.rotate(angle); ctx.scale(1, scaleY);
    ctx.translate(-region.pivot[0], -region.pivot[1]);
    if (shadow) { ctx.shadowColor = 'rgba(36,38,43,.18)'; ctx.shadowBlur = shadow * 5; ctx.shadowOffsetY = shadow * 4; }
    ctx.drawImage(layer, region.bounds[0], region.bounds[1]); ctx.restore();
  };
  const flipCard = (ctx: CanvasRenderingContext2D, layer: HTMLCanvasElement, region: Region, pulse: number) => {
    if (!pulse) { stamp(ctx, layer, region); return; }
    const [x, y, width, height] = region.bounds;
    // A small textured mesh preserves perspective across the entire rigid card.
    const cells = 6;
    const triangle = (points: readonly (readonly [number, number])[]) => {
      const [a, b, c] = points;
      const [pa, pb, pc] = points.map(([u, v]) => projectCardPoint(x + u, y + v, region.pivot, -pulse * .65));
      const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
      const m11 = ((pb[0] - pa[0]) * (c[1] - a[1]) - (pc[0] - pa[0]) * (b[1] - a[1])) / det;
      const m12 = ((pb[1] - pa[1]) * (c[1] - a[1]) - (pc[1] - pa[1]) * (b[1] - a[1])) / det;
      const m21 = ((pc[0] - pa[0]) * (b[0] - a[0]) - (pb[0] - pa[0]) * (c[0] - a[0])) / det;
      const m22 = ((pc[1] - pa[1]) * (b[0] - a[0]) - (pb[1] - pa[1]) * (c[0] - a[0])) / det;
      ctx.save(); ctx.beginPath();
      // Subpixel overlap avoids antialiased seams between adjacent triangles.
      const cx = (pa[0] + pb[0] + pc[0]) / 3, cy = (pa[1] + pb[1] + pc[1]) / 3;
      [pa, pb, pc].forEach(([px, py], i) => {
        const distance = Math.hypot(px - cx, py - cy);
        const xx = px + (px - cx) / distance * .35, yy = py + (py - cy) / distance * .35;
        if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
      });
      ctx.closePath(); ctx.clip();
      ctx.transform(m11, m12, m21, m22, pa[0] - m11 * a[0] - m21 * a[1], pa[1] - m12 * a[0] - m22 * a[1]);
      ctx.drawImage(layer, 0, 0); ctx.restore();
    };
    for (let row = 0; row < cells; row++) for (let col = 0; col < cells; col++) {
      const a = [col * width / cells, row * height / cells] as const;
      const b = [(col + 1) * width / cells, row * height / cells] as const;
      const c = [(col + 1) * width / cells, (row + 1) * height / cells] as const;
      const d = [col * width / cells, (row + 1) * height / cells] as const;
      triangle([a, b, c]); triangle([a, c, d]);
    }
  };
  return {
    draw(ctx: CanvasRenderingContext2D, values: readonly number[]) {
      const [boxPulse = 0, sea = 0, bloom = 0, sun = 0, penPulse = 0] = values;
      if (boxPulse || values.slice(5, 9).some(Boolean)) {
        ctx.save(); ctx.clip(boxOpening); ctx.drawImage(boxBack!, box.bounds[0], box.bounds[1]);
        // Cards turn around their bottom edges behind the fixed box rim.
        cards.forEach((card, i) => flipCard(ctx, cardFronts[i]!, card, values[5 + i] ?? Math.pow(boxPulse, 1 + i * .4)));
        ctx.restore();
      }
      if (sea || bloom) {
        ctx.drawImage(pairBack!, pair.bounds[0], pair.bounds[1]);
        stamp(ctx, flowerFront!, flower, bloom * 12, -bloom * 2, bloom * .015, 1, bloom);
        stamp(ctx, seaFront!, ocean, 0, -sea * 6, -sea * .035, 1, sea);
      }
      if (sun) {
        ctx.drawImage(sunBack!, sunflower.bounds[0], sunflower.bounds[1]);
        stamp(ctx, sunFront!, sunflower, 0, -sun * 7, sun * .04, 1, sun);
      }
      if (penPulse || values.slice(9, 11).some(Boolean)) {
        ctx.save(); ctx.clip(cupOpening); ctx.drawImage(toolsBack!, stationery.bounds[0], stationery.bounds[1]);
        tools.forEach((tool, i) => stamp(ctx, toolFronts[i]!, tool, 0, 0, (values[9 + i] ?? Math.pow(penPulse, 1 + i * .6)) * (i ? .075 : -.055)));
        ctx.restore();
      }
    },
    dispose,
  };
}
