export type {
  AssetRole, CreationRequirements, SourceBinding, Workbench, EditorialRecipe, VisualFeedback, FeedbackRegion, FeedbackAsset, AgentEvent, AgentEventPage, AgentManifest, AgentMessage, Artifact, Checkpoint,
  AgentMedia, AssetFolder, AssetLibraryItem, CodexModel, DraftVersion, ImageLibraryAsset, MediaAsset, MediaScene, ProjectDetail, ProjectRecord, QueuedTurn, RenderJob, TurnAccepted, UploadedVoice, VoiceList,
} from "./schemas";

export interface ModelSelection { model: string; reasoningEffort: string }
export interface ReasoningEffortOption { reasoningEffort: string; description: string }
export interface CreateProjectInput extends ModelSelection { title?: string; prompt: string; clientRequestId?: string; aspectRatio: string; voiceId: string; requirements?: import("./schemas").CreationRequirements }
export interface TurnInput extends Partial<ModelSelection> { text: string; baseVersionId?: string | null; clientRequestId?: string; attachments?: string[]; context?: string[]; interrupt?: boolean; feedback?: import("./schemas").VisualFeedback[] }
