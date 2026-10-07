import { useEffect, useRef, useState } from 'react';
import type { UploadOptions, UploadProgress } from '../upload';
import { blockPageUpdate } from '../appUpdate';

export type UploadItem<T = unknown> = { id: string; name: string; size?: number; status: 'queued' | 'uploading' | 'processing' | 'complete' | 'error'; progress?: number; error?: string; result?: T };
export type UploadJob<T> = { id: string; name: string; size?: number; run: (options: UploadOptions) => Promise<T> };
export type UploadQueue<T> = ReturnType<typeof useUploadQueue<T>>;

export function useUploadQueue<T>() {
  const [items, setItems] = useState<UploadItem<T>[]>([]);
  const jobs = useRef(new Map<string, UploadJob<T>>());
  const results = useRef(new Map<string, T>());
  const pending = useRef(new Map<string, Promise<T>>());
  const controllers = useRef(new Map<string, AbortController>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controllers.current.forEach(controller => controller.abort()); }; }, []);
  const active = items.some(item => ['queued', 'uploading', 'processing'].includes(item.status));
  useEffect(() => {
    if (!active) return;
    const release = blockPageUpdate('素材仍在上传或保存，请完成后再刷新。');
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => { release(); window.removeEventListener('beforeunload', prevent); };
  }, [active]);
  function update(id: string, patch: Partial<UploadItem<T>>) {
    if (mounted.current) setItems(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }
  async function execute(job: UploadJob<T>): Promise<T> {
    if (results.current.has(job.id)) return results.current.get(job.id)!;
    const inflight = pending.current.get(job.id); if (inflight) return inflight;
    const controller = new AbortController(); controllers.current.set(job.id, controller);
    update(job.id, { status: 'uploading', progress: undefined, error: undefined });
    const onProgress = (value: UploadProgress) => update(job.id, { status: value.phase, progress: value.total ? Math.min(100, Math.floor(value.loaded / value.total * 100)) : undefined });
    const promise = Promise.resolve().then(() => job.run({ signal: controller.signal, onProgress })).then(result => {
      results.current.set(job.id, result); update(job.id, { status: 'complete', progress: 100, result }); return result;
    }).catch(error => { update(job.id, { status: 'error', error: error instanceof Error ? error.message : '上传失败，请重试' }); throw error; })
      .finally(() => { pending.current.delete(job.id); controllers.current.delete(job.id); });
    pending.current.set(job.id, promise); return promise;
  }
  async function run(batch: UploadJob<T>[]): Promise<T[]> {
    batch.forEach(job => jobs.current.set(job.id, job));
    setItems(current => {
      const next = [...current];
      for (const job of batch) {
        const index = next.findIndex(item => item.id === job.id);
        if (index < 0) next.push({ id: job.id, name: job.name, size: job.size, status: results.current.has(job.id) ? 'complete' : 'queued', result: results.current.get(job.id) });
      }
      return next;
    });
    // Bound concurrent transfers while allowing independent files to complete after a failure.
    let cursor = 0; const settled: PromiseSettledResult<T>[] = new Array(batch.length);
    await Promise.all(Array.from({ length: Math.min(3, batch.length) }, async () => {
      while (cursor < batch.length && mounted.current) {
        const index = cursor++;
        try { settled[index] = { status: 'fulfilled', value: await execute(batch[index]) }; }
        catch (reason) { settled[index] = { status: 'rejected', reason }; }
      }
    }));
    if (!mounted.current) throw new DOMException('上传已取消', 'AbortError');
    const failed = settled.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return settled.map(result => (result as PromiseFulfilledResult<T>).value);
  }
  function retry(id: string) { const job = jobs.current.get(id); if (job) void execute(job).catch(() => undefined); }
  function clearCompleted() {
    setItems(current => current.filter(item => item.status !== 'complete'));
    // Keep successful results until unmount to prevent duplicate uploads on submission retry.
    for (const id of results.current.keys()) jobs.current.delete(id);
  }
  return { items, active, run, retry, clearCompleted };
}
