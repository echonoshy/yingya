import { z } from "zod";
import { createClientRequestId } from "./requestId";

const attemptSchema = z.object({
  version: z.literal(1), signature: z.string(), creationRequestId: z.string().uuid(), turnRequestId: z.string().uuid(),
  projectId: z.string().optional(), uploadedPaths: z.record(z.string(), z.string()),
  turnInput: z.object({ text: z.string(), clientRequestId: z.string(), attachments: z.array(z.string()), model: z.string(), reasoningEffort: z.string() }).optional(),
  accepted: z.boolean(),
});
export type CreationAttempt = z.infer<typeof attemptSchema>;
export function readCreationAttempt(key: string): CreationAttempt | null {
  try { const result = attemptSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? "null")); return result.success ? result.data : null; }
  catch { return null; }
}
export function newCreationAttempt(signature: string): CreationAttempt {
  return { version: 1, signature, creationRequestId: createClientRequestId(), turnRequestId: createClientRequestId(), uploadedPaths: {}, accepted: false };
}
export function saveCreationAttempt(key: string, attempt: CreationAttempt | null) {
  try { localStorage.setItem(key, JSON.stringify(attempt)); }
  catch { throw new Error("无法保存提交进度，请允许浏览器存储后重试。"); }
}
