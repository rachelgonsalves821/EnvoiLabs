import { z } from "zod";
import { exampleDate, text, withExample } from "./contract.js";

const exampleCriterion = { kind: "must" as const, text: "Ordered delivery in the last 30 days" };

export const CriterionSchema = withExample(z.strictObject({
  kind: z.enum(["must", "nice", "exclude"]),
  text,
}), exampleCriterion);

export const exampleBrief = {
  title: "Late-night delivery",
  decision: "Which delivery fees should we test?",
  hypotheses: ["Fees matter more for small orders."],
  criteria: [exampleCriterion],
  targetCompletes: 12,
  stimulus: null,
  deadlineAt: exampleDate,
};

export const BriefSchema = withExample(z.strictObject({
  title: text,
  decision: text,
  hypotheses: z.array(text).min(1),
  criteria: z.array(CriterionSchema),
  targetCompletes: z.int().positive(),
  stimulus: text.nullable(),
  deadlineAt: z.iso.datetime(),
}), exampleBrief);

export const BriefPatchSchema = withExample(BriefSchema.partial(), { targetCompletes: 20 });

export const GuideDraftSchema = withExample(z.strictObject({
  coreQuestions: z.array(text).min(6).max(8),
}), { coreQuestions: [
  "When did you last order?", "What did you order?", "Where did you order from?",
  "How much did delivery cost?", "How did you choose?", "What would you do next time?",
] });

export type Criterion = z.infer<typeof CriterionSchema>;
export type Brief = z.infer<typeof BriefSchema>;
export type BriefPatch = z.infer<typeof BriefPatchSchema>;
export type GuideDraft = z.infer<typeof GuideDraftSchema>;
