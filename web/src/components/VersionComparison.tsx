import { useState } from "react";
import { api } from "../api";
import type { DraftVersion, ProjectDetail } from "../types";
export function VersionComparison({ project, current }: { project: ProjectDetail; current: DraftVersion }) {
  const alternatives = project.manifest.versions.filter(item => item.id !== current.id);
  const [compareId, setCompareId] = useState("");
  const compare = alternatives.find(item => item.id === compareId) ?? alternatives.at(-1);
  const [open, setOpen] = useState(false);
  if (!compare) return null;
  return <details className="version-comparison" onToggle={event => setOpen(event.currentTarget.open)}><summary>比较版本与修改说明</summary><label>对比版本<select value={compare.id} onChange={event => setCompareId(event.target.value)}>{alternatives.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{open ? <div className="version-comparison-grid">{[compare, current].map((version, index) => <section key={version.id}><small>{index ? "当前查看" : "对比版本"}</small><h4>{version.label}</h4><p>{new Date(version.createdAt).toLocaleString("zh-CN")}</p>{version.videoPath ? <video controls preload="metadata" src={api.fileUrl(project.id, version.videoPath)} aria-label={`${version.label}对比预览`}/> : <p>此版本没有预览视频。</p>}{version.reportPath ? <a href={api.fileUrl(project.id, version.reportPath)} target="_blank" rel="noreferrer">查看版本检查报告</a> : null}</section>)}</div> : null}</details>;
}
