import { FilmSlate, Images, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import type { ProjectRecord } from "../types";

function formatProjectTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><img src="/brand/invideo-favicon-black.ico" alt=""/></span><span><b>映芽</b></span></div>;
}

export function ProjectSidebar({ projects, loading, activeId, activeSection = "create", onOpen, onDelete, onNew, onCreate, onAssets }: { projects: ProjectRecord[]; loading?: boolean; activeId?: string; activeSection?: "create" | "assets"; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void>; onNew?: () => void; onCreate?: () => void; onAssets?: () => void }) {
  const [deletingId, setDeletingId] = useState("");
  async function remove(project: ProjectRecord) {
    if (!window.confirm(`确定删除“${project.title}”吗？\n项目文件和生成内容将被永久删除。`)) return;
    setDeletingId(project.id);
    try { await onDelete(project); }
    catch (reason) { window.alert(reason instanceof Error ? reason.message : "项目删除失败"); }
    finally { setDeletingId(""); }
  }
  return <aside className="sidebar">
    <Brand/>
    {onCreate && onAssets ? <nav className="product-nav" aria-label="映芽功能"><button className={activeSection === "create" ? "active" : ""} onClick={onCreate}><FilmSlate/>视频创作</button><button className={activeSection === "assets" ? "active" : ""} onClick={onAssets}><Images/>素材工坊</button></nav> : null}
    {onNew ? <button className="new-task primary-fill" onClick={onNew}><Plus weight="bold"/>新建视频</button> : null}
    <div className="project-list"><header><h2>{activeSection === "assets" ? "最近项目" : "项目"}</h2><span>{projects.length || ""}</span></header>{(activeSection === "assets" ? projects.slice(0, 4) : projects).map(project => <div className={`project-item ${project.id === activeId ? "active" : ""}`} key={project.id}><button className="project-open" onClick={() => onOpen(project.id)}><span className="project-glyph"><FilmSlate/></span><span><b>{project.title}</b><small className={`project-status project-status--${project.status}`}>{project.statusLabel}</small></span>{project.activeTurnId ? <i className="running-dot"/> : <time>{formatProjectTime(project.updatedAt)}</time>}</button><button className="project-delete" aria-label={`删除项目 ${project.title}`} title={project.activeTurnId ? "请先停止正在运行的任务" : "删除项目"} disabled={Boolean(project.activeTurnId) || deletingId === project.id} onClick={() => void remove(project)}><Trash/></button></div>)}{activeSection === "assets" && projects.length > 4 && onCreate ? <button className="project-view-all" onClick={onCreate}>查看全部项目</button> : null}{loading ? <p>正在读取项目…</p> : null}{!loading && !projects.length ? <div className="project-empty"><FilmSlate/><span>还没有视频项目</span></div> : null}</div>
  </aside>;
}
