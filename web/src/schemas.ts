import { z } from "zod";

const optionalString = z.string().nullish().transform(value => value ?? undefined);

export const reasoningEffortOptionSchema = z.object({ reasoningEffort: z.string(), description: z.string() });
export const codexModelSchema = z.object({
  id: z.string(), model: z.string(), displayName: z.string(), description: z.string(), hidden: z.boolean(),
  supportedReasoningEfforts: z.array(reasoningEffortOptionSchema), defaultReasoningEffort: z.string(), isDefault: z.boolean(),
});
export const projectRecordSchema = z.object({
  id: z.string(), title: z.string(), status: z.string(), statusLabel: z.string(), threadId: optionalString, activeTurnId: optionalString,
  queueDepth: z.number(), queuePaused: z.boolean().default(false), model: z.string(), reasoningEffort: z.string(), aspectRatio: z.string(), voiceId: z.string().default("default"), createdAt: z.number(), updatedAt: z.number(),
});
export const agentMessageSchema = z.object({
  id: z.string(), turnId: optionalString, role: z.enum(["user", "assistant"]), text: z.string(), attachments: z.array(z.string()), context: z.array(z.string()), status: z.string(), createdAt: z.number(),
});
export const queuedTurnSchema = z.object({ id: z.string(), text: z.string(), attachments: z.array(z.string()), context: z.array(z.string()), model: optionalString, reasoningEffort: optionalString, createdAt: z.number() });
export const agentEventSchema = z.object({ seq: z.number(), projectId: z.string(), turnId: optionalString, method: z.string(), payload: z.unknown(), createdAt: z.number() });
export const checkpointSchema = z.object({ id: z.string(), kind: z.string(), title: z.string(), summary: z.string(), artifactIds: z.array(z.string()) });
export const artifactSchema = z.object({
  id: z.string(), kind: z.string(), label: z.string(), path: z.string(), version: optionalString,
  metadata: z.record(z.string(), z.unknown()).nullable().default({}).transform(value => value ?? {}),
});
export const draftVersionSchema = z.object({ id: z.string(), label: z.string(), sourcePath: z.string(), videoPath: z.string(), reportPath: optionalString, createdAt: z.number() });
export const renderJobSchema = z.object({
  id: z.string(), versionId: z.string(), status: z.enum(["queued", "running", "completed", "failed", "interrupted"]),
  quality: z.string(), resolution: z.string(), fps: z.union([z.literal(30), z.literal(60)]), progress: z.number(), message: z.string(),
  outputPath: optionalString, error: optionalString, startedAt: z.number(), updatedAt: z.number(), endedAt: z.number().optional(),
});
export const agentManifestSchema = z.object({
  schemaVersion: z.number(), phase: z.string(), dirty: z.boolean(), checkpoint: checkpointSchema.nullish().transform(value => value ?? undefined),
  outputSpec: z.record(z.string(), z.unknown()), artifacts: z.array(artifactSchema), versions: z.array(draftVersionSchema), currentDraft: optionalString, studioEntry: z.string(),
});
export const projectDetailSchema = projectRecordSchema.extend({ manifest: agentManifestSchema, messages: z.array(agentMessageSchema), queue: z.array(queuedTurnSchema), eventCursor: z.number(), renderJobs: z.array(renderJobSchema).default([]) });
export const turnAcceptedSchema = z.object({ turnId: z.string(), status: z.string(), queueDepth: z.number() });
export const renderVideoResultSchema = z.object({ jobId: z.string(), status: z.literal("rendering"), resolution: z.string(), fps: z.union([z.literal(30), z.literal(60)]) });
export const eventPageSchema = z.object({ items: z.array(agentEventSchema), nextBefore: z.number().optional(), latestSeq: z.number(), hasMore: z.boolean() });
export const uploadedVoiceSchema = z.object({
  name: z.string(), consent: z.string().default(""), created_at: z.number().default(0), file_size: z.number().default(0), mime_type: z.string().default(""),
  ref_text: optionalString, speaker_description: optionalString,
});
export const voiceListSchema = z.object({ voices: z.array(z.string()), uploaded_voices: z.array(uploadedVoiceSchema) });
export const imageLibraryAssetSchema = z.object({
  id: z.string(), url: z.string(), hyperframesPath: z.string(), mimeType: z.string(), prompt: optionalString,
  sourceName: optionalString, kind: z.enum(["generated", "uploaded"]), createdAt: z.number(),
});
export const imageLibrarySchema = z.object({ images: z.array(imageLibraryAssetSchema) });
export const imageTurnSchema = z.object({
  threadId: z.string(), turnId: z.string(), status: z.string(), text: z.string(),
  images: z.array(z.object({ id: z.string(), url: z.string(), hyperframesPath: z.string(), mimeType: z.string(), revisedPrompt: optionalString })),
});

export type CodexModel = z.infer<typeof codexModelSchema>;
export type ProjectRecord = z.infer<typeof projectRecordSchema>;
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export type QueuedTurn = z.infer<typeof queuedTurnSchema>;
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type Checkpoint = z.infer<typeof checkpointSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type DraftVersion = z.infer<typeof draftVersionSchema>;
export type RenderJob = z.infer<typeof renderJobSchema>;
export type AgentManifest = z.infer<typeof agentManifestSchema>;
export type ProjectDetail = z.infer<typeof projectDetailSchema>;
export type TurnAccepted = z.infer<typeof turnAcceptedSchema>;
export type AgentEventPage = z.infer<typeof eventPageSchema>;
export type UploadedVoice = z.infer<typeof uploadedVoiceSchema>;
export type VoiceList = z.infer<typeof voiceListSchema>;
export type ImageLibraryAsset = z.infer<typeof imageLibraryAssetSchema>;
