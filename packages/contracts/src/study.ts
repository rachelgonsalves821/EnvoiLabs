import { z } from "zod";

const text = z.string().trim().min(1);

export const CriterionSchema = z.strictObject({
  kind: z.enum(["must", "nice", "exclude"]),
  text,
});

export const BriefSchema = z.strictObject({
  title: text,
  decision: text,
  hypotheses: z.array(text).min(1),
  criteria: z.array(CriterionSchema),
  targetCompletes: z.int().positive(),
  stimulus: text.nullable(),
  deadlineAt: z.iso.datetime(),
});

export const BriefPatchSchema = BriefSchema.partial();

export const GuideDraftSchema = z.strictObject({
  coreQuestions: z.array(text).min(6).max(8),
});

export type Criterion = z.infer<typeof CriterionSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type BriefPatch = z.infer<typeof BriefPatchSchema>;
export type GuideDraft = z.infer<typeof GuideDraftSchema>;
