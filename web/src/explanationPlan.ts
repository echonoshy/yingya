import { z } from 'zod';
const sectionSchema = z.object({ id: z.string(), title: z.string(), summary: z.string(), expression: z.string(), keyframe: z.object({ status: z.enum(['pending','ready','failed']), path: z.string().optional(), sourcePath: z.string().optional(), timeSeconds: z.number().nonnegative().optional(), message: z.string().optional() }).optional() });
export const explanationPlanSchema = z.object({ checkpointId: z.string().nullable(), revision: z.string(), ready: z.boolean(), markdown: z.string(), document: z.object({ title: z.string(), audience: z.string(), question: z.string(), takeaway: z.string(), narration: z.string(), aspectRatio: z.string(), durationSeconds: z.number().positive(), sections: z.array(sectionSchema), materials: z.array(z.string()).default([]), missingMaterials: z.array(z.string()).default([]) }).nullable() });
export type PlanReceipt = { checkpointId: string; revision: string };
export type ExplanationPlan = z.infer<typeof explanationPlanSchema>;
