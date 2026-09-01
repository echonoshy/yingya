export interface ModelSelection { model: string; reasoningEffort: string }
export interface ReasoningEffortOption { reasoningEffort: string; description: string }
export interface CodexModel { id: string; model: string; displayName: string; description: string; hidden: boolean; supportedReasoningEfforts: ReasoningEffortOption[]; defaultReasoningEffort: string; isDefault: boolean }
export interface ProjectRecord { id: string; title: string; status: string; statusLabel: string; threadId?: string; activeTurnId?: string; queueDepth: number; model: string; reasoningEffort: string; aspectRatio: string; createdAt: number; updatedAt: number }
export interface AgentMessage { id: string; role: "user" | "assistant"; text: string; attachments: string[]; context: string[]; status: string; createdAt: number }
export interface QueuedTurn { id: string; text: string; attachments: string[]; context: string[]; model?: string; reasoningEffort?: string; createdAt: number }
export interface AgentEvent { seq: number; projectId: string; turnId?: string; method: string; payload: unknown; createdAt: number }
export interface Checkpoint { id: string; kind: "plan" | "draft" | string; title: string; summary: string; artifactIds: string[] }
export interface Artifact { id: string; kind: string; label: string; path: string; version?: string; metadata: Record<string, unknown> }
export interface DraftVersion { id: string; label: string; sourcePath: string; videoPath: string; reportPath?: string; createdAt: number }
export interface AgentManifest { schemaVersion: number; phase: string; dirty: boolean; checkpoint?: Checkpoint; outputSpec: Record<string, unknown>; artifacts: Artifact[]; versions: DraftVersion[]; currentDraft?: string; studioEntry: string }
export interface ProjectDetail extends ProjectRecord { manifest: AgentManifest; messages: AgentMessage[]; queue: QueuedTurn[]; events: AgentEvent[] }
export interface CreateProjectInput extends ModelSelection { title?: string; prompt: string; aspectRatio: string }
export interface TurnInput extends Partial<ModelSelection> { text: string; attachments?: string[]; context?: string[]; interrupt?: boolean }
export interface TurnAccepted { turnId: string; status: string; queueDepth: number }
