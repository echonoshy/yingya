import { describe, expect, it } from "vitest";
import { includeAstra, prioritizeAstra, selectableModels, allowedModelIds, modelAllowed } from "./models";

it('limits the product catalog to four exact IDs, preserving provider metadata', () => {
  const [astra]=includeAstra([]);
  const catalog=[{...astra,id:'older',model:'gpt-5.5'},{...astra,description:'provider metadata'}];
  const result=selectableModels(catalog);
  expect(result.map(model=>model.model)).toEqual([...allowedModelIds]);
  expect(result[0].description).toBe('provider metadata');
  expect(modelAllowed('gpt-5.5-sol')).toBe(false);
  expect(selectableModels([])).toHaveLength(4);
});

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


describe("prioritizeAstra", () => {
  it("pins the server entry without changing other order, metadata or defaults", () => {
    const [astra] = includeAstra([]);
    const terra = { ...astra, model: "gpt-5.6-terra", isDefault: true };
    const sol = { ...astra, model: "gpt-5.6-sol" };
    const catalog = [terra, astra, sol];
    expect(prioritizeAstra(catalog)).toEqual([astra, terra, sol]);
    expect(catalog).toEqual([terra, astra, sol]);
    expect(prioritizeAstra(catalog)[0]).toBe(astra);
    expect(prioritizeAstra(catalog)[1].isDefault).toBe(true);
    expect(prioritizeAstra([terra, sol])).toEqual([terra, sol]);
  });
});
