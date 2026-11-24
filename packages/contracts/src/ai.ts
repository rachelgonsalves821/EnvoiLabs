import { z } from "zod";
import { count, exampleId, score, text as nonBlank, withExample } from "./contract.js";
import { BriefPatchSchema, BriefSchema, exampleBrief } from "./study.js";

const exampleQuote = { transcriptId: exampleId, startChar: 4, endChar: 28 };
const exampleTheme = {
  claim: "Fees matter more for small orders.", count: 8, total: 12, confidence: "high" as const,
  supportingQuotes: [exampleQuote], contradictingQuotes: [],
};

export const ScopingTurnSchema = withExample(z.strictObject({
  message: nonBlank,
  quickReplies: z.array(nonBlank).min(2).max(4),
  briefPatch: BriefPatchSchema,
}), { message: "What decision are you trying to make?", quickReplies: ["Pricing", "Something else"], briefPatch: {} });

export const ProbeDecisionSchema = withExample(z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("probe"), text: nonBlank }),
  z.strictObject({ action: z.literal("next") }),
]), { action: "probe", text: "What made you pick that app?" });

export const QualitySignalsSchema = withExample(z.strictObject({
  specificity: score,
  relevance: score,
  profileConsistent: z.boolean().nullable(),
}), { specificity: 90, relevance: 75, profileConsistent: null });

export const EvidenceQuoteReferenceSchema = withExample(z.strictObject({
  transcriptId: z.uuid(),
  startChar: count,
  endChar: z.int().positive(),
}).refine(({ startChar, endChar }) => endChar > startChar, {
  path: ["endChar"],
  message: "The end offset must follow the start offset.",
}), exampleQuote);

// Offsets count Unicode code points in the exact qualified redacted source,
// starting at zero. PostgreSQL substr(text, startChar + 1, length) uses the
// corresponding one-based character position.
const evidenceQuoteV2Fields = {
  studyId: z.uuid(),
  transcriptId: z.uuid(),
  sourceVersion: z.uuid(),
  startChar: count,
  endChar: z.int().positive(),
  exactText: nonBlank,
  confidence: z.number().min(0).max(1),
};
export const EvidenceQuoteCandidateV2Schema = withExample(z.strictObject({
  ...evidenceQuoteV2Fields, rationale: nonBlank,
}).refine(({ startChar, endChar }) => endChar > startChar, {
  path: ["endChar"], message: "The end offset must follow the start offset.",
}), { studyId: exampleId, transcriptId: exampleId, sourceVersion: exampleId,
  startChar: 0, endChar: 7, exactText: "ordered", rationale: "Describes a past order.", confidence: 0.9 });

// Only this shape may leave the private evidence gate. Model rationale is not
// exposed through researcher report or export contracts.
export const VerifiedEvidenceQuoteV2Schema = withExample(z.strictObject(evidenceQuoteV2Fields)
  .refine(({ startChar, endChar }) => endChar > startChar, {
    path: ["endChar"], message: "The end offset must follow the start offset.",
  }), { studyId: exampleId, transcriptId: exampleId, sourceVersion: exampleId,
  startChar: 0, endChar: 7, exactText: "ordered", confidence: 0.9 });

export const ThemeSchema = withExample(z.strictObject({
  claim: nonBlank,
  count: z.int().positive(),
  total: z.int().positive(),
  confidence: z.enum(["high", "medium", "low"]),
  supportingQuotes: z.array(EvidenceQuoteReferenceSchema).min(1).max(10),
  contradictingQuotes: z.array(EvidenceQuoteReferenceSchema),
}).refine(({ count, total }) => count <= total, {
  path: ["count"],
  message: "The theme count cannot exceed the total.",
}), exampleTheme);

export const ThemeSetSchema = withExample(z.strictObject({
  executiveAnswer: nonBlank,
  themes: z.array(ThemeSchema),
  hypotheses: z.array(z.strictObject({
    hypothesis: nonBlank,
    result: z.enum(["supported", "weakened", "untested"]),
  })),
  followUpBrief: BriefSchema,
}), { executiveAnswer: "Test a lower fee.", themes: [exampleTheme],
  hypotheses: [{ hypothesis: "Fees matter more for small orders.", result: "supported" }],
  followUpBrief: exampleBrief });

