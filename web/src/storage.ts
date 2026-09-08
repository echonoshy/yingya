import { userStorageKey } from "./session";
import { z } from "zod";
import type { ModelSelection } from "./types";

const selectionSchema = z.object({
  version: z.literal(1),
  value: z.object({ model: z.string().min(1), reasoningEffort: z.string().min(1) }),
});
const numberSchema = z.object({ version: z.literal(1), value: z.number().positive() });
const stringSchema = z.object({ version: z.literal(1), value: z.string().min(1) });

export function readModelSelection(fallback: ModelSelection): ModelSelection {
  try {
    const parsed = selectionSchema.safeParse(JSON.parse(localStorage.getItem(userStorageKey("yingya-agent-model")) ?? "null"));
    return parsed.success ? parsed.data.value : fallback;
  } catch { return fallback; }
}

export function writeModelSelection(value: ModelSelection) {
  try { localStorage.setItem(userStorageKey("yingya-agent-model"), JSON.stringify({ version: 1, value })); } catch { /* Storage may be unavailable. */ }
}

export function readNumberSetting(key: string, fallback: number) {
  try {
    const parsed = numberSchema.safeParse(JSON.parse(localStorage.getItem(userStorageKey(key)) ?? "null"));
    return parsed.success ? parsed.data.value : fallback;
  } catch { return fallback; }
}

export function writeNumberSetting(key: string, value: number) {
  try { localStorage.setItem(userStorageKey(key), JSON.stringify({ version: 1, value })); } catch { /* Storage may be unavailable. */ }
}

export function readStringSetting(key: string, fallback: string) {
  try {
    const parsed = stringSchema.safeParse(JSON.parse(localStorage.getItem(userStorageKey(key)) ?? "null"));
    return parsed.success ? parsed.data.value : fallback;
  } catch { return fallback; }
}

export function writeStringSetting(key: string, value: string) {
  try { localStorage.setItem(userStorageKey(key), JSON.stringify({ version: 1, value })); } catch { /* Storage may be unavailable. */ }
}
