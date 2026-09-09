import { userStorageKey } from "../session";
import { useEffect, useRef, useState, type SetStateAction } from "react";
import { openDraftDatabase as openDatabase } from "../storage/draftDatabase";
const writes = new Map<string, Promise<void>>();
async function readFiles(key: string, databaseName: string): Promise<File[]> {
  await writes.get(key)?.catch(() => undefined);
  const db = await openDatabase(databaseName);
  return new Promise((resolve, reject) => {
    const request = db.transaction("files").objectStore("files").get(key);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result.filter((file: unknown) => file instanceof File) : []);
    request.onerror = () => reject(request.error);
  });
}
async function storeFiles(key: string, files: File[], databaseName: string) {
  const db = await openDatabase(databaseName);
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("files", "readwrite");
    if (files.length) transaction.objectStore("files").put(files, key); else transaction.objectStore("files").delete(key);
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
  });
}
// Consumers are keyed by project, preventing a file draft from crossing projects.
export function useDraftFiles(key: string) {
  const databaseName = useRef(userStorageKey("yingya-drafts")).current;
  const [files, updateFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const latest = useRef<File[]>([]);
  const revision = useRef(0);
  useEffect(() => {
    let cancelled = false;
    const initialRevision = revision.current;
    void readFiles(key, databaseName).then(restored => { if (!cancelled && revision.current === initialRevision) { latest.current = restored; updateFiles(restored); setStatus("saved"); } }).catch(() => { if (!cancelled) setStatus("error"); });
    return () => { cancelled = true; };
  }, [key, databaseName]);
  function setFiles(action: SetStateAction<File[]>) {
    const next = typeof action === "function" ? action(latest.current) : action;
    latest.current = next; updateFiles(next); setStatus("saving"); const currentRevision = ++revision.current;
    const pending = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => storeFiles(key, next, databaseName));
    writes.set(key, pending);
    void pending.then(() => { if (currentRevision === revision.current) setStatus("saved"); }).catch(() => { if (currentRevision === revision.current) setStatus("error"); }).finally(() => { if (writes.get(key) === pending) writes.delete(key); });
  }
  return [files, setFiles, status] as const;
}
