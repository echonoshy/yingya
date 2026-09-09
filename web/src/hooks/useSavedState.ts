import { userStorageKey } from "../session";
import { useCallback, useRef, useState, type SetStateAction } from "react";
import { z } from "zod";

export function readDraft<T>(key: string, schema: z.ZodType<T>, fallback: T): T {
  try { const result = schema.safeParse(JSON.parse(localStorage.getItem(userStorageKey(key)) ?? "null")); return result.success ? result.data : fallback; }
  catch { return fallback; }
}

// Persist synchronously in the input event, before navigation can unmount the form.
export function useSavedState<T>(key: string, schema: z.ZodType<T>, fallback: T) {
  const storageScope = useRef(userStorageKey("")).current;
  const storageKey = storageScope + key;
  const [snapshot, setSnapshot] = useState(() => ({ key, value: readDraft(key, schema, fallback) }));
  const [saved, setSaved] = useState(true);
  const latest = useRef(snapshot);
  if (latest.current.key !== key) latest.current = { key, value: readDraft(key, schema, fallback) };
  const value = snapshot.key === key ? snapshot.value : latest.current.value;
  const setValue = useCallback((action: SetStateAction<T>) => {
    const previous = latest.current.key === key ? latest.current.value : readDraft(key, schema, fallback);
    const next = typeof action === "function" ? (action as (value: T) => T)(previous) : action;
    latest.current = { key, value: next };
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setSaved(true); }
    catch { setSaved(false); }
    setSnapshot(latest.current);
  }, [key, schema, fallback, storageKey]);
  return [value, setValue, saved] as const;
}
