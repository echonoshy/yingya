import { ArrowRight, CircleNotch, File, FloppyDisk, SquaresFour } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { AgentMedia, MediaScene, ProjectDetail } from "../types";

export function extractScenes(html: string): MediaScene[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll('section[data-start][data-duration], .scene[data-start][data-duration]')].filter((element, index, all) => !all.some((parent, parentIndex) => index !== parentIndex && parent.contains(element))).map((element, index) => ({
    id: element.id || `scene-${index + 1}`, order: index + 1, assetIds: [],
    narrativeRole: element.querySelector('[class~="chapter"], h1, h2, h3')?.textContent?.trim().replace(/^\d+\s*[·.、-]\s*/, "") || `场景 ${index + 1}`,
    narration: element.querySelector('[class~="caption"], [data-narration]')?.textContent?.trim() || "",
    startSeconds: Number(element.getAttribute("data-start")), durationSeconds: Number(element.getAttribute("data-duration")),
  })).filter(scene => Number.isFinite(scene.startSeconds) && Number.isFinite(scene.durationSeconds) && scene.durationSeconds > 0);
}

export function StoryboardPanel({ project, media, onContext, onCompose, onRefresh }: { project: ProjectDetail; media: AgentMedia; onContext: (text: string) => void; onCompose: (text: string) => void; onRefresh: () => Promise<void> }) {
  const [derived, setDerived] = useState<MediaScene[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState("");
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const version = project.manifest.versions.find(item => item.id === project.manifest.currentDraft) ?? project.manifest.versions.at(-1);
  const sourcePath = version ? (/\.html?$/i.test(version.sourcePath) ? version.sourcePath : `${version.sourcePath.replace(/\/$/, "")}/index.html`) : project.manifest.studioEntry;
  useEffect(() => {
    if (media.scenes.length || !version) return;
    let cancelled = false;
    setLoading(true); setError(""); setDerived([]);
    void api.readProjectFile(project.id, sourcePath).then(html => { if (!cancelled) setDerived(extractScenes(html)); }).catch(() => { if (!cancelled) setError("暂时无法读取合成分镜，可重新进入此页重试。"); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, sourcePath, version?.id, media.scenes.length]);
  const scenes = [...(media.scenes.length ? media.scenes : derived)].sort((a, b) => a.order - b.order);
  async function saveStructure() {
    setBusy(true); setError("");
    try { await api.importScenes(project.id, derived); await onRefresh(); setMessage("已保存分镜结构，可以关联项目素材。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "分镜保存失败"); }
    finally { setBusy(false); }
  }
  async function saveAssets() {
    setBusy(true); setError("");
    try { await api.setSceneAssets(project.id, editing, assetIds); await onRefresh(); setEditing(""); setMessage("素材关联已保存。点击“应用到视频”后，在对话中确认发送修改要求。"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "素材关联保存失败"); }
    finally { setBusy(false); }
  }
  return <section className="storyboard-panel"><div className="section-heading"><div><h3>分镜</h3><p>{media.scenes.length ? "逐镜查看内容、关联素材，并提出修改。" : derived.length ? "从当前合成提取的场景；屏幕文案仅作内容参考。" : "场景、旁白与采用素材在这里保持关联。"}</p></div><span>{scenes.length} 个场景</span></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="draft-save-status" role="status">{message}</p> : null}
    {!media.scenes.length && derived.length ? <button className="secondary-action" disabled={busy || Boolean(project.activeTurnId)} onClick={() => void saveStructure()}><FloppyDisk/>保存分镜结构</button> : null}
    {scenes.length ? <div className="scene-editor-list">{scenes.map(scene => <article key={scene.id}><header><b>{String(scene.order).padStart(2, "0")} · {scene.narrativeRole || "未命名场景"}</b>{typeof scene.startSeconds === "number" ? <small>{scene.startSeconds.toFixed(1)} 秒起{typeof scene.durationSeconds === "number" ? ` · ${scene.durationSeconds.toFixed(1)} 秒` : ""}</small> : null}</header>{typeof scene.narration === "string" && scene.narration ? <p>{scene.narration}</p> : null}<div className="scene-asset-chips">{scene.assetIds.map(id => { const asset = media.assets.find(item => item.id === id); return <span key={id}><File/>{asset?.name || id}</span>; })}</div><div className="scene-actions"><button onClick={() => onContext(`场景 ${scene.order}（${scene.id}）· ${scene.narrativeRole}`)}>加入反馈</button>{media.scenes.length ? <button disabled={busy || Boolean(project.activeTurnId)} onClick={() => { setEditing(scene.id); setAssetIds(scene.assetIds); setError(""); }}>关联素材</button> : null}<button onClick={() => onCompose(`请修改场景 ${scene.order}（${scene.id}）：${scene.narrativeRole}。修改要求：`)}>修改这一镜<ArrowRight/></button>{scene.assetIds.length ? <button onClick={() => onCompose(`请按已保存的分镜素材关联更新场景 ${scene.order}（${scene.id}），采用 ${scene.assetIds.join("、")}，保留其他场景并生成新版草稿。`)}>应用到视频</button> : null}</div>
      {editing === scene.id ? <form className="scene-asset-editor" onSubmit={event => { event.preventDefault(); void saveAssets(); }}><fieldset disabled={busy}><legend>选择此镜头的项目素材</legend>{media.assets.map(asset => <label key={asset.id}><input type="checkbox" checked={assetIds.includes(asset.id)} onChange={event => setAssetIds(current => event.target.checked ? [...current, asset.id] : current.filter(id => id !== asset.id))}/><span>{asset.name}</span></label>)}{!media.assets.length ? <p>项目里还没有素材，请先在对话中添加附件或选择素材。</p> : null}<div className="scene-actions"><button type="submit">{busy ? "正在保存…" : "保存关联"}</button><button type="button" onClick={() => setEditing("")}>取消</button></div></fieldset></form> : null}
    </article>)}</div> : loading ? <p role="status"><CircleNotch/>正在读取分镜…</p> : <div className="workbench-empty"><SquaresFour/><b>{version ? "此项目尚未记录分镜结构" : "尚未生成分镜"}</b><p>{version ? "已有视频可以继续预览。可让创作助手从现有合成整理分镜。" : "确认制作方案后，生成的分镜会显示在这里。"}</p>{version ? <button className="secondary-action" onClick={() => onCompose("请从当前视频合成中整理并保存实际分镜结构，包含每个场景的内容、时间和采用素材，让分镜页能逐镜查看。保留现有视频内容，无需重新渲染。")}>整理现有分镜</button> : null}</div>}
  </section>;
}
