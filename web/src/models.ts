import type { CodexModel } from "./types";

const astra: CodexModel = {
  id: "gpt-6-astra",
  model: "gpt-6-astra",
  displayName: "GPT-6 Astra",
  description: "复杂创作与深度推理",
  hidden: false,
  supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map(reasoningEffort => ({ reasoningEffort, description: "" })),
  defaultReasoningEffort: "medium",
  isDefault: false,
};

export function includeAstra(models: CodexModel[]): CodexModel[] {
  // Older Codex catalogs may omit Astra. Prefer server metadata when available.
  return models.some(model => model.model === astra.model) ? models : [...models, astra];
}

/** Pin Astra in menus while keeping the catalog's defaults and relative order intact. */
export function prioritizeAstra(models: CodexModel[]): CodexModel[] {
  const index = models.findIndex(model => model.model === astra.model);
  if (index <= 0) return models;
  return [models[index], ...models.slice(0, index), ...models.slice(index + 1)];
}
