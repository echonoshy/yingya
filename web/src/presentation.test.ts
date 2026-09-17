import { describe, expect, it } from "vitest";
import { presentationSchema } from "./presentation";
import { capabilities, variantKeys, presentationLabel } from "./capabilities";
import { requirementsSchema } from "./schemas";

describe("project presentation requirements", () => {
  it("keeps every selectable variant in project requirements with a readable label", () => {
    for (const capability of capabilities) for (const variant of variantKeys[capability.id]) {
      const choice = presentationSchema.parse({ capabilityId: capability.id, variant });
      expect(requirementsSchema.parse({ presentation: choice }).presentation).toEqual(choice);
      expect(presentationLabel(choice)).toContain(capability.name);
      expect(presentationLabel(choice)).not.toContain("undefined");
    }
  });
  it("accepts old projects and rejects mismatched or unknown options", () => {
    expect(requirementsSchema.parse({}).presentation).toBeUndefined();
    expect(presentationSchema.safeParse({ capabilityId: "model-stage", variant: "branch" }).success).toBe(false);
    expect(presentationSchema.safeParse({ capabilityId: "other", variant: "orbit" }).success).toBe(false);
  });
});
