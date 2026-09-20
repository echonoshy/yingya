import { openDraftDatabase } from "../storage/draftDatabase";
import { userStorageKey } from "../session";
import type { CapturedFrame } from "./captureFrame";
import type { FeedbackRegion } from "../types";
import type { FeedbackDraft } from "../hooks/useFeedbackDraft";

export type AnnotationDraft = {
  frame: CapturedFrame; versionId: string; versionLabel: string; videoPath: string;
  region: FeedbackRegion | null; note: string; initial?: FeedbackDraft; draftId?: string;
};
const writes = new Map<string, Promise<void>>();
const keyFor = (projectId: string) => userStorageKey(`annotation:${projectId}`);

export async function readAnnotationDraft(projectId: string): Promise<AnnotationDraft | null> {
  const key = keyFor(projectId);
  await writes.get(key)?.catch(() => undefined);
  const db = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("feedback").objectStore("feedback").get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const v = request.result as AnnotationDraft | undefined;
      resolve(v?.frame?.blob instanceof Blob && Number.isFinite(v.frame.time)
        && typeof v.videoPath === "string" && typeof v.versionId === "string" ? v : null);
    };
  });
}

export function saveAnnotationDraft(projectId: string, value: AnnotationDraft | null): Promise<void> {
  const key = keyFor(projectId);
  const db = openDraftDatabase();
  const pending = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const database = await db;
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("feedback", "readwrite");
      if (value) tx.objectStore("feedback").put(value, key);
      else tx.objectStore("feedback").delete(key);
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
    });
  });
  writes.set(key, pending);
  void pending.finally(() => { if (writes.get(key) === pending) writes.delete(key); }).catch(() => undefined);
  return pending;
}
