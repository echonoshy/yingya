import { useEffect, useState } from "react";
import type { MediaScene } from "../types";
import { sceneStart, sceneTitle } from "../workbench";
export function ProductStoryboard({ scenes, selectedId, onSelect }: {
  scenes: MediaScene[]; selectedId?: string; onSelect: (scene: MediaScene) => void;
}) {
  const [chosen, setChosen] = useState(selectedId ?? "");
  useEffect(() => { if (selectedId) setChosen(selectedId); }, [selectedId]);
  const scene = scenes.find(item => item.id === chosen) ?? scenes[0];
  if (!scene) return null;
  return <section className="product-storyboard" aria-label="镜头导航">
    <header><h3>镜头</h3><span>{scenes.length} 段 · 选择后定位画面</span></header>
    <div className="knowledge-chapters" role="group" aria-label="选择镜头">{scenes.map((item, index) => <button key={item.id} type="button" aria-pressed={scene.id === item.id} onClick={() => { setChosen(item.id); onSelect(item); }}>
      <span>{String(index + 1).padStart(2, "0")}</span><b>{sceneTitle(item) || item.narrativeRole || "内容段落"}</b>
      {sceneStart(item) !== undefined ? <small>{Math.floor(sceneStart(item)! / 60)}:{Math.floor(sceneStart(item)! % 60).toString().padStart(2, "0")}</small> : null}
    </button>)}</div>
  </section>;
}
