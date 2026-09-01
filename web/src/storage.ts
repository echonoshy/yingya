import { z } from "zod";
import type { ModelSelection } from "./types";

const selectionSchema = z.object({
  version: z.literal(1),
  value: z.object({ model: z.string().min(1), reasoningEffort: z.string().min(1) }),
});
const numberSchema = z.object({ version: z.literal(1), value: z.number().positive() });

export function readModelSelection(fallback: ModelSelection): ModelSelection {
  try {
    const parsed = selectionSchema.safeParse(JSON.parse(localStorage.getItem("yingya-agent-model") ?? "null"));
    return parsed.success ? parsed.data.value : fallback;
  } catch { return fallback; }
}

export function writeModelSelection(value: ModelSelection) {
  try { localStorage.setItem("yingya-agent-model", JSON.stringify({ version: 1, value })); } catch { /* Storage may be unavailable. */ }
}

export function readNumberSetting(key: string, fallback: number) {
  try {
    const parsed = numberSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null"));
    return parsed.success ? parsed.data.value : fallback;
  } catch { return fallback; }
}

export function writeNumberSetting(key: string, value: number) {
  try { localStorage.setItem(key, JSON.stringify({ version: 1, value })); } catch { /* Storage may be unavailable. */ }
}
