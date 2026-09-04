import { ArrowClockwise, CircleNotch, DownloadSimple, Image as ImageIcon, Images, Paperclip, Sparkle, Waveform, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import type { ImageLibraryAsset, ModelSelection, ProjectRecord } from "../types";
import { ModelSelector } from "./ModelSelector";
import { ProjectSidebar } from "./ProjectSidebar";
import { VoiceStudio } from "./VoiceStudio";

export function AssetStudio({ projects, models, selection, voiceId, onSelection, onVoice, onCreate, onOpen, onDelete }: { projects: ProjectRecord[]; models: Parameters<typeof ModelSelector>[0]["models"]; selection: ModelSelection; voiceId: string; onSelection: (value: ModelSelection) => void; onVoice: (value: string) => void; onCreate: () => void; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void> }) {
  const [tab, setTab] = useState<"images" | "voices">("images");
  const [images, setImages] = useState<ImageLibraryAsset[]>([]);
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { setLoading(true); try { setImages((await api.listImages()).images); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "图片素材库读取失败"); } finally { setLoading(false); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function generate(event: FormEvent) {
    event.preventDefault(); if (!prompt.trim() || busy) return; setBusy(true); setError("");
    try {
      const referenceImages: string[] = [];
      for (const file of references) referenceImages.push((await api.uploadImage(file)).url);
      const { threadId } = await api.startImageThread();
      await api.generateImage(threadId, { prompt: prompt.trim(), referenceImages, ...selection });
      setReferences([]); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "图片生成失败"); }
    finally { setBusy(false); }
  }
  return <div className="start-layout asset-layout">
    <ProjectSidebar projects={projects} activeSection="assets" onCreate={onCreate} onAssets={() => undefined} onOpen={onOpen} onDelete={onDelete}/>
    <main className="asset-main">
      <header className="topbar"><span>ASSET WORKSHOP</span><nav className="asset-tabs" aria-label="素材类型"><button className={tab === "images" ? "active" : ""} onClick={() => setTab("images")}><Images/>图像</button><button className={tab === "voices" ? "active" : ""} onClick={() => setTab("voices")}><Waveform/>音色</button></nav></header>
      <div className="asset-content">
        <div className="asset-heading"><div><span>素材工坊</span><h1>{tab === "images" ? "先把画面准备好" : "让每一段旁白保持同一个声音"}</h1><p>{tab === "images" ? "独立于项目生成视觉素材，之后可以在任意视频里继续使用。" : "试听、生成或克隆固定音色，并指定新建视频的默认旁白。"}</p></div></div>
        {tab === "voices" ? <VoiceStudio value={voiceId} onChange={onVoice}/> : <div className="asset-studio-grid">
          <form className="asset-creator" onSubmit={generate}>
            <header><small>IMAGE GENERATOR</small><h2>描述要生成的画面</h2><p>写清主体、场景、构图、光线和画面比例。参考图只用于这一次生成。</p></header>
            <label><span>画面描述</span><textarea autoFocus value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="例如：一颗半透明的新芽从黑色土壤中生长，电影级侧光，深色背景，16:9 横版构图"/></label>
            {references.length ? <div className="reference-files">{references.map((file, index) => <span key={`${file.name}-${index}`}><ImageIcon/>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={() => setReferences(files => files.filter((_, itemIndex) => itemIndex !== index))}><X/></button></span>)}</div> : null}
            <div className="asset-generator-tools"><button type="button" className="reference-button" onClick={() => fileRef.current?.click()}><Paperclip/>添加参考图</button><input hidden ref={fileRef} type="file" accept="image/*" multiple onChange={event => setReferences(Array.from(event.target.files ?? []))}/><ModelSelector models={models} value={selection} onChange={onSelection}/></div>
            <button className="asset-primary" disabled={!prompt.trim() || busy}>{busy ? <CircleNotch className="spin"/> : <Sparkle weight="fill"/>}{busy ? "正在生成并收进素材库…" : "生成图片"}</button>
            <p className="field-help">生成通常需要几分钟。离开当前页面会中断这次等待，请完成后再切换。</p>
            {error ? <p className="asset-error" role="alert">{error}</p> : null}
          </form>
          <section className="asset-library">
            <header><div><small>IMAGE LIBRARY</small><h2>图片素材库</h2></div><button className="library-refresh" type="button" onClick={() => void load()} disabled={loading} aria-label="刷新图片素材库"><ArrowClockwise className={loading ? "spin" : ""}/></button></header>
            {images.length ? <div className="image-library-grid">{images.map(image => <article key={image.id}><img src={image.url} alt={image.prompt ?? image.sourceName ?? "图片素材"}/><div><small>{image.kind === "generated" ? "AI 生成" : "参考图"}</small><p>{image.prompt ?? image.sourceName ?? "未命名图片素材"}</p><a href={image.url} download aria-label="下载图片"><DownloadSimple/></a></div></article>)}</div> : !loading ? <div className="asset-empty"><Images/><b>素材库还是空的</b><span>从左侧描述第一张画面，它会自动保存在这里。</span></div> : <p className="asset-loading"><CircleNotch className="spin"/>正在读取素材…</p>}
          </section>
        </div>}
      </div>
    </main>
  </div>;
}
