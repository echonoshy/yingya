import { z } from "zod";

// Stable keys are persisted with the project; display labels can evolve separately.
export const presentationSchema = z.discriminatedUnion("capabilityId", [
  z.object({ capabilityId: z.literal("model-stage"), variant: z.enum(["turntable", "orbit", "still"]) }),
  z.object({ capabilityId: z.literal("flow-path"), variant: z.enum(["three-steps", "four-steps", "five-steps"]) }),
  z.object({ capabilityId: z.literal("infographic"), variant: z.enum(["structure", "hierarchy", "comparison"]) }),
  z.object({ capabilityId: z.literal("title-reveal"), variant: z.enum(["opening", "chapter", "closing"]) }),
  z.object({ capabilityId: z.literal("number-compare"), variant: z.enum(["before-after", "metrics", "change"]) }),
  z.object({ capabilityId: z.literal("beam-network"), variant: z.enum(["converge", "branch", "system"]) }),
]);
export type PresentationChoice = z.infer<typeof presentationSchema>;
