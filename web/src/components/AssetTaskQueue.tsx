import { useRef, useState } from "react";
import { ArrowClockwise, CheckCircle, CircleNotch, Clock, Image as ImageIcon, SpeakerHigh, Trash, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import type { UploadItem, UploadQueue } from "../hooks/useUploadQueue";
import type { AssetLibraryItem, ImageJob, VoiceJob } from "../schemas";
import { SelectControl } from "./SelectControl";
import "./asset-task-queue.css";

type State = "active" | "completed" | "failed";
type Task = { id: string; name: string; createdAt: number; state: State } & ({ kind: "upload"; item: UploadItem<AssetLibraryItem> } | { kind: "image"; job: ImageJob } | { kind: "voice"; job: VoiceJob });
const states = [{ id: "all", label: "全部状态" }, { id: "active", label: "进行中" }, { id: "completed", label: "已完成" }, { id: "failed", label: "失败" }] as const;
const kinds = [{ id: "all", label: "全部任务" }, { id: "upload", label: "上传" }, { id: "image", label: "图片" }, { id: "voice", label: "音色" }] as const;
function labelFor(task: Task) {
  if (task.kind !== "upload") return task.state === "active" ? "生成中" : task.state === "completed" ? "已完成" : "生成失败";
  const item = task.item;
  return item.status === "queued" ? "等待上传" : item.status === "processing" ? "正在保存" : item.status === "complete" ? "已完成" : item.status === "error" ? "上传失败" : item.progress === undefined ? "正在上传" : `上传中 ${item.progress}%`;
}
export function AssetTaskQueue({ uploads, jobs, voiceJobs, loading, loadError, onRefresh, onDelete, onSelect, onAsset }: {
  uploads: UploadQueue<AssetLibraryItem>; jobs: ImageJob[]; voiceJobs: VoiceJob[]; loading: boolean; loadError: string; onRefresh: () => void;
  onDelete: (kind: "image" | "voice", id?: string) => Promise<number>;
  onSelect: (kind: "image" | "voice", id: string) => void; onAsset: (asset: AssetLibraryItem) => void;
}) {
  const [kind, setKind] = useState("all"), [state, setState] = useState("all");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(""), [error, setError] = useState("");
  const inFlight = useRef(false), clearRef = useRef<HTMLButtonElement>(null);
  async function clean(task?: Task) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice(""); setError("");
    let removed = 0;
    try {
      if (task) {
        if (task.state === "active") return;
        if (task.kind === "upload") { uploads.remove(task.item.id); removed = 1; }
        else removed = await onDelete(task.kind, task.job.id);
      } else {
        if (kind === "all" || kind === "upload") { removed += uploads.items.filter(item => item.status === "complete").length; uploads.clearCompleted(); }
        const results = await Promise.allSettled((["image", "voice"] as const).filter(source => (kind === "all" || kind === source) && tasks.some(item => item.kind === source && item.state === "completed")).map(source => onDelete(source)));
        for (const result of results) if (result.status === "fulfilled") removed += result.value;
        const failed = results.find(result => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      }
      setNotice(`已清理 ${removed} 条记录，素材和音色已保留。`);
      // Deleting a row removes its focused control; keep keyboard users in the toolbar.
      clearRef.current?.focus();
    } catch (reason) { setError(`${removed ? `已清理 ${removed} 条记录；` : ""}${reason instanceof Error ? reason.message : "记录清理失败，请重试。"}`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const tasks: Task[] = [
    ...uploads.items.map((item): Task => ({ id: `upload:${item.id}`, kind: "upload", name: item.name, createdAt: item.createdAt ?? 0, state: item.status === "complete" ? "completed" : item.status === "error" ? "failed" : "active", item })),
    ...jobs.map((job): Task => ({ id: `image:${job.id}`, kind: "image", name: job.prompt, createdAt: job.createdAt, state: job.status === "running" ? "active" : job.status, job })),
    ...voiceJobs.map((job): Task => ({ id: `voice:${job.id}`, kind: "voice", name: job.name, createdAt: job.createdAt, state: job.status === "running" ? "active" : job.status, job })),
  ].sort((a, b) => Number(b.state === "active") - Number(a.state === "active") || b.createdAt - a.createdAt);
  const byKind = tasks.filter(task => kind === "all" || task.kind === kind), visible = byKind.filter(task => state === "all" || task.state === state);
  const completedCount = byKind.filter(task => task.state === "completed").length;
  return <section className="asset-task-queue" aria-label="素材任务记录">
    <div className="asset-task-filters"><nav aria-label="任务来源">{kinds.map(item => <button type="button" key={item.id} aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>{item.label}<small>{tasks.filter(task => item.id === "all" || task.kind === item.id).length}</small></button>)}</nav><SelectControl aria-label="任务状态" value={state} onChange={e => setState(e.target.value)}>{states.map(item => <option key={item.id} value={item.id}>{item.label} · {byKind.filter(task => item.id === "all" || task.state === item.id).length}</option>)}</SelectControl><button ref={clearRef} className="task-clear" type="button" aria-disabled={busy || !completedCount} title="清理当前分类的已完成记录，保留素材和音色" onClick={() => { if (!busy && completedCount) void clean(); }}>{busy ? "正在清理…" : "清理已完成"}</button><button className="task-refresh" aria-label="刷新任务记录" onClick={onRefresh}><ArrowClockwise/></button></div>
    {loadError ? <p className="asset-task-error" role="alert">部分生成记录暂时无法更新，已有记录已保留。<button type="button" onClick={onRefresh}>重新读取</button></p> : null}
    {error ? <p className="asset-task-error" role="alert">{error}</p> : null}
    {notice ? <p className="asset-task-notice" role="status">{notice}</p> : null}
    <ul className="asset-task-list">{visible.map(task => {
      const StatusIcon = task.state === "completed" ? CheckCircle : task.state === "failed" ? WarningCircle : task.kind === "upload" && task.item.status === "queued" ? Clock : CircleNotch;
      return <li key={task.id} data-kind={task.kind} data-state={task.state}>
        <span className={`asset-task-state asset-task-state--${task.state}`}><StatusIcon aria-hidden="true" className={StatusIcon === CircleNotch ? "spin" : undefined}/>{labelFor(task)}</span>
        <div className="asset-task-copy"><span className="asset-task-name" title={task.name}>{task.name}</span><small>{task.kind === "upload" ? <><UploadSimple/>上传 · {task.item.destination ?? "未整理"}</> : task.kind === "image" ? <><ImageIcon/>生成图片</> : <><SpeakerHigh/>{task.job.mode === "design" ? "描述生成音色" : "克隆音色"}</>}</small>
          {task.kind === "upload" && task.state === "active" ? <progress aria-label={`上传 ${task.name}`} max={100} value={task.item.status === "queued" ? 0 : task.item.status === "processing" ? undefined : task.item.progress}/> : null}
          {task.kind === "upload" && task.item.error ? <p className="asset-task-failure">{task.item.error}</p> : null}
        </div>
        <time dateTime={new Date(task.createdAt).toISOString()}>{new Date(task.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
        <div className="asset-task-actions">{task.kind !== "upload" ? <button className="asset-task-action" type="button" aria-label={`查看生成记录 ${task.name}`} onClick={() => onSelect(task.kind, task.job.id)}>查看详情</button> : task.state === "failed" ? <button className="asset-task-action" type="button" aria-label={`重试上传 ${task.name}`} disabled={busy} onClick={() => uploads.retry(task.item.id)}><ArrowClockwise/>重试</button> : task.item.result ? <button className="asset-task-action" onClick={() => onAsset(task.item.result!)}>查看素材</button> : null}
        {task.state !== "active" ? <button className="task-delete" type="button" disabled={busy} title="删除记录，保留素材和音色" aria-label={`删除记录 ${task.name}`} onClick={() => void clean(task)}><Trash/></button> : null}</div>
      </li>;
    })}</ul>
    {!visible.length ? <p className="asset-task-empty">{loading && kind !== "upload" ? "正在读取生成记录…" : loadError && kind !== "upload" ? "生成记录暂时无法读取，请重试。" : tasks.length ? "没有符合条件的任务" : "还没有任务，上传文件或生成素材后可在这里查看进度。"}</p> : null}
    <footer>清理记录不删除素材或音色。上传期间请保持页面打开。</footer>
  </section>;
}
