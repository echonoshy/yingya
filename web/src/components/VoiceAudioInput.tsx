import { Microphone, Stop, UploadSimple, Waveform, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import "./voiceAudioInput.css";

// Save browser recordings as mono WAV so the voice service receives a portable sample.
async function recordingFile(blob: Blob) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const data = new ArrayBuffer(44 + buffer.length * 2);
    const view = new DataView(data);
    const write = (offset: number, text: string) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    write(0, "RIFF"); view.setUint32(4, data.byteLength - 8, true); write(8, "WAVE"); write(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, "data"); view.setUint32(40, buffer.length * 2, true);
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    for (let i = 0; i < buffer.length; i++) {
      const sample = Math.max(-1, Math.min(1, channels.reduce((sum, channel) => sum + channel[i], 0) / channels.length));
      view.setInt16(44 + i * 2, sample * (sample < 0 ? 32768 : 32767), true);
    }
    return new File([data], "我的录音.wav", { type: "audio/wav" });
  } finally { await context.close(); }
}

export function VoiceAudioInput({ value, onChange, disabled = false, onBusyChange }: {
  value: File | null; onChange: (file: File | null) => void; disabled?: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<"idle" | "requesting" | "recording" | "processing">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const busy = status !== "idle";

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    const next = value ? URL.createObjectURL(value) : "";
    setUrl(next);
    return () => { if (next) URL.revokeObjectURL(next); };
  }, [value]);
  useEffect(() => () => {
    generation.current++;
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);
  useEffect(() => {
    if (status !== "recording") return;
    const start = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.min(30, Math.floor((Date.now() - start) / 1000))), 200);
    const limit = window.setTimeout(() => recorder.current?.state === "recording" && recorder.current.stop(), 30_000);
    return () => { clearInterval(timer); clearTimeout(limit); };
  }, [status]);

  async function startRecording() {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("当前浏览器无法录音，请使用支持录音的浏览器打开安全连接，或上传音频文件。"); return;
    }
    const attempt = ++generation.current;
    setStatus("requesting");
    try {
      const source = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (attempt !== generation.current) { source.getTracks().forEach(track => track.stop()); return; }
      stream.current = source;
      const next = new MediaRecorder(source);
      recorder.current = next;
      const chunks: Blob[] = [];
      let failed = false;
      next.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      next.onerror = () => {
        failed = true;
        source.getTracks().forEach(track => track.stop());
        if (attempt === generation.current) { setError("录音中断，请重新录制或上传文件。"); setStatus("idle"); }
      };
      next.onstop = async () => {
        source.getTracks().forEach(track => track.stop());
        if (attempt !== generation.current || failed) return;
        setStatus("processing");
        try {
          const file = await recordingFile(new Blob(chunks, { type: next.mimeType }));
          if (attempt === generation.current) onChange(file);
        } catch {
          if (attempt === generation.current) setError("未能保存录音，请重新录制或上传文件。");
        } finally { if (attempt === generation.current) setStatus("idle"); }
      };
      next.start(); setSeconds(0); setStatus("recording");
    } catch (reason) {
      stream.current?.getTracks().forEach(track => track.stop());
      if (attempt !== generation.current) return;
      setStatus("idle");
      setError(reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "未获得麦克风权限，请在浏览器中允许访问后重试，或上传音频文件。"
        : "无法使用麦克风，请检查设备后重试，或上传音频文件。");
    }
  }

  return <div className="voice-reference">
    <span className="voice-reference-label">参考音频</span>
    <div className="voice-reference-panel">
      <div className="voice-reference-heading"><span className="voice-reference-icon"><Waveform size={22}/></span><div><b>{value ? "参考音频已就绪" : "用你的声音创建音色"}</b><small>录制或上传一段清晰的单人声音</small></div></div>
      <div className="voice-reference-actions">
        <button type="button" disabled={disabled || (busy && status !== "recording")} onClick={() => status === "recording" ? recorder.current?.stop() : void startRecording()}>
          {status === "recording" ? <Stop weight="fill"/> : <Microphone/>}{status === "recording" ? "停止录音" : value ? "重新录制" : "在线录制"}
        </button>
        <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}><UploadSimple/>{value ? "更换文件" : "上传文件"}</button>
      </div>
      <input ref={input} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac,.webm" hidden aria-label="上传参考音频" disabled={disabled || busy} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        if (!file.size || file.size > 10 * 1024 * 1024) { setError("请选择非空且不超过 10 MB 的音频文件。"); return; }
        if (!file.type.startsWith("audio/") && !/\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(file.name)) { setError("请选择音频文件。"); return; }
        setError(""); onChange(file);
      }}/>
      <p className={`voice-reference-status ${busy ? "is-busy" : ""}`} role="status">{status === "recording" ? <><Microphone/>正在录音 <time>00:{String(seconds).padStart(2, "0")} / 00:30</time></> : status === "requesting" ? "请允许使用麦克风…" : status === "processing" ? "正在保存录音…" : "建议 30 秒，文件不超过 10 MB"}</p>
      {value && !busy ? <div className="voice-reference-preview"><div><span title={value.name}>{value.name}</span><button type="button" aria-label="移除参考音频" title="移除参考音频" disabled={disabled} onClick={() => { onChange(null); setError(""); }}><X/></button></div><audio src={url || undefined} controls aria-label="试听参考音频"/></div> : null}
    </div>
    {error ? <p className="voice-reference-error" role="alert">{error}</p> : null}
  </div>;
}
