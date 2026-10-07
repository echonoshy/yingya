import { useId } from "react";
import { SelectControl } from "./SelectControl";

export function UsageModelFilter({ models, value, onChange }: {
  models: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const options = Array.from(new Set(["", ...models, ...(value ? [value] : [])]));
  return <label className="usage-model-field" htmlFor={id}>
    <span>模型</span>
    <SelectControl id={id} aria-label="模型" value={value} onChange={event => onChange(event.target.value)}>
      {options.map(model => <option key={model} value={model}>{model || "全部模型"}</option>)}
    </SelectControl>
  </label>;
}
