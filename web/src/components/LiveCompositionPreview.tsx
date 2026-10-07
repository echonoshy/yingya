import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, Pause, Play } from "@phosphor-icons/react";
import { z } from "zod";
import { api } from "../api";

const compositionSchema = z.object({
  engine: z.literal("remotion"),
  composition: z.object({
    fps: z.number().int().positive(), durationInFrames: z.number().int().positive(),
    width: z.number().positive(), height: z.number().positive(),
  }),
});
type Preview = { url: string; fps: number; frames: number; width: number; height: number };
const timestamp = (time: number) => `${Math.floor(time / 60).toString().padStart(2, "0")}:${Math.floor(time % 60).toString().padStart(2, "0")}`;
async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), value => value.toString(16).padStart(2, "0")).join("");
}

// The generated composition runs in an opaque-origin iframe. Only accept messages
// from this specific frame; never give generated code the application's origin.
export function LiveCompositionPreview({ projectId, onCompose }: { projectId: string; onCompose: (text: string) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let polling = false;
    setPreview(null); setError(""); setReady(false); setPlaying(false); setTime(0);
    const timeout = setTimeout(() => {
      controller.abort();
      setError("实时画面连接超时，请重新加载。");
    }, 20000);
    async function connect() {
      try {
        // Check the generated entry before opening a session: an empty project
        // must not show a blank iframe or pretend that a composition is ready.
        const [configText, entry, receiptText] = await Promise.all([
          api.readProjectFile(projectId, "remotion.json"),
          api.readProjectFile(projectId, "index.html"),
          api.readProjectFile(projectId, "remotion-build.json"),
        ]);
        const config = compositionSchema.parse(JSON.parse(configText));
        const receipt = z.object({ engine: z.literal("remotion"), sources: z.record(z.string(), z.string()), files: z.record(z.string(), z.string()) }).parse(JSON.parse(receiptText));
        const [configHash, entryHash] = await Promise.all([digest(configText), digest(entry)]);
        if (receipt.sources["remotion.json"] !== configHash || receipt.files["index.html"] !== entryHash) throw new Error("尚无与当前画面参数匹配的预览，请在对话中更新预览。");
        if (!entry.includes("remotion-preview")) throw new Error("尚无可播放的实时画面，请在对话中生成或更新预览。");
        if (controller.signal.aborted) return;
        const session = await api.openCompositionPreview(projectId, controller.signal);
        const url = new URL(session.previewUrl, window.location.origin);
        if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/preview/")) throw new Error("预览地址不可用，请重新连接。");
        setPreview({ url: `${url.href}${url.search ? "&" : "?"}revision=${encodeURIComponent(session.sourceRevision ?? String(retry))}`, fps: config.composition.fps, frames: config.composition.durationInFrames, width: config.composition.width, height: config.composition.height });
        heartbeat = setInterval(async () => {
          if (polling || controller.signal.aborted) return;
          polling = true;
          try { await api.heartbeatCompositionPreview(projectId, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])); }
          catch { if (!controller.signal.aborted) { setError("实时画面连接已断开，请重新加载。"); setPlaying(false); frameRef.current?.contentWindow?.postMessage({ type: "yingya-preview-playback", playing: false }, "*"); } }
          finally { polling = false; }
        }, 30000);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error && reason.message.startsWith("尚无") ? reason.message : "实时画面尚不可用，请先生成预览，或稍后重新加载。");
      } finally { clearTimeout(timeout); }
    }
    void connect();
    return () => { controller.abort(); clearTimeout(timeout); clearInterval(heartbeat); };
  }, [projectId, retry]);
  useEffect(() => {
    if (!preview) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => !entry.isIntersecting)) {
        setPlaying(false);
        frameRef.current?.contentWindow?.postMessage({ type: "yingya-preview-playback", playing: false }, "*");
      }
    });
    if (frameRef.current) observer.observe(frameRef.current);
    const timer = setTimeout(() => setError("画面加载超时，请重新加载或在对话中修复预览。"), 20000);
    function receive(event: MessageEvent) {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === "yingya-preview-position" && Number.isFinite(event.data.time)) {
        clearTimeout(timer); setReady(true); setTime(Math.max(0, Math.min((preview!.frames - 1) / preview!.fps, event.data.time)));
      } else if (event.data?.type === "yingya-preview-error") {
        clearTimeout(timer); setError("画面播放失败，可以在对话中修复预览。"); setPlaying(false);
      }
    }
    window.addEventListener("message", receive);
    return () => { observer.disconnect(); clearTimeout(timer); window.removeEventListener("message", receive); };
  }, [preview]);
  function control(nextPlaying: boolean, nextTime = time) {
    setPlaying(nextPlaying); setTime(nextTime);
    frameRef.current?.contentWindow?.postMessage({ type: "yingya-preview-playback", playing: nextPlaying, time: nextTime }, "*");
  }
  useEffect(() => {
    const pause = () => { if (document.hidden) { setPlaying(false); frameRef.current?.contentWindow?.postMessage({ type: "yingya-preview-playback", playing: false }, "*"); } };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  const duration = preview ? preview.frames / preview.fps : 0;
  return <section className="live-composition" aria-label="Remotion 实时预览">
    <p className="live-composition-note">当前工程最近构建的画面，可能与成片不同。预览更新后可重新加载。</p>
    {error ? <div className="live-preview-status" role="alert"><p>{error}</p><button onClick={() => { control(false); onCompose("请检查当前 Remotion 工程并生成可播放的实时预览，保留已有内容与设计。"); }}>在对话中处理</button></div> : null}
    {preview && !error ? <div className="live-composition-stage" style={{ aspectRatio: `${preview.width} / ${preview.height}` }}>
      <iframe ref={frameRef} title="Remotion 实时画面" src={preview.url} sandbox="allow-scripts" allow="autoplay" referrerPolicy="no-referrer"/>
      {!ready ? <p role="status">正在加载画面…</p> : null}
    </div> : !error ? <p className="live-preview-status" role="status">正在连接实时画面…</p> : null}
    <div className="live-composition-controls" role="group" aria-label="实时画面播放控制">
      <button aria-label={playing ? "暂停实时画面" : "播放实时画面"} disabled={!ready || Boolean(error)} onClick={() => control(!playing)}>{playing ? <Pause/> : <Play/>}</button>
      <time>{timestamp(time)} / {timestamp(duration)}</time>
      <input type="range" aria-label="实时画面播放位置" min={0} max={preview ? (preview.frames - 1) / preview.fps : 1} step={preview ? 1 / preview.fps : 1} value={time} disabled={!ready || Boolean(error)} onChange={event => control(false, Number(event.target.value))}/>
      <button aria-label="重新加载实时画面" onClick={() => setRetry(value => value + 1)}><ArrowClockwise/></button>
    </div>
  </section>;
}
