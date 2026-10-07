import { useEffect, useState } from "react";
import { ChatText, Sparkle, SpeakerHigh, TextT, Timer } from "@phosphor-icons/react";
import type { MediaAsset, MediaScene } from "../types";
import { sceneStart, sceneTitle } from "../workbench";
import type { SceneRevision } from "../sceneRevision";

const edits = [
  { label: "文字", icon: TextT, prompt: "调整画面文字与字幕（内容、字号、位置）：" },
  { label: "动效", icon: Sparkle, prompt: "调整文字入场、画面运动或转场（效果与节奏）：" },
  { label: "声音", icon: SpeakerHigh, prompt: "调整旁白、配乐或音量：" },
  { label: "节奏", icon: Timer, prompt: "调整镜头时长与停留节奏：" },
];

export function ProductStoryboard({ scenes, selectedId, versionId, disabled, onCompose, onSelect, onBeginRevision }: {
  scenes: MediaScene[]; assets: MediaAsset[]; selectedId?: string; versionId?: string; scenesRevision?: string | null; disabled?: boolean;
  onCompose: (text: string) => void; onSelect?: (scene: MediaScene) => void;
  onRevision?: (revision: SceneRevision, file?: File) => void; onBeginRevision?: () => void;
}) {
  const [chosen, setChosen] = useState(selectedId ?? "");
  useEffect(() => { if (selectedId) setChosen(selectedId); }, [selectedId]);
  const scene = scenes.find(item => item.id === chosen) ?? scenes[0];
  if (!scene) return null;
  function compose(prompt: string) {
    onBeginRevision?.();
    onCompose(`关于${versionId ? `版本「${versionId}」的` : "方案中的"}镜头「${scene.id}」（${sceneTitle(scene) || scene.narrativeRole || "内容段落"}），只修改这一段，保留其他镜头。\n${prompt}`);
  }
  return <section className="product-storyboard" aria-label="镜头编辑">
    <header><h3>镜头</h3><span>{scenes.length} 段 · 选择后定位画面</span></header>
    <div className="knowledge-chapters" role="group" aria-label="选择镜头">{scenes.map((item, index) => <button key={item.id} type="button" aria-pressed={scene.id === item.id} onClick={() => { setChosen(item.id); onSelect?.(item); }}>
      <span>{String(index + 1).padStart(2, "0")}</span><b>{sceneTitle(item) || item.narrativeRole || "内容段落"}</b>
      {sceneStart(item) !== undefined ? <small>{Math.floor(sceneStart(item)! / 60)}:{Math.floor(sceneStart(item)! % 60).toString().padStart(2, "0")}</small> : null}
    </button>)}</div>
    <div className="scene-edit-tools" role="group" aria-label="修改当前镜头">
      {edits.map(({ label, icon: Icon, prompt }) => <button key={label} disabled={disabled} onClick={() => compose(prompt)}><Icon/>{label}</button>)}
      <button disabled={disabled} onClick={() => compose("我想修改：")}><ChatText/>提意见</button>
    </div>
    <p className="scene-edit-hint">{disabled ? "当前版本暂不可修改，请等待制作结束或切回最新版本。" : "选择修改内容，在对话中补充要求后发送。"}</p>
  </section>;
}
