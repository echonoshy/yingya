import { describe, expect, it } from "vitest";
import { includeAstra } from "./models";

describe("includeAstra", () => {
  it("adds Astra to an older catalog without changing existing defaults", () => {
    const [astra] = includeAstra([]);
    const terra = { ...astra, id: "gpt-5.6-terra", model: "gpt-5.6-terra", isDefault: true };
    const models = includeAstra([terra]);
    expect(models.map(model => model.model)).toEqual(["gpt-5.6-terra", "gpt-6-astra"]);
    expect(models[0]).toBe(terra);
    expect(models[1].isDefault).toBe(false);
    expect(models[1].supportedReasoningEfforts.map(option => option.reasoningEffort)).toEqual(["low", "medium", "high", "xhigh", "max", "ultra"]);
  });

  it("preserves server-provided Astra metadata without duplicating it", () => {
    const [astra] = includeAstra([]);
    const models = [{ ...astra, id: "server-astra", defaultReasoningEffort: "high", supportedReasoningEfforts: [{ reasoningEffort: "high", description: "Server setting" }] }];
    expect(includeAstra(models)).toBe(models);
  });
});
