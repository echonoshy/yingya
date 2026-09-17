import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { api } from "../api";
import { AssetPicker } from "./AssetPicker";
import { AssetRoleSelect } from "./AssetRoleSelect";
import type { AssetFolder, AssetLibraryItem, AssetRole } from "../types";

export function CreationLibraryDialog({ selectedIds, onSelect, roles, onRole, onClose }: {
  selectedIds: string[]; onSelect: (ids: string[]) => void; roles: Record<string, AssetRole>;
  onRole: (id: string, role: AssetRole) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [assets, setAssets] = useState<AssetLibraryItem[]>([]), [folders, setFolders] = useState<AssetFolder[]>([]);
  const [error, setError] = useState(""), [loaded, setLoaded] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  useEffect(() => {
    let cancelled = false; setLoaded(false); setError("");
    void Promise.all([api.listAssetLibrary(), api.listAssetFolders()]).then(([library, list]) => {
      if (!cancelled) { setAssets(library.assets); setFolders(list); setLoaded(true); }
    }).catch(() => { if (!cancelled) setError("素材库读取失败，请重试。"); });
    return () => { cancelled = true; };
  }, [retry]);
  return <dialog ref={dialog} className="cap-modal" aria-labelledby="creation-library-title" onCancel={onClose} onClick={event => { if (event.currentTarget === event.target) onClose(); }}>
    <header><h2 id="creation-library-title">从素材库选择</h2><button className="cap-icon" aria-label="关闭素材选择" onClick={onClose}><X/></button></header>
    <div className="cap-modal-body">{error ? <p className="cap-error" role="alert">{error}<button onClick={() => setRetry(value => value + 1)}>重试</button></p> : !loaded ? <p role="status">正在读取素材…</p> : <>
      <AssetPicker assets={assets} folders={folders} selectedIds={selectedIds} onToggle={asset => onSelect(selectedIds.includes(asset.id) ? selectedIds.filter(id => id !== asset.id) : [...selectedIds, asset.id])}/>
      <div className="selected-material-roles">{assets.filter(asset => selectedIds.includes(asset.id)).map(asset => <div key={asset.id}><span>{asset.sourceName || asset.prompt || "未命名素材"}</span><AssetRoleSelect name={asset.sourceName || asset.prompt || "未命名素材"} value={roles[`library:${asset.id}`]} onChange={role => onRole(`library:${asset.id}`, role)}/></div>)}</div>
      {selectedIds.some(id => !assets.some(asset => asset.id === id)) ? <button onClick={() => onSelect(selectedIds.filter(id => assets.some(asset => asset.id === id)))}>移除已不可用的素材选择</button> : null}
    </>}<div className="cap-modal-actions"><button className="cap-primary" onClick={onClose}>完成选择{selectedIds.length ? ` · ${selectedIds.length} 项` : ""}</button></div></div>
  </dialog>;
}
