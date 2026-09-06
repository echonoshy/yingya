import { z } from "zod";
import { createClientRequestId } from "../requestId";
import { readStringSetting, writeStringSetting } from "../storage";
import { visualFeedbackSchema } from "../schemas";
import type { TurnInput } from "../types";

const inputSchema = z.object({ text: z.string(), clientRequestId: z.string().uuid(), attachments: z.array(z.string()).optional(), context: z.array(z.string()).optional(), interrupt: z.boolean().optional(), model: z.string().optional(), reasoningEffort: z.string().optional(), feedback: z.array(visualFeedbackSchema).optional() });
const attemptSchema = z.object({ signature: z.string(), id: z.string().uuid(), input: inputSchema.optional() });
export type SubmissionAttempt = { signature: string; id: string; input?: TurnInput };
export function submissionAttempt(projectId: string, signature: string): SubmissionAttempt {
  try {
    const parsed = attemptSchema.safeParse(JSON.parse(readStringSetting(`yingya-submission:${projectId}`, "null")));
    if (parsed.success && parsed.data.signature === signature) return parsed.data;
  } catch { /* Invalid local state starts a new submission. */ }
  const attempt = { signature, id: createClientRequestId() };
  saveSubmission(projectId, attempt);
  return attempt;
}
export function saveSubmission(projectId: string, attempt: SubmissionAttempt | null) {
  writeStringSetting(`yingya-submission:${projectId}`, JSON.stringify(attempt));
}
