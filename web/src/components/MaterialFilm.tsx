import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, Pause, Play } from "@phosphor-icons/react";
import type { StudioMaterial } from "../studioMaterials";

type Props = { material: StudioMaterial; interactive?: boolean; enabled?: boolean; className?: string; controlLabel?: string };

/** Media stays static until requested; shared by every illustrative app state. */
export function MaterialFilm({ material, interactive = false, enabled = true, className = "", controlLabel }: Props) {
  if (!interactive) return <div className={`material-film ${className}`} aria-hidden="true"><img src={material.poster} alt="" draggable={false} decoding="async" /></div>;
  return <PlayableMaterial key={material.video} material={material} enabled={enabled} className={className} controlLabel={controlLabel ?? material.label} />;
}

function PlayableMaterial({ material, enabled = true, className, controlLabel }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const request = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const video = ref.current;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { request.current += 1; video?.pause(); };
    const reduce = () => { if (preference.matches) { stop(); setStarted(false); } };
    const hide = () => { if (document.hidden) stop(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") stop(); };
    if (!enabled) { stop(); setStarted(false); }
    preference.addEventListener("change", reduce);
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("keydown", escape);
    const observer = new IntersectionObserver(entries => { if (!entries[0].isIntersecting) stop(); }, { threshold: .05 });
    if (video) observer.observe(video);
    return () => {
      stop(); observer.disconnect();
      preference.removeEventListener("change", reduce);
      document.removeEventListener("visibilitychange", hide);
      document.removeEventListener("keydown", escape);
    };
  }, [enabled]);

  async function toggle() {
    const video = ref.current;
    if (!video) return;
    setNotice("");
    if (!video.paused) { request.current += 1; video.pause(); return; }
    if (!enabled || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setNotice("已按减少动效设置保持静止"); return;
    }
    const current = ++request.current;
    if (!video.getAttribute("src")) video.src = material.video;
    if (video.ended) video.currentTime = 0;
    try {
      await video.play();
      if (current !== request.current) { video.pause(); return; }
      setFinished(false);
    } catch {
      if (current === request.current) { setStarted(false); setNotice("片段暂时无法播放，请稍后再试"); }
    }
  }

  return <div className={`material-film material-film--playable ${className ?? ""}`} data-playing={playing}>
    <img src={material.poster} alt="" draggable={false} decoding="async" className={started ? "film-poster film-poster--hidden" : "film-poster"} />
    <video ref={ref} poster={material.poster} preload="none" muted playsInline aria-hidden="true" tabIndex={-1}
      onPlaying={() => { setPlaying(true); setStarted(true); }} onPause={() => setPlaying(false)}
      onEnded={() => { setPlaying(false); setFinished(true); }}
      onError={() => { setPlaying(false); setStarted(false); setNotice("片段暂时无法播放，已显示静态画面"); }} />
    <button type="button" className="film-control" aria-label={`${playing ? "暂停" : "播放"}${controlLabel}`} onClick={() => void toggle()}>
      {playing ? <Pause weight="fill" /> : finished ? <ArrowCounterClockwise /> : <Play weight="fill" />}<span>{playing ? "暂停" : finished ? "重播" : "播放"}</span>
    </button>
    <span className="sr-only" role="status">{notice}</span>
  </div>;
}
