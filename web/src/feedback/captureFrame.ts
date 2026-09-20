import type { FeedbackRegion } from "../types";
export type CapturedFrame = { blob: Blob; width: number; height: number; time: number };

export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("无法保存截图，请重新截取")), "image/png"));
}

export async function captureFrame(video: HTMLVideoElement): Promise<CapturedFrame> {
  video.pause();
  if (video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
    throw new Error("画面尚未就绪，请等待视频加载或定位完成后重试");
  }
  const time = video.currentTime;
  const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器暂不支持画面截取");
  try { context.drawImage(video, 0, 0, canvas.width, canvas.height); }
  catch { throw new Error("画面无法截取，请重试或使用文字时间点反馈"); }
  return { blob: await canvasBlob(canvas), width: canvas.width, height: canvas.height, time };
}

export async function markFrame(frame: CapturedFrame, region: FeedbackRegion, color: string): Promise<Blob> {
  const bitmap = await createImageBitmap(frame.blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = frame.width; canvas.height = frame.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法绘制标注截图");
    ctx.drawImage(bitmap, 0, 0);
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, frame.width / 250);
    const inset = ctx.lineWidth / 2;
    ctx.strokeRect(region.x * frame.width + inset, region.y * frame.height + inset, Math.max(1, region.width * frame.width - ctx.lineWidth), Math.max(1, region.height * frame.height - ctx.lineWidth));
    const blob = await canvasBlob(canvas);
    if (blob.size > 4 * 1024 * 1024) throw new Error("截图超过 4 MiB，请使用文字时间点反馈");
    return blob;
  } finally { bitmap.close(); }
}

// Always capture the card's original version/time, not the visible player's state.
export async function captureFeedbackFrame(url: string, time: number): Promise<CapturedFrame> {
  const video = document.createElement("video");
  video.preload = "auto"; video.muted = true;
  const wait = (event: string, start: () => void) => new Promise<void>((resolve, reject) => {
    const clean = () => { clearTimeout(timer); video.removeEventListener(event, done); video.removeEventListener("error", fail); };
    const done = () => { clean(); resolve(); };
    const fail = () => { clean(); reject(new Error("无法读取这条意见对应的画面，请保留文字反馈或稍后重试")); };
    const timer = window.setTimeout(fail, 12000);
    video.addEventListener(event, done, {once:true}); video.addEventListener("error", fail, {once:true});
    start();
  });
  try {
    await wait("loadeddata", () => { video.src = url; video.load(); });
    if (!Number.isFinite(time) || !Number.isFinite(video.duration) || time < 0 || time > video.duration) throw new Error("反馈时间超出原视频时长");
    if (Math.abs(video.currentTime - time) > .001) await wait("seeked", () => { video.currentTime = time; });
    if (Math.abs(video.currentTime - time) > .001) throw new Error("无法定位到这条意见的时间点，请稍后重试");
    return await captureFrame(video);
  } finally { video.removeAttribute("src"); video.load(); }
}
