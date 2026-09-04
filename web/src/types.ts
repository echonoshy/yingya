export type {
  AgentEvent, AgentEventPage, AgentManifest, AgentMessage, Artifact, Checkpoint,
  AgentMedia, CodexModel, DraftVersion, ImageLibraryAsset, MediaAsset, MediaScene, ProjectDetail, ProjectRecord, QueuedTurn, RenderJob, TurnAccepted, UploadedVoice, VoiceList,
} from "./schemas";

export interface ModelSelection { model: string; reasoningEffort: string }
export interface ReasoningEffortOption { reasoningEffort: string; description: string }
export interface CreateProjectInput extends ModelSelection { title?: string; prompt: string; aspectRatio: string; voiceId: string }
export interface TurnInput extends Partial<ModelSelection> { text: string; attachments?: string[]; context?: string[]; interrupt?: boolean }
