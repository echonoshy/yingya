import { useMotionPresence } from "../hooks/useMotionPresence";
import { Bell, Eye, Check, CircleNotch, Warning, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ProjectRecord } from "../types";
import { projectGroup, projectStatus } from "../projectState";

export function TaskCenter({ projects, offline, onOpen }: { projects: ProjectRecord[]; offline: boolean; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const presence = useMotionPresence(open ? "open" : null);
  const [updates, setUpdates] = useState<ProjectRecord[]>([]);
  const previous = useRef(new Map<string, string>());
  useEffect(() => {
    const changed = projects.filter(project => {
      const before = previous.current.get(project.id);
      return before !== undefined && before !== `${projectGroup(project)}:${projectStatus(project)}` && projectGroup(project) !== "active";
    });
    previous.current = new Map(projects.map(project => [project.id, `${projectGroup(project)}:${projectStatus(project)}`]));
    if (changed.length) setUpdates(current => [...changed, ...current.filter(item => !changed.some(next => next.id === item.id))].slice(0, 20));
  }, [projects]);
  const pending = projects.filter(project => ["active", "review", "failed"].includes(projectGroup(project)));
  return <aside aria-label="任务中心" className="task-center" onKeyDown={event => { if (event.key === "Escape") { setOpen(false); event.currentTarget.querySelector<HTMLButtonElement>(".task-center-trigger")?.focus(); } }}>
    <button className="task-center-trigger" aria-label="任务中心" aria-expanded={open} onClick={() => setOpen(value => !value)}><Bell/><span>任务</span>{updates.length ? <b>{updates.length}</b> : null}</button>
    <span className="sr-only" role="status">{updates[0] ? `${updates[0].title}：${projectStatus(updates[0])}` : ""}</span>
    {presence.value ? <section ref={presence.ref} inert={presence.exiting} aria-hidden={presence.exiting || undefined} className="task-center-panel" aria-label="项目任务"><header><b>项目任务</b><button aria-label="关闭任务中心" onClick={() => setOpen(false)}><X/></button></header>{offline ? <p role="status">连接已中断，正在等待同步。</p> : null}{updates.length ? <><div className="task-section-heading">最近更新<button onClick={() => setUpdates([])}>标记已读</button></div>{updates.map(project => <button className="task-row" key={project.id} onClick={() => { setOpen(false); setUpdates(current => current.filter(item => item.id !== project.id)); onOpen(project.id); }}>{projectGroup(project) === "completed" ? <Check/> : ["review", "ready"].includes(projectGroup(project)) ? <Eye/> : <Warning/>}<span><b>{project.title}</b><small>{projectStatus(project)}</small></span></button>)}</> : null}<div className="task-section-heading">进行中与待处理 · {pending.length}</div>{pending.map(project => <button className="task-row" key={project.id} onClick={() => { setOpen(false); onOpen(project.id); }}>{projectGroup(project) === "active" ? <CircleNotch/> : ["review", "ready"].includes(projectGroup(project)) ? <Eye/> : <Warning/>}<span><b>{project.title}</b><small>{projectStatus(project)}</small></span></button>)}{!pending.length ? <p>当前没有待处理任务。</p> : null}</section> : null}
  </aside>;
}
