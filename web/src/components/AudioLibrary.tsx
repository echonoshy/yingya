import { MagnifyingGlass, MusicNotes } from "@phosphor-icons/react";
import { useRef, useState, type FormEvent } from "react";
import { api } from "../api";

export function AudioLibrary({ projectId, onRefresh, onCompose }: { projectId: string; onRefresh: () => Promise<void>; onCompose: (text: string) => void }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"music" | "sound_effects">("music");
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.searchAudio>>["data"]>([]);
  const [searchInput, setSearchInput] = useState({ query: "", type });
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [more, setMore] = useState(false);
  const requestId = useRef(0);
  async function search(event: FormEvent) {
    event.preventDefault(); if (!query.trim()) return;
    const id = ++requestId.current; const input = { query: query.trim(), type };
    setBusy(true); setError(""); setResults([]); setSearched(false);
    try { const result = await api.searchAudio(input.query, input.type); if (id !== requestId.current) return; setResults(result.data); setSearchInput(input); setSearched(true); setMore(result.hasMore); }
    catch (reason) { if (id === requestId.current) setError(reason instanceof Error ? reason.message : "音频搜索失败"); }
    finally { if (id === requestId.current) setBusy(false); }
  }
  async function add(id: string) {
    setAdding(id); setError("");
    try { const asset = await api.importAudio(projectId, { id, ...searchInput }); await onRefresh(); onCompose(`请使用已加入项目的${searchInput.type === "music" ? "配乐" : "音效"}「${asset.name}」（${asset.hyperframesPath}）。使用位置与要求：`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "音频导入失败"); }
    finally { setAdding(""); }
  }
  return <details className="audio-library"><summary><MusicNotes/>查找配乐与音效</summary><form onSubmit={search}><label>音频类型<select value={type} onChange={event => setType(event.target.value as typeof type)}><option value="music">配乐</option><option value="sound_effects">音效</option></select></label><label>搜索描述<input value={query} maxLength={300} onChange={event => setQuery(event.target.value)} placeholder="例如：轻快的钢琴背景音乐"/></label><button disabled={!query.trim() || busy}><MagnifyingGlass/>{busy ? "正在搜索…" : "搜索音频"}</button></form>{error ? <p className="form-error" role="alert">{error}</p> : null}<div className="audio-results">{results.map(item => <article key={item.id}><b>{item.name}</b><p>{item.description}</p><small>{Math.round(item.duration)} 秒</small><audio src={item.audioUrl} controls preload="none" aria-label={`试听 ${item.name}`}/><button disabled={Boolean(adding)} onClick={() => void add(item.id)}>{adding === item.id ? "正在导入…" : "加入项目并描述用途"}</button></article>)}</div>{searched && !results.length ? <p role="status">没有匹配的音频，请调整描述后重试。</p> : null}{more ? <p>还有更多结果，可缩小搜索范围找到更合适的音频。</p> : null}</details>;
}
