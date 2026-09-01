import { CaretRight, Check } from "@phosphor-icons/react";
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
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
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

  return <div className="model-selector" ref={root}>
    <button type="button" className="model-trigger" onClick={() => setOpen(current => !current)} aria-haspopup="menu" aria-expanded={open}>
      {displayName} · {effortName}<span>⌄</span>
    </button>
    {open ? <div className="model-menu" role="menu">
      <div className="model-menu-primary">
        {models.map(model => <button
          type="button"
          role="menuitem"
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
      <div className="model-menu-secondary">
        <small>思考深度</small>
        {efforts.map(effort => <button
          type="button"
          role="menuitem"
          key={effort}
          onClick={() => {
            onChange({ model: selectedModel?.model ?? value.model, reasoningEffort: effort });
            setOpen(false);
          }}
        >
          <span>{effortLabels[effort] ?? effort}</span>
          {value.reasoningEffort === effort ? <Check/> : null}
        </button>)}
      </div>
    </div> : null}
  </div>;
}
