export type {
  AgentEvent, AgentEventPage, AgentManifest, AgentMessage, Artifact, Checkpoint,
  CodexModel, DraftVersion, ProjectDetail, ProjectRecord, QueuedTurn, TurnAccepted,
} from "./schemas";

export interface ModelSelection { model: string; reasoningEffort: string }
export interface ReasoningEffortOption { reasoningEffort: string; description: string }
export interface CreateProjectInput extends ModelSelection { title?: string; prompt: string; aspectRatio: string }
export interface TurnInput extends Partial<ModelSelection> { text: string; attachments?: string[]; context?: string[]; interrupt?: boolean }
