import { videoCapabilities } from "./FootagePanel";
import {
  FilmSlate,
  FrameCorners,
  Scissors,
  VideoCamera,
  Check,
  X,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { styles } from "../../../runtime/editor/catalog.mjs";
import type { CreationRequirements } from "../types";
export type CreationMode = NonNullable<CreationRequirements["creationMode"]>;
export type StyleId = NonNullable<CreationRequirements["styleId"]>;
export const creationModes = [
  {
    id: "motion",
    name: "动画视频",
    description: "用文字、图片和图表讲清楚一个想法",
    icon: FilmSlate,
  },
  {
    id: "single",
    name: "单镜动画",
    description: "一个完整镜头，适合开场与社交分享",
    icon: FrameCorners,
  },
  {
    id: "edit",
    name: "编辑已有视频",
    description: "上传视频，裁切、配音并加入说明",
    icon: Scissors,
  },
  {
    id: "ai-video",
    name: "AI 镜头视频",
    description: "需要连接视频生成服务，当前可导入已有 AI 片段",
    icon: VideoCamera,
  },
] as const;
export function CreationModePicker({
  value,
  onChange,
}: {
  value: CreationMode;
  onChange: (mode: CreationMode) => void;
}) {
  const [videoState, setVideoState] = useState("正在读取视频服务状态…");
  useEffect(() => {
    void videoCapabilities()
      .then((value) => setVideoState(value.reason))
      .catch(() =>
        setVideoState("暂时无法读取视频服务，可先选择动画或导入片段"),
      );
  }, []);
  return (
    <div className="creation-modes" role="group" aria-label="制作方式">
      {creationModes.map((mode) => (
        <button
          type="button"
          key={mode.id}
          aria-pressed={value === mode.id}
          onClick={() => onChange(mode.id)}
          title={mode.description}
        >
          <mode.icon />
          <span>{mode.name}</span>
        </button>
      ))}
      <p>
        {value === "ai-video"
          ? videoState
          : creationModes.find((mode) => mode.id === value)?.description}
      </p>
    </div>
  );
}
export function StyleDiscovery({
  value,
  onChange,
}: {
  value: StyleId | null;
  onChange: (id: StyleId | null) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState("全部");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  const cards = (all = false) =>
    styles
      .filter(
        (style) =>
          (!all || category === "全部" || style.category === category) &&
          `${style.name}${style.description}`.includes(search),
      )
      .map((style) => (
        <button
          type="button"
          key={style.id}
          aria-pressed={value === style.id}
          onClick={() => {
            onChange(style.id as StyleId);
            setOpen(false);
          }}
        >
          <img
            src={`/editor-styles/${style.id}.png`}
            alt={`${style.name}效果预览`}
          />
          <span>
            <b>{style.name}</b>
            {value === style.id ? <Check /> : null}
          </span>
          {all ? <small>{style.description}</small> : null}
        </button>
      ));
  return (
    <section className="style-discovery" aria-label="选择视频风格">
      <header>
        <div>
          <h2>给想法一种表达</h2>
          <p>选择风格，或让映芽根据内容决定。</p>
        </div>
        <button type="button" onClick={() => setOpen(true)}>
          全部风格
        </button>
      </header>
      <div className="style-discovery-grid">{cards()}</div>
      {value ? (
        <button
          type="button"
          className="style-clear"
          onClick={() => onChange(null)}
        >
          已选 {styles.find((s) => s.id === value)?.name}
          <X />
          恢复自动选择
        </button>
      ) : null}
      <dialog
        ref={dialog}
        className="style-library-dialog"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <header>
          <div>
            <h2>风格库</h2>
            <p>可直接编辑的文字、图形与动画。</p>
          </div>
          <button
            type="button"
            aria-label="关闭风格库"
            onClick={() => setOpen(false)}
          >
            <X />
          </button>
        </header>
        <label className="style-library-search">
          <MagnifyingGlass />
          <input
            aria-label="搜索风格"
            placeholder="搜索风格或适用场景"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="style-categories" role="group" aria-label="风格分类">
          {["全部", ...new Set(styles.map((s) => s.category))].map((c) => (
            <button
              type="button"
              aria-pressed={category === c}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="style-discovery-grid">{cards(true)}</div>
      </dialog>
    </section>
  );
}
