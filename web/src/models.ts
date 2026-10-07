import type { CodexModel } from "./types";

export const defaultModelId = "gpt-6.1-sol";
export const allowedModelIds = [defaultModelId, "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"] as const;
export const modelAllowed = (model: string) => allowedModelIds.some(id => id === model);

// Fallback metadata mirrors the installed Codex catalog; prefer provider metadata.
const fallbackModels: CodexModel[] = [
  [defaultModelId, "GPT-6.1-Sol", "复杂创作与高质量推理", "low"],
  ["gpt-6-astra", "GPT-6-Astra", "复杂创作与深度推理", "medium"],
  ["gpt-6-sol", "GPT-6-Sol", "均衡的质量与速度", "medium"],
  ["gpt-6-luna", "GPT-6-Luna", "快速迭代", "medium"],
].map(([model, displayName, description, defaultReasoningEffort]) => ({
  id: model, model, displayName, description, defaultReasoningEffort,
  hidden: false,
  isDefault: model === defaultModelId,
  supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", ...(model === "gpt-6-luna" ? [] : ["ultra"])]
    .map(reasoningEffort => ({ reasoningEffort, description: "" })),
}));

export function selectableModels(models: CodexModel[]): CodexModel[] {
  return fallbackModels.map(fallback => models.find(model => model.model === fallback.model) ?? fallback);
}
