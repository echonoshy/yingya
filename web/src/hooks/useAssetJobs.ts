import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { ImageJob, VoiceJob } from "../schemas";

function useJobList<T extends { id: string; status: string; updatedAt: number }>(fetchJobs: (signal: AbortSignal) => Promise<T[]>, onCompleted?: () => void) {
  const [jobs, setJobs] = useState<T[]>([]);
  const latest = useRef(jobs), completed = useRef(onCompleted);
  completed.current = onCompleted;
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const mutation = useRef(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const accept = useCallback((job: T) => {
    mutation.current++;
    latest.current = [job, ...latest.current.filter(item => item.id !== job.id)];
    setJobs(latest.current); refresh();
    if (job.status === "completed") completed.current?.();
  }, [refresh]);
  const forget = useCallback((ids: string[]) => {
    mutation.current++;
    latest.current = latest.current.filter(job => !ids.includes(job.id));
    setJobs(latest.current); refresh();
  }, [refresh]);
  useEffect(() => {
    let disposed = false, fetching = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      if (disposed || fetching) return;
      fetching = true; clearTimeout(timer);
      const startedAt = mutation.current;
      try {
        const next = await fetchJobs(controller.signal);
        // Discard responses begun before a local creation/deletion. Fresh lists are
        // authoritative, including records cleared from another browser session.
        if (disposed || startedAt !== mutation.current) return;
        const merged = next.map(job => {
          const old = latest.current.find(item => item.id === job.id);
          return old && old.updatedAt > job.updatedAt ? old : job;
        });
        const changed = merged.some(job => job.status === "completed" && !latest.current.some(old => old.id === job.id && old.status === "completed"));
        latest.current = merged; setJobs(merged); setError("");
        if (changed) completed.current?.();
      } catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : "任务记录暂时无法读取"); }
      finally { fetching = false; if (!disposed) { setLoading(false); timer = setTimeout(() => void poll(), latest.current.some(job => job.status === "running") ? 1500 : 5000); } }
    }
    const focus = () => { if (!document.hidden) void poll(); };
    void poll(); window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, [fetchJobs, revision]);
  return { jobs, loading, error, refresh, accept, forget };
}
export type JobList<T> = { jobs: T[]; loading: boolean; error: string; refresh: () => void; accept: (job: T) => void; forget: (ids: string[]) => void };
export function useAssetJobs(onImagesCompleted: () => void) {
  const images = useJobList<ImageJob>(api.listImageJobs, onImagesCompleted);
  const voices = useJobList<VoiceJob>(api.listVoiceJobs);
  return { images, voices };
}