const hypothesisFields = {
  hypothesis: nonBlank,
  result: z.enum(["supported", "weakened", "untested"]),
};
const themeV2Fields = {
  claim: nonBlank,
  count: z.int().positive(),
  total: z.int().positive(),
  confidence: z.enum(["high", "medium", "low"]),
};
const validThemeCount = ({ count: themeCount, total }: { count: number; total: number }) =>
  themeCount <= total;
const exampleVerifiedQuote = { studyId: exampleId, transcriptId: exampleId,
  sourceVersion: exampleId, startChar: 0, endChar: 7, exactText: "ordered", confidence: 0.9 };
const exampleCandidateQuote = { ...exampleVerifiedQuote, rationale: "Describes a past order." };

export const AnalystThemeV2Schema = withExample(z.strictObject({
  ...themeV2Fields,
  supportingQuotes: z.array(EvidenceQuoteCandidateV2Schema).min(1).max(10),
  contradictingQuotes: z.array(EvidenceQuoteCandidateV2Schema),
}).refine(validThemeCount, { path: ["count"], message: "The theme count cannot exceed the total." }),
{ ...exampleTheme, supportingQuotes: [exampleCandidateQuote], contradictingQuotes: [] });

// Private model output: the follow-up brief and quote rationale need review.
export const AnalystThemeSetV2Schema = withExample(z.strictObject({
  executiveAnswer: nonBlank,
  themes: z.array(AnalystThemeV2Schema),
  hypotheses: z.array(z.strictObject(hypothesisFields)),
  followUpBrief: BriefSchema,
}), { executiveAnswer: "Test a lower fee.", themes: [{ ...exampleTheme,
  supportingQuotes: [exampleCandidateQuote], contradictingQuotes: [] }],
  hypotheses: [{ hypothesis: "Fees matter more for small orders.", result: "supported" as const }],
  followUpBrief: exampleBrief });

export const PublishedThemeV2Schema = withExample(z.strictObject({
  ...themeV2Fields,
  supportingQuotes: z.array(VerifiedEvidenceQuoteV2Schema).min(1).max(10),
  contradictingQuotes: z.array(VerifiedEvidenceQuoteV2Schema),
}).refine(validThemeCount, { path: ["count"], message: "The theme count cannot exceed the total." }),
{ ...exampleTheme, supportingQuotes: [exampleVerifiedQuote], contradictingQuotes: [] });

// The trusted qualified publisher must check every free-text field and quote
// before constructing this public shape. Parsing alone cannot publish it.
export const PublishedThemeSetV2Schema = withExample(z.strictObject({
  executiveAnswer: nonBlank,
  themes: z.array(PublishedThemeV2Schema),
  hypotheses: z.array(z.strictObject(hypothesisFields)),
}), { executiveAnswer: "Test a lower fee.", themes: [{ ...exampleTheme,
  supportingQuotes: [exampleVerifiedQuote], contradictingQuotes: [] }],
  hypotheses: [{ hypothesis: "Fees matter more for small orders.", result: "supported" as const }] });

export type ScopingTurn = z.infer<typeof ScopingTurnSchema>;
export type ProbeDecision = z.infer<typeof ProbeDecisionSchema>;
export type QualitySignals = z.infer<typeof QualitySignalsSchema>;
export type EvidenceQuoteReference = z.infer<typeof EvidenceQuoteReferenceSchema>;
export type EvidenceQuoteCandidateV2 = z.infer<typeof EvidenceQuoteCandidateV2Schema>;
export type VerifiedEvidenceQuoteV2 = z.infer<typeof VerifiedEvidenceQuoteV2Schema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type ThemeSet = z.infer<typeof ThemeSetSchema>;
export type AnalystThemeV2 = z.infer<typeof AnalystThemeV2Schema>;
export type AnalystThemeSetV2 = z.infer<typeof AnalystThemeSetV2Schema>;
export type PublishedThemeV2 = z.infer<typeof PublishedThemeV2Schema>;
export type PublishedThemeSetV2 = z.infer<typeof PublishedThemeSetV2Schema>;
