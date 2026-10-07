import { expect, it } from "vitest";
import { selectableModels, allowedModelIds, modelAllowed, defaultModelId } from "./models";
import { readModelSelection } from "./storage";

it("offers only GPT-6.1 Sol and GPT-6 models, with a usable offline catalog", () => {
  const result = selectableModels([]);
  expect(result.map(model => model.model)).toEqual(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna"]);
  expect(result.filter(model => model.isDefault).map(model => model.model)).toEqual([defaultModelId]);
  expect(result[0].displayName).toBe("GPT-6.1-Sol");
  expect(result[3].supportedReasoningEfforts.some(option => option.reasoningEffort === "ultra")).toBe(false);
  for (const model of allowedModelIds) expect(modelAllowed(model)).toBe(true);
  for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-6.1-sol "]) expect(modelAllowed(model)).toBe(false);
});

it("preserves provider capabilities while removing retired catalog entries", () => {
  const [fallback] = selectableModels([]);
  const sol = { ...fallback, id: "provider-sol", description: "provider metadata", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "Server setting" }] };
  const result = selectableModels([{ ...fallback, model: "gpt-5.6-sol" }, sol]);
  expect(result[0]).toBe(sol);
  expect(result.map(model => model.model)).toEqual([...allowedModelIds]);
});

it("recovers retired saved selections without replacing supported selections", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const fallback = { model: defaultModelId, reasoningEffort: "high" };
  try {
    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", ...allowedModelIds]) {
      const saved = { model, reasoningEffort: "medium" };
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => JSON.stringify({ version: 1, value: saved }) } });
      expect(readModelSelection(fallback)).toEqual(modelAllowed(model) ? saved : fallback);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
