import { z } from "zod";
import { useState } from "react";
import { CircleNotch, Eye, Warning } from "@phosphor-icons/react";
import { api } from "../api";
import { sceneStart, sceneTitle, sourceClip, sourceFilePath } from "../workbench";
import type { EditorialRecipe, MediaScene, Workbench } from "../types";

export function recipeCompatible(recipe: EditorialRecipe, scene: MediaScene) {
  if (!recipe.requiresFocus) return true;
  const clip = scene.sourceClip as { focus?: { rect?: unknown; anchor?: unknown } } | undefined;
  return Boolean(clip?.focus && (clip.focus.rect && recipe.focusShapes.includes("rect") || clip.focus.anchor && recipe.focusShapes.includes("anchor")));
}
function time(seconds: number) { return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, "0")}`; }
function textField(value: unknown) { return typeof value === "string" ? value : Array.isArray(value) ? value.filter(v => typeof v === "string").join("；") : ""; }

export function SceneWorkbench({ projectId, workbench, sourceMode, selectedSceneId, running, onSelect, onSaved, onSourcePreview, onGeneratePreview }: {
  projectId: string; workbench: Workbench; sourceMode: boolean; selectedSceneId: string; running: boolean;
  onSelect: (id: string, time?: number) => void; onSaved: () => Promise<void>; onSourcePreview: () => void; onGeneratePreview: () => void;
}) {
  const view = sourceMode ? workbench.workspace : workbench;
  const bindings = view.sourceBindings?.scenes ?? [];
  const selected = view.scenes.find(scene => scene.id === selectedSceneId);
  const pending = workbench.workspace.scenes.find(scene => scene.id === selected?.id);
  return <section className="scene-workbench" aria-label="镜头清单"><header><b>{sourceMode ? "修改后的镜头" : "镜头清单"}</b><span>{view.scenes.length} 个镜头</span></header>
    {workbench.dirty && workbench.editable ? <div className="source-edit-notice"><span>镜头修改已保存，现有 MP4 尚未更新。</span><button type="button" disabled={running} onClick={onGeneratePreview}>生成新版预览</button><span>会提交制作请求，保留素材、源起止、其他镜头和音轨。</span></div> : null}
    {!view.scenes.length ? <p>分析素材后，这里会列出镜头内容与源片段。</p> : <div className="scene-list">{view.scenes.map((scene, index) => {
      const clip = sourceClip(scene, bindings);
      return <button type="button" className={selected?.id === scene.id ? "selected" : ""} aria-pressed={selected?.id === scene.id} key={scene.id} onClick={() => onSelect(scene.id, sceneStart(scene, bindings))}>
        <span>{String(index + 1).padStart(2, "0")}</span><span><b>{sceneTitle(scene) || scene.narrativeRole || "待补充镜头说明"}</b><small>{clip ? `源片段 ${time(clip.sourceIn)}–${time(clip.sourceOut)}` : "尚未绑定源片段"}</small></span>
        <small>{workbench.recipeCatalog.recipes.find(recipe => recipe.id === scene.recipe)?.name ?? "自定义镜头"}</small>
      </button>;
    })}</div>}
    {selected ? <div className="scene-detail" key={`${sourceMode}:${selected.id}`}>
      {textField(selected.cutReason ?? selected.reason ?? selected.narrativeRole) ? <p><b>选择理由：</b>{textField(selected.cutReason ?? selected.reason ?? selected.narrativeRole)}</p> : null}
      {textField(selected.uncertainty ?? selected.uncertainties) ? <p className="scene-uncertainty"><Warning/><span>{textField(selected.uncertainty ?? selected.uncertainties)}</span></p> : null}
      <SceneEvidence projectId={projectId} workbench={workbench} scene={selected}/>
      <SourceClipPreview key={`${view.sourcePath}:${selected.id}`} projectId={projectId} sourcePath={view.sourcePath} scene={selected} bindings={bindings}/>
      {workbench.editable && pending && workbench.currentVersionId ? <SceneEditor key={`${pending.id}:${workbench.workspace.scenesRevision}`} projectId={projectId} workbench={workbench} scene={pending} running={running} onSaved={onSaved}/>
        : <p className="scene-edit-note">{workbench.editReason || "确认方案并生成当前视频后，可在这里调整单个镜头。"}</p>}
      {workbench.editable ? <button type="button" className="scene-source-preview" onClick={onSourcePreview}><Eye/>查看修改后的实时画面</button> : null}
    </div> : view.scenes.length ? <p>选择镜头可查看源片段与修改选项；播放视频时会跟随当前镜头。</p> : null}
  </section>;
}
function SourceClipPreview({ projectId, sourcePath, scene, bindings }: { projectId: string; sourcePath: string; scene: MediaScene; bindings: NonNullable<Workbench["sourceBindings"]>["scenes"] }) {
  const clip = sourceClip(scene, bindings);
  const path = clip && sourceFilePath(sourcePath, clip.source);
  if (!clip || !path) return null;
  return <details className="scene-source"><summary>预览源片段 · {time(clip.sourceIn)}–{time(clip.sourceOut)}</summary><video aria-label="当前镜头的源片段" src={api.fileUrl(projectId, path)} controls preload="metadata"
    onLoadedMetadata={event => { event.currentTarget.currentTime = clip.sourceIn; }}
    onPlay={event => { if (event.currentTarget.currentTime < clip.sourceIn || event.currentTarget.currentTime >= clip.sourceOut) event.currentTarget.currentTime = clip.sourceIn; }}
    onTimeUpdate={event => { if (event.currentTarget.currentTime >= clip.sourceOut) event.currentTarget.pause(); }}/><p>{clip.audioMode === "mute" ? "本镜头静音，源片段预览保留素材本身的音轨。" : "源文件预览，制作时保持已选的原声安排。"}</p></details>;
}
function SceneEditor({ projectId, workbench, scene, running, onSaved }: { projectId: string; workbench: Workbench; scene: MediaScene; running: boolean; onSaved: () => Promise<void> }) {
  const initialTitle = sceneTitle(scene);
  const initialRecipe = typeof scene.recipe === "string" ? scene.recipe : "";
  const [title, setTitle] = useState(initialTitle);
  const [recipe, setRecipe] = useState(initialRecipe);
  const [rect, setRect] = useState(() => initialFocusRect(scene));
  const [updateFocus, setUpdateFocus] = useState(false);
  const validRect = Object.values(rect).every(value => Number.isFinite(value) && value >= 0 && value <= 100) && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= 100.000001 && rect.y + rect.height <= 100.000001;
  const draftScene = updateFocus ? { ...scene, sourceClip: { ...(scene.sourceClip as object ?? {}), focus: { rect } } } : scene;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const changed = title !== initialTitle || recipe !== initialRecipe || updateFocus;
  const selectedRecipe = workbench.recipeCatalog.recipes.find(item => item.id === recipe);
  const validRecipe = recipe === initialRecipe || Boolean(selectedRecipe && recipeCompatible(selectedRecipe, draftScene));
  async function save() {
    if (!workbench.currentVersionId || !workbench.workspace.scenesRevision || busy || running || !changed) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api.editScene(projectId, scene.id, { baseVersionId: workbench.currentVersionId, expectedScenesRevision: workbench.workspace.scenesRevision,
        patch: { ...(title !== initialTitle ? { title: title.trim() } : {}), ...(recipe !== initialRecipe ? { recipe } : {}), ...(updateFocus ? { focus: { rect: { x: rect.x / 100, y: rect.y / 100, width: rect.width / 100, height: rect.height / 100 } } } : {}) } });
      setNotice(result.summary || "镜头源已更新，尚未生成新的 MP4。");
      await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "镜头修改失败"); }
    finally { setBusy(false); }
  }
  return <div className="scene-editor"><label>镜头短标题<input aria-label="镜头短标题" value={title} maxLength={100} disabled={busy || running} onChange={event => setTitle(event.target.value)}/></label><label>镜头效果<select aria-label="镜头效果" value={recipe} disabled={busy || running} onChange={event => setRecipe(event.target.value)}>{!workbench.recipeCatalog.recipes.some(item => item.id === initialRecipe) ? <option value={initialRecipe}>自定义镜头</option> : null}{workbench.recipeCatalog.recipes.map(item => <option key={item.id} value={item.id} disabled={!recipeCompatible(item, draftScene)}>{item.name}{recipeCompatible(item, draftScene) ? "" : " · 需先指定聚焦区域"}</option>)}</select></label>
    <details className="scene-focus-controls"><summary>设置聚焦区域</summary><p>位置和大小均相对原素材画面。初始矩形供调整，勾选后才随本次修改保存。</p><label className="scene-focus-enabled"><input type="checkbox" checked={updateFocus} disabled={busy || running} onChange={event => setUpdateFocus(event.target.checked)}/>更新聚焦区域</label><div className="scene-focus-grid">{(["x", "y", "width", "height"] as const).map(key => <label key={key}>{({ x: "左侧位置", y: "顶部位置", width: "区域宽度", height: "区域高度" })[key]} (%)<input type="number" min={key === "x" || key === "y" ? 0 : 1} max={100} step={1} value={rect[key]} disabled={busy || running} onChange={event => { setUpdateFocus(true); setRect(current => ({ ...current, [key]: Number(event.target.value) })); }}/></label>)}</div>{updateFocus && !validRect ? <p className="form-error" role="alert">区域必须完整位于原素材画面内，宽高需要大于零。</p> : null}</details>
    {workbench.requirements.subtitles === "none" ? <p className="scene-edit-note">已关闭新增字幕，此镜头说明不显示在视频中。</p> : null}
    <p>{workbench.recipeCatalog.recipes.find(item => item.id === recipe)?.description} 修改保留素材、源起止和原声安排。</p>
    <button type="button" disabled={busy || running || !changed || !title.trim() || !validRecipe || (updateFocus && !validRect)} onClick={() => void save()}>{busy ? <CircleNotch className="spin"/> : null}{busy ? "正在更新镜头…" : "应用到这个镜头"}</button>
    {notice ? <p role="status">{notice}</p> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}

export function initialFocusRect(scene: MediaScene) {
  const clip = scene.sourceClip as { focus?: { rect?: { x: number; y: number; width: number; height: number }; anchor?: { x: number; y: number } } } | undefined;
  const rect = clip?.focus?.rect;
  if (rect) return { x: rect.x * 100, y: rect.y * 100, width: rect.width * 100, height: rect.height * 100 };
  const anchor = clip?.focus?.anchor ?? { x: .5, y: .5 };
  return { x: Math.round(Math.min(.8, Math.max(0, anchor.x - .1)) * 100), y: Math.round(Math.min(.8, Math.max(0, anchor.y - .1)) * 100), width: 20, height: 20 };
}
function SceneEvidence({ projectId, workbench, scene }: { projectId: string; workbench: Workbench; scene: MediaScene }) {
  // The backend currently exposes the workspace index. Never present it as
  // observations belonging to an older rendered version.
  if (workbench.versionId && workbench.versionId !== workbench.currentVersionId) return null;
  const ids = Array.isArray(scene.evidenceIds) ? scene.evidenceIds.filter((value): value is string => typeof value === "string") : [];
  const observationIndex = z.object({ sources: z.array(z.object({ observations: z.array(z.object({ id: z.string(), summary: z.string().optional(), result: z.string().optional(), confidence: z.string().optional(), evidenceFrames: z.array(z.string()).optional() })).optional() })) }).safeParse(workbench.contentIndex);
  const index = observationIndex.success ? observationIndex.data : undefined;
  if (!ids.length || !Array.isArray(index?.sources)) return null;
  const observations = index.sources.flatMap(source => Array.isArray(source.observations) ? source.observations.filter(item => ids.includes(item.id)) : []);
  if (!observations.length) return <p>此镜头引用的观察暂未找到，请核对内容分析记录。</p>;
  return <div className="scene-evidence"><b>已有素材观察</b><p>以下为 Agent 记录，本次未复验来源指纹与语义。</p>{observations.map((item, i) => <article key={`${item.id}:${i}`}><strong>{item.confidence === "confirmed" ? "记录为已确认" : "仍需核对"}</strong><span>{item.summary}</span>{item.result ? <p>结果：{item.result}</p> : null}<div>{(Array.isArray(item.evidenceFrames) ? item.evidenceFrames : []).slice(0, 4).map(path => {
    const file = typeof path === "string" && sourceFilePath(".", path);
    return file ? <a key={file} href={api.fileUrl(projectId, file)} target="_blank" rel="noreferrer"><img src={api.fileUrl(projectId, file)} alt={`观察证据：${item.summary || item.id}`} loading="lazy"/></a> : null;
  })}</div></article>)}</div>;
}
