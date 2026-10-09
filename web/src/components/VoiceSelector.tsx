import { ActionDialog } from "./ActionDialog";
import { CaretDown, Check, CircleNotch, Play, SpeakerHigh, Waveform } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { UploadedVoice } from "../types";

export function VoiceSelector({ value, onChange, disabled = false, hideTrigger = false, open: controlledOpen, onOpenChange }: { value: string; onChange: (voiceId: string) => void | Promise<void>; disabled?: boolean; hideTrigger?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [voices, setVoices] = useState<string[]>(["default"]);
  const [uploaded, setUploaded] = useState<UploadedVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [previewing, setPreviewing] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await api.listVoices();
      setVoices(result.voices.length ? result.voices : ["default"]);
      setUploaded(result.uploaded_voices);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "音色库读取失败");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const metadata = useMemo(() => new Map(uploaded.map(item => [item.name.toLocaleLowerCase(), item])), [uploaded]);
  const currentName = value === "default" ? "默认音色" : uploaded.find(item => item.name.toLocaleLowerCase() === value.toLocaleLowerCase())?.display_name ?? uploaded.find(item => item.name.toLocaleLowerCase() === value.toLocaleLowerCase())?.name ?? "项目已保存音色";

  async function choose(voiceId: string) {
    setWorking(voiceId); setError("");
    try { await onChange(voiceId); setOpen(false); root.current?.querySelector<HTMLButtonElement>(".voice-trigger")?.focus(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "音色设置失败"); }
    finally { setWorking(""); }
  }

  async function preview(voiceId: string) {
    setPreviewing(voiceId); setError("");
    try {
      const blob = await api.previewVoice(voiceId);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "试听生成失败"); }
    finally { setPreviewing(""); }
  }

  return <div className="voice-selector" ref={root} onKeyDown={event => { if (event.key === "Escape" && open && !working) { event.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLButtonElement>(".voice-trigger")?.focus(); } }}>
    {hideTrigger ? null : <button type="button" className="voice-trigger" disabled={disabled} onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open} title={disabled ? "当前任务完成后可更换音色" : `旁白音色：${currentName}`}>
      <Waveform/><span>{currentName}</span><CaretDown className="control-chevron" aria-hidden="true"/>
    </button>}
    {open ? <ActionDialog title="旁白音色" busy={Boolean(working)} onClose={() => setOpen(false)}><section className="voice-menu">

      <>
        <div className="voice-list" aria-busy={loading}>
          {voices.map((voice, index) => {
            const detail = metadata.get(voice.toLocaleLowerCase());
            const label = voice === "default" ? "默认音色" : detail?.display_name ?? detail?.name ?? voice;
            return <div className={`voice-row ${value.toLocaleLowerCase() === voice.toLocaleLowerCase() ? "active" : ""}`} key={voice}>
              <button type="button" className="voice-choice" disabled={Boolean(working)} onClick={() => void choose(voice)}>
                <span aria-hidden="true">{loading && index === 0 ? <CircleNotch className="spin"/> : <SpeakerHigh/>}</span><div><b>{label}</b>{voice !== "default" ? <small>{detail?.speaker_description || "已保存的项目音色"}</small> : null}</div>{value.toLocaleLowerCase() === voice.toLocaleLowerCase() ? <Check/> : null}
              </button>
              <button type="button" className="voice-preview" aria-label={`试听 ${label}`} disabled={Boolean(previewing)} onClick={() => void preview(voice)}>{previewing === voice ? <CircleNotch className="spin"/> : <Play weight="fill"/>}</button>
            </div>;
          })}
        </div>
        {/* Keep loading feedback out of the centered dialog's height calculation. */}
        <span className="sr-only" role="status">{loading ? "正在读取音色…" : ""}</span>
        {audioUrl ? <audio className="voice-audio" src={audioUrl} controls autoPlay/> : null}
        <div className="voice-create-actions"><a href="#/assets/generate/voice">管理与创建音色</a></div>
        {!loading && value !== "default" && !voices.includes(value) ? <p>此项目保留原音色，也可从列表选择其他声音。</p> : null}
      </>
      {error ? <p className="voice-error" role="alert">{error}</p> : null}
    </section></ActionDialog> : null}
  </div>;
}
