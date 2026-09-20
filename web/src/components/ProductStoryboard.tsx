import { useState } from "react";
import { ChatText } from "@phosphor-icons/react";
import type { MediaAsset, MediaScene } from "../types";
import { sceneTitle } from "../workbench";
import type { SceneRevision } from "../sceneRevision";

export function ProductStoryboard({ scenes, selectedId, versionId, onCompose, onSelect, onBeginRevision }: {
  scenes: MediaScene[]; assets: MediaAsset[]; selectedId?: string; versionId?: string; scenesRevision?: string | null; disabled?: boolean;
  onCompose: (text: string) => void; onSelect?: (scene: MediaScene) => void;
  onRevision?: (revision: SceneRevision, file?: File) => void; onBeginRevision?: () => void;
}) {
  const [chosen, setChosen] = useState("");
  const scene = scenes.find(item => item.id === selectedId) ?? scenes.find(item => item.id === chosen) ?? scenes[0];
  if (!scene) return null;
  return <details className="product-storyboard"><summary>内容段落 · {scenes.length} 段</summary>
    <div className="knowledge-chapters">{scenes.map((item, index) => <button key={item.id} type="button" aria-pressed={scene.id === item.id} onClick={() => { setChosen(item.id); onSelect?.(item); }}>{index + 1}. {sceneTitle(item) || item.narrativeRole || "内容段落"}</button>)}</div>
    <button type="button" onClick={() => { onBeginRevision?.(); onCompose(`关于${versionId ? `版本「${versionId}」的` : "方案中的"}段落「${scene.id}」（${sceneTitle(scene) || scene.narrativeRole}），我想修改：`); }}><ChatText/>对此提意见</button>
  </details>;
}
