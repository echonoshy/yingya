import { FilmSlate, Plus, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import type { ProjectRecord } from "../types";

function formatProjectTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><img src="/brand/invideo-favicon-white.ico" alt=""/></span><span><b>映芽</b><small>YINGYA</small></span></div>;
}

export function ProjectSidebar({ projects, loading, activeId, onOpen, onDelete, onNew }: { projects: ProjectRecord[]; loading?: boolean; activeId?: string; onOpen: (id: string) => void; onDelete: (project: ProjectRecord) => Promise<void>; onNew?: () => void }) {
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
    {onNew ? <button className="new-task kiro-fill" onClick={onNew}><Plus weight="bold"/>新建视频</button> : null}
    <div className="project-list"><header><h2>项目</h2><span>{projects.length || ""}</span></header>{projects.map(project => <div className={`project-item ${project.id === activeId ? "active" : ""}`} key={project.id}><button className="project-open" onClick={() => onOpen(project.id)}><span className="project-glyph"><FilmSlate/></span><span><b>{project.title}</b><small className={`project-status project-status--${project.status}`}>{project.statusLabel}</small></span>{project.activeTurnId ? <i className="running-dot"/> : <time>{formatProjectTime(project.updatedAt)}</time>}</button><button className="project-delete" aria-label={`删除项目 ${project.title}`} title={project.activeTurnId ? "请先停止正在运行的任务" : "删除项目"} disabled={Boolean(project.activeTurnId) || deletingId === project.id} onClick={() => void remove(project)}><Trash/></button></div>)}{loading ? <p>正在读取项目…</p> : null}{!loading && !projects.length ? <div className="project-empty"><FilmSlate/><span>还没有视频项目</span></div> : null}</div>
  </aside>;
}
