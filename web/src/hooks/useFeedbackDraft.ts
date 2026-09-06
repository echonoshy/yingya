import { useEffect, useRef, useState } from "react";
import type { FeedbackAsset, VisualFeedback } from "../types";
import { openDraftDatabase } from "../storage/draftDatabase";
import { visualFeedbackSchema } from "../schemas";

export type FeedbackDraft = Omit<VisualFeedback, "screenshotAssetId" | "screenshotPath" | "screenshotSha256"> & { blob: Blob; asset?: FeedbackAsset };
const writes = new Map<string, Promise<void>>();

export function useFeedbackDraft(projectId: string) {
  const [items, setItems] = useState<FeedbackDraft[]>([]);
  const [status, setStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const latest = useRef(items);
  const revision = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const initial = revision.current;
    void (async () => {
      await writes.get(projectId)?.catch(() => undefined);
      const db = await openDraftDatabase();
      const stored = await new Promise<unknown>((resolve, reject) => {
        const request = db.transaction("feedback").objectStore("feedback").get(projectId);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const restored = Array.isArray(stored) ? stored.filter((v: FeedbackDraft) => v?.blob instanceof Blob && visualFeedbackSchema.omit({ screenshotAssetId: true, screenshotPath: true, screenshotSha256: true }).safeParse(v).success) : [];
      if (!cancelled && initial === revision.current) { latest.current = restored; setItems(restored); setStatus("saved"); }
    })().catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [projectId]);
  function update(change: (current: FeedbackDraft[]) => FeedbackDraft[]) {
    const next = change(latest.current); latest.current = next; setItems(next); setStatus("saving");
    const current = ++revision.current;
    const pending = (writes.get(projectId) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const db = await openDraftDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("feedback", "readwrite");
        if (next.length) tx.objectStore("feedback").put(next, projectId); else tx.objectStore("feedback").delete(projectId);
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
      });
    });
    writes.set(projectId, pending);
    void pending.then(() => { if (revision.current === current) setStatus("saved"); }).catch(() => { if (revision.current === current) setStatus("error"); }).finally(() => { if (writes.get(projectId) === pending) writes.delete(projectId); });
  }
  return { items, status, update };
}
