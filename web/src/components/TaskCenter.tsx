import { useMotionPresence } from "../hooks/useMotionPresence";
import { Bell, ListChecks, Eye, Check, CircleNotch, Warning, X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import type { ProjectRecord } from "../types";
import { projectGroup, projectStatus } from "../projectState";

export function TaskCenter({ projects, offline, onOpen }: { projects: ProjectRecord[]; offline: boolean; onOpen: (id: string) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const close = () => { setOpen(false); trigger.current?.focus(); };
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
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const pending = projects.filter(project => ["active", "review", "failed"].includes(projectGroup(project)));
  return <aside ref={root} aria-label="任务中心" className="task-center" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button ref={trigger} type="button" className="task-center-trigger" aria-label="任务中心" title="任务中心" aria-expanded={open} aria-describedby={updates.length ? `${panelId}-updates` : undefined} aria-controls={presence.value ? panelId : undefined} onClick={() => setOpen(value => !value)}><Bell aria-hidden="true"/>{updates.length ? <span className="task-center-unread" aria-hidden="true"/> : null}</button>
    <span id={`${panelId}-updates`} className="sr-only" role="status">{updates[0] ? `${updates.length} 条未读更新。${updates[0].title}：${projectStatus(updates[0])}` : ""}</span>
    {presence.value ? <section id={panelId} ref={presence.ref} inert={presence.exiting} aria-hidden={presence.exiting || undefined} className="task-center-panel" aria-label="项目任务"><header><b>项目任务</b><button aria-label="关闭任务中心" onClick={close}><X/></button></header>{offline ? <p role="status">连接已中断，正在等待同步</p> : null}{updates.length ? <><div className="task-section-heading">最近更新<button onClick={() => setUpdates([])}>标记已读</button></div>{updates.map(project => <button className="task-row" key={project.id} onClick={() => { setOpen(false); setUpdates(current => current.filter(item => item.id !== project.id)); onOpen(project.id); }}>{projectGroup(project) === "completed" ? <Check/> : ["review", "ready"].includes(projectGroup(project)) ? <Eye/> : <Warning/>}<span><b>{project.title}</b><small>{projectStatus(project)}</small></span></button>)}</> : null}<div className="task-section-heading">进行中与待处理 · {pending.length}</div>{pending.map(project => <button className="task-row" key={project.id} onClick={() => { setOpen(false); onOpen(project.id); }}>{projectGroup(project) === "active" ? <CircleNotch/> : ["review", "ready"].includes(projectGroup(project)) ? <Eye/> : <Warning/>}<span><b>{project.title}</b><small>{projectStatus(project)}</small></span></button>)}{!pending.length ? <div className="task-center-empty"><ListChecks aria-hidden="true"/><p>当前没有待处理任务</p><small>创作进度与待确认内容会显示在这里。</small></div> : null}</section> : null}
  </aside>;
}
