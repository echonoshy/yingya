import { assetRoleLabels } from "../workbench";
import type { AssetRole } from "../types";
export function AssetRoleSelect({ name, value = "auto", onChange, disabled = false }: { name: string; value?: AssetRole; onChange: (role: AssetRole) => void; disabled?: boolean }) {
  return <label className="asset-role-select"><span>用途</span><select aria-label={`${name}的素材用途`} value={value} disabled={disabled} onChange={event => onChange(event.target.value as AssetRole)}>{Object.entries(assetRoleLabels).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>;
}
