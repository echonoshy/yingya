import { describe, expect, it } from "vitest";
import { presentationSchema } from "./presentation";
import { requirementsSchema } from "./schemas";

describe("project presentation requirements", () => {
  it("accepts old projects and rejects mismatched or unknown options", () => {
    expect(requirementsSchema.parse({}).presentation).toBeUndefined();
    expect(presentationSchema.safeParse({ capabilityId: "model-stage", variant: "branch" }).success).toBe(false);
    expect(presentationSchema.safeParse({ capabilityId: "other", variant: "orbit" }).success).toBe(false);
  });
});
