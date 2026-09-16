const WIDTH = 1942;
const HEIGHT = 809;

export type Region = {
  path: string;
  bounds: readonly [number, number, number, number];
  pivot: readonly [number, number];
};
export function cutout(image: HTMLImageElement, region: Region, backing: boolean) {
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
