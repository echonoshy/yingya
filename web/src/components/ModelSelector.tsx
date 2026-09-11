import { selectableModels } from "../models";
import { usePopoverPosition } from "../hooks/usePopoverPosition";
import { useMotionPresence } from "../hooks/useMotionPresence";
import { CaretDown, CaretRight, Check } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CodexModel, ModelSelection } from "../types";

const effortLabels: Record<string, string> = {
  auto: "自动",
  none: "无",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最大",
  ultra: "Ultra",
};

export function ModelSelector({ models, value, onChange }: {
  models: CodexModel[];
  value: ModelSelection;
  onChange: (value: ModelSelection) => void;
}) {
  const menuModels = useMemo(() => selectableModels(models), [models]);
  const [open, setOpen] = useState(false);
  const presence = useMotionPresence(open ? true : null);
  const root = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(Boolean(presence.value), root);
  useEffect(() => { if (presence.value && !presence.exiting) root.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"]')?.focus({ preventScroll: true }); }, [presence.value, presence.exiting]);
  const matchingModel = models.find(model => model.model === value.model);
  const selectedModel = matchingModel ?? models[0];
  const efforts = useMemo(() => {
    const supported = selectedModel?.supportedReasoningEfforts.map(option => option.reasoningEffort) ?? [];
    return ["auto", ...supported.filter(effort => effort !== "auto")];
  }, [selectedModel]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const displayName = matchingModel?.displayName ?? value.model;
  const effortName = effortLabels[value.reasoningEffort] ?? value.reasoningEffort;

  return <div className="model-selector" ref={root} onKeyDown={event => {
    if (open && event.key === "Tab") setOpen(false);
    if (!open && event.key === "ArrowDown") { event.preventDefault(); setOpen(true); return; }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
    if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLButtonElement>(".model-trigger")?.focus(); } }}>
    <button type="button" className="model-trigger" title={`制作助手模型：${displayName} · ${effortName}`} onClick={() => setOpen(current => !current)} aria-haspopup="menu" aria-expanded={open}>
      <span className="model-trigger-label">{displayName} · {effortName}</span><CaretDown className="control-chevron" aria-hidden="true"/>
    </button>
    {presence.value ? <div ref={presence.ref} inert={presence.exiting} aria-hidden={presence.exiting || undefined} className="model-menu" role="menu" style={position}>
      <div className="model-menu-primary" role="group" aria-label="制作助手模型">
        {menuModels.map(model => <button
          type="button"
          role="menuitemradio"
          aria-checked={value.model === model.model}
          key={model.id}
          className={value.model === model.model ? "active" : ""}
          onClick={() => {
            const supported = model.supportedReasoningEfforts.some(option => option.reasoningEffort === value.reasoningEffort);
            onChange({ model: model.model, reasoningEffort: supported ? value.reasoningEffort : model.defaultReasoningEffort });
          }}
        >
          <span>{model.displayName}</span>{value.model === model.model ? <Check/> : <CaretRight/>}
        </button>)}
      </div>
      <div className="model-menu-secondary" role="group" aria-label="思考深度">
        <small>思考深度</small>
        {efforts.map(effort => <button
          type="button"
          role="menuitemradio"
          aria-checked={value.reasoningEffort === effort}
          key={effort}
          onClick={() => {
            onChange({ model: selectedModel?.model ?? value.model, reasoningEffort: effort });
            setOpen(false);
            root.current?.querySelector<HTMLButtonElement>(".model-trigger")?.focus();
          }}
        >
          <span>{effortLabels[effort] ?? effort}</span>
          {value.reasoningEffort === effort ? <Check/> : null}
        </button>)}
      </div>
    </div> : null}
  </div>;
}
