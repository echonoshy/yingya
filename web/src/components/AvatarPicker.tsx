import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Check, CircleNotch, Shuffle, UploadSimple, UserCircle, X } from "@phosphor-icons/react";
import { z } from "zod";
import { sessionFetch } from "../session";
import "../avatars.css";

export const avatarPresets = [
  { id: "cat", name: "奶油猫猫" }, { id: "bunny", name: "软软兔兔" },
  { id: "fox", name: "小狐狸" }, { id: "panda", name: "熊猫团子" },
] as const;
const avatarSchema = z.object({ presetId: z.string().nullable(), url: z.string() });
export type AccountAvatar = z.infer<typeof avatarSchema>;
const presetUrl = (id: string) => `/avatars/${id}-v1.webp`;
const errorMessage = (error: unknown) => error instanceof Error ? (error.name === "TimeoutError" ? "连接超时，请重试；已选图片会保留" : error.message) : "头像保存失败，请重试";

async function avatarRequest(path = "/api/auth/avatar", init?: RequestInit) {
  const timeout = AbortSignal.timeout(30000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await sessionFetch(path, { ...init, signal, cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.message ?? (response.status === 413 ? "头像图片不能超过 5 MB" : "头像暂时无法读取或保存，请重试"));
  return avatarSchema.parse(body);
}

export function useAccountAvatar(userId?: string) {
  const [avatar, setAvatar] = useState<AccountAvatar | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const requestNumber = useRef(0);
  useEffect(() => {
    setAvatar(null); setError("");
  }, [userId]);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController(), request = ++requestNumber.current;
    void avatarRequest(undefined, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted && request === requestNumber.current) { setAvatar(value); setError(""); }
    }).catch(reason => { if (!controller.signal.aborted && request === requestNumber.current) setError(errorMessage(reason)); });
    return () => controller.abort();
  }, [userId, retry]);
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === "yingya-avatar-change" && event.newValue?.startsWith(`${userId}:`)) setRetry(n => n + 1); };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [userId]);
  return { avatar, error, retry: () => setRetry(n => n + 1), saved: (value: AccountAvatar) => {
    requestNumber.current++; setAvatar(value); setError("");
    try { localStorage.setItem("yingya-avatar-change", `${userId}:${crypto.randomUUID()}`); } catch { /* Account persistence does not rely on browser storage. */ }
  } };
}

export function AvatarImage({ url, className = "" }: { url?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <span className={`account-avatar ${className}`} aria-hidden="true">
    {url && !failed ? <img src={url} alt="" draggable={false} onError={() => setFailed(true)} /> : <UserCircle />}
  </span>;
}

export function AvatarPicker({ current, loadError, onRetry, onSaved, onClose, returnFocus }: {
  current: AccountAvatar | null; loadError: string; onRetry: () => void;
  onSaved: (value: AccountAvatar) => void; onClose: () => void; returnFocus: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState(current?.presetId ?? "custom");
  const [file, setFile] = useState<File | null>(null), [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState("");
  const readNumber = useRef(0), initialized = useRef(Boolean(current));
  useEffect(() => { if (current && !initialized.current) { initialized.current = true; setSelection(current.presetId ?? "custom"); } }, [current]);
  useLayoutEffect(() => {
    const element = dialog.current, trigger = returnFocus.current;
    const overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    return () => { readNumber.current++; element?.close(); document.body.style.overflow = overflow; trigger?.focus(); };
  }, [returnFocus]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const changed = selection === "custom" ? Boolean(file) : selection !== current?.presetId;
  const previewUrl = selection === "custom" ? preview || current?.url : presetUrl(selection);
  function choose(id: string) { initialized.current = true; setSelection(id); setError(""); }
  async function upload(selected?: File) {
    if (!selected) return;
    const request = ++readNumber.current;
    setError("");
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type)) { setError("请选择 PNG、JPG 或 WebP 图片"); return; }
    if (selected.size > 5 * 1024 * 1024) { setError("头像图片不能超过 5 MB"); return; }
    const url = URL.createObjectURL(selected);
    setReading(true);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error("请选择不超过 4096×4096 的图片");
      if (request !== readNumber.current) { URL.revokeObjectURL(url); return; }
      initialized.current = true; setFile(selected); setPreview(url); setSelection("custom");
    } catch (reason) {
      URL.revokeObjectURL(url);
      if (request === readNumber.current) setError(reason instanceof Error && reason.message.includes("4096") ? reason.message : "图片无法读取，请换一张图片");
    } finally { if (request === readNumber.current) setReading(false); }
  }
  async function save() {
    if (busy || reading || !changed) return;
    setBusy(true); setError("");
    try {
      const value = selection === "custom" && file
        ? await avatarRequest("/api/auth/avatar/image", { method: "PUT", headers: { "Content-Type": file.type }, body: file })
        : await avatarRequest(undefined, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presetId: selection }) });
      onSaved(value); onClose();
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  return <dialog className="avatar-picker" ref={dialog} aria-labelledby="avatar-picker-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><div><h2 id="avatar-picker-title">更换头像</h2><p>挑一个小伙伴，或用自己的照片。</p></div><button type="button" aria-label="关闭头像选择" disabled={busy} onClick={onClose}><X /></button></header>
    <div className="avatar-picker-body">
      <div className="avatar-preview"><AvatarImage url={previewUrl} /><span>{selection === "custom" ? "自己的头像" : avatarPresets.find(item => item.id === selection)?.name}</span></div>
      {loadError ? <p className="avatar-error" role="alert">{loadError}<button type="button" onClick={onRetry}>重新读取</button></p> : null}
      <div className="avatar-options" role="group" aria-label="可爱头像">
        {avatarPresets.map(item => <button type="button" key={item.id} disabled={busy || reading} aria-pressed={selection === item.id} onClick={() => choose(item.id)}><AvatarImage url={presetUrl(item.id)} /><span>{item.name}</span>{selection === item.id ? <Check className="avatar-check" aria-label="已选择" /> : null}</button>)}
      </div>
      <div className="avatar-actions">
        <button type="button" disabled={busy || reading} onClick={() => { const others = avatarPresets.filter(item => item.id !== selection); choose(others[crypto.getRandomValues(new Uint32Array(1))[0] % others.length].id); }}><Shuffle />随机挑一个</button>
        <button type="button" disabled={busy || reading} onClick={() => input.current?.click()}>{reading ? <CircleNotch className="spin" /> : <UploadSimple />}上传自己的头像</button>
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="头像图片" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      <p className="avatar-hint">支持 PNG、JPG、WebP，最大 5 MB。图片会居中裁切，保存前可查看效果。</p>
      {error ? <p className="avatar-error" role="alert">{error}</p> : null}
    </div>
    <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="primary-button" disabled={busy || reading || !changed} onClick={() => void save()}>{busy ? <><CircleNotch className="spin" />正在保存…</> : "保存头像"}</button></footer>
  </dialog>;
}
