import { Cube, Megaphone, ListNumbers } from "@phosphor-icons/react";
import { productWorkflows, type ProductWorkflowId } from "../productWorkflows";

const icons = { "product-intro": Cube, "feature-launch": Megaphone, walkthrough: ListNumbers };
export function ProductWorkflowPicker({ value, onChange }: { value: ProductWorkflowId | null; onChange: (value: ProductWorkflowId | null) => void }) {
  return <div className="product-workflows" role="group" aria-label="选择视频用途">
    <div className="product-workflow-options">{productWorkflows.map(item => {
      const Icon = icons[item.id];
      return <button type="button" key={item.id} aria-pressed={value === item.id} onClick={() => onChange(item.id)}><Icon/><span><b>{item.name}</b><small>{item.caption}</small></span></button>;
    })}</div>
    <button type="button" className="free-creation" aria-pressed={!value} onClick={() => onChange(null)}>自由创作</button>
  </div>;
}
