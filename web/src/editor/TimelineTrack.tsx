import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  Images,
  LockSimple,
  LockSimpleOpen,
  SpeakerHigh,
  SpeakerSlash,
  TextT,
} from "@phosphor-icons/react";
import type {
  EditorCommand,
  EditorElement,
  EditorScene,
  EditorTrack,
} from "../../../runtime/editor/model.mjs";
type ScheduledScene = EditorScene & { start: number };
export function layoutTrack(scenes: ScheduledScene[], trackId: string) {
  const ends: number[] = [];
  return scenes
    .flatMap((scene) =>
      scene.elements
        .filter((el) => el.trackId === trackId)
        .map((element) => ({ scene, element })),
    )
    .sort(
      (a, b) =>
        a.scene.start + a.element.start - b.scene.start - b.element.start,
    )
    .map((item) => {
      const start = item.scene.start + item.element.start;
      let lane = ends.findIndex((end) => end <= start + 0.001);
      if (lane < 0) lane = ends.length;
      ends[lane] = start + item.element.duration;
      return { ...item, lane };
    });
}
export function TimelineTrack({
  track,
  scenes,
  zoom,
  snapping,
  selected,
  disabled,
  onCommand,
  onSelect,
}: {
  track: EditorTrack;
  scenes: ScheduledScene[];
  zoom: number;
  snapping: boolean;
  selected: string;
  disabled: boolean;
  onCommand: (command: EditorCommand) => void;
  onSelect: (scene: ScheduledScene, element: EditorElement) => void;
}) {
  const items = layoutTrack(scenes, track.id),
    lanes = Math.max(1, ...items.map((item) => item.lane + 1));
  return (
    <div className="editor-track-row" style={{ height: lanes * 36 + 8 }}>
      <div className="editor-track-label">
        <span>{track.name}</span>
        <button
          disabled={disabled}
          aria-label={`${track.locked ? "解锁" : "锁定"}${track.name}轨道`}
          onClick={() =>
            onCommand({
              type: "track.update",
              trackId: track.id,
              patch: { locked: !track.locked },
            })
          }
        >
          {track.locked ? <LockSimple /> : <LockSimpleOpen />}
        </button>
        {track.kind !== "text" ? (
          <button
            disabled={disabled}
            aria-label={`${track.muted ? "取消静音" : "静音"}${track.name}轨道`}
            onClick={() =>
              onCommand({
                type: "track.update",
                trackId: track.id,
                patch: { muted: !track.muted },
              })
            }
          >
            {track.muted ? <SpeakerSlash /> : <SpeakerHigh />}
          </button>
        ) : null}
      </div>
      {items.map(({ scene, element, lane }) => (
        <Clip
          key={element.id}
          scene={scene}
          element={element}
          lane={lane}
          zoom={zoom}
          snapping={snapping}
          selected={selected === element.id}
          disabled={disabled || track.locked}
          onCommand={onCommand}
          onSelect={() => onSelect(scene, element)}
        />
      ))}
    </div>
  );
}
function Clip({
  scene,
  element,
  lane,
  zoom,
  snapping,
  selected,
  disabled,
  onCommand,
  onSelect,
}: {
  scene: ScheduledScene;
  element: EditorElement;
  lane: number;
  zoom: number;
  snapping: boolean;
  selected: boolean;
  disabled: boolean;
  onCommand: (command: EditorCommand) => void;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  function drag(
    event: ReactPointerEvent<HTMLButtonElement>,
    mode: "move" | "in" | "out",
  ) {
    if (disabled) return;
    event.preventDefault();
    onSelect();
    const target = event.currentTarget,
      x = event.clientX;
    target.setPointerCapture(event.pointerId);
    let patch: Partial<EditorElement> = {},
      moved = false;
    const draw = (start: number, duration: number) => {
      if (ref.current) {
        ref.current.style.left = `${120 + (scene.start + start) * zoom}px`;
        ref.current.style.width = `${Math.max(10, duration * zoom - 4)}px`;
      }
    };
    const move = (e: PointerEvent) => {
      let delta = (e.clientX - x) / zoom;
      const quantum = snapping ? 0.1 : 0.01;
      delta = Math.round(delta / quantum) * quantum;
      moved ||= Math.abs(e.clientX - x) > 3;
      const media = element.kind === "audio" || element.kind === "video";
      if (mode === "move")
        patch = {
          start: Math.max(
            0,
            Math.min(scene.duration - element.duration, element.start + delta),
          ),
        };
      if (mode === "out")
        patch = {
          duration: Math.max(
            0.05,
            Math.min(
              scene.duration - element.start,
              media
                ? element.sourceDuration! - element.sourceIn
                : scene.duration,
              element.duration + delta,
            ),
          ),
        };
      if (mode === "in") {
        const start = Math.max(
          media ? Math.max(0, element.start - element.sourceIn) : 0,
          Math.min(
            element.start + element.duration - 0.05,
            element.start + delta,
          ),
        );
        const shift = start - element.start;
        patch = {
          start,
          duration: element.duration - shift,
          ...(media ? { sourceIn: element.sourceIn + shift } : {}),
        };
      }
      draw(patch.start ?? element.start, patch.duration ?? element.duration);
    };
    const cleanup = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", cancel);
    };
    const end = () => {
      cleanup();
      if (moved)
        onCommand({
          type: "element.update",
          sceneId: scene.id,
          elementId: element.id,
          patch,
        });
      else draw(element.start, element.duration);
    };
    const cancel = () => {
      cleanup();
      draw(element.start, element.duration);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", cancel);
  }
  return (
    <div
      ref={ref}
      className={`editor-timeline-clip ${selected ? "is-selected" : ""}`}
      style={{
        left: 120 + (scene.start + element.start) * zoom,
        width: Math.max(10, element.duration * zoom - 4),
        top: 6 + lane * 36,
      }}
    >
      <button
        className="editor-trim-handle"
        aria-label={`裁切 ${element.name} 入点，精确数值见编辑面板`}
        disabled={disabled}
        onPointerDown={(e) => drag(e, "in")}
        onClick={onSelect}
      />
      <button
        className="editor-clip-body"
        title={`${element.name} · ${element.duration.toFixed(1)} 秒`}
        onPointerDown={(e) => drag(e, "move")}
        onClick={onSelect}
      >
        {element.kind === "text" ? (
          <TextT />
        ) : element.kind === "audio" ? (
          <SpeakerHigh />
        ) : (
          <Images />
        )}
        {element.name}
      </button>
      <button
        className="editor-trim-handle"
        aria-label={`裁切 ${element.name} 出点，精确数值见编辑面板`}
        disabled={disabled}
        onPointerDown={(e) => drag(e, "out")}
        onClick={onSelect}
      />
    </div>
  );
}
