import { z } from "zod";
import { BriefPatchSchema, BriefSchema } from "./study.js";

const nonBlank = z.string().trim().min(1);
const score = z.int().min(0).max(100);
const count = z.int().nonnegative();

export const ScopingTurnSchema = z.strictObject({
  message: nonBlank,
  quickReplies: z.array(nonBlank).min(2).max(4),
  briefPatch: BriefPatchSchema,
});

export const ProbeDecisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("probe"), text: nonBlank }),
  z.strictObject({ action: z.literal("next") }),
]);

export const QualitySignalsSchema = z.strictObject({
  specificity: score,
  relevance: score,
  profileConsistent: z.boolean().nullable(),
});

export const EvidenceQuoteReferenceSchema = z.strictObject({
  transcriptId: z.uuid(),
  startChar: count,
  endChar: z.int().positive(),
}).refine(({ startChar, endChar }) => endChar > startChar, {
  path: ["endChar"],
  message: "The end offset must follow the start offset.",
});

export const ThemeSchema = z.strictObject({
  claim: nonBlank,
  count: z.int().positive(),
  total: z.int().positive(),
  confidence: z.enum(["high", "medium", "low"]),
  supportingQuotes: z.array(EvidenceQuoteReferenceSchema).min(1).max(10),
  contradictingQuotes: z.array(EvidenceQuoteReferenceSchema),
}).refine(({ count, total }) => count <= total, {
  path: ["count"],
  message: "The theme count cannot exceed the total.",
});

export const ThemeSetSchema = z.strictObject({
  executiveAnswer: nonBlank,
  themes: z.array(ThemeSchema),
  hypotheses: z.array(z.strictObject({
    hypothesis: nonBlank,
    result: z.enum(["supported", "weakened", "untested"]),
  })),
  followUpBrief: BriefSchema,
});

export type ScopingTurn = z.infer<typeof ScopingTurnSchema>;
export type ProbeDecision = z.infer<typeof ProbeDecisionSchema>;
export type QualitySignals = z.infer<typeof QualitySignalsSchema>;
export type EvidenceQuoteReference = z.infer<typeof EvidenceQuoteReferenceSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type ThemeSet = z.infer<typeof ThemeSetSchema>;
