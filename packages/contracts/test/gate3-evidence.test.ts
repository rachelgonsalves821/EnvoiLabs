import { describe, expect, it } from "vitest";
import { AnalystThemeSetV2Schema, EvidenceQuoteCandidateV2Schema,
  PublishedThemeSetV2Schema, ThemeSetSchema, VerifiedEvidenceQuoteV2Schema } from "../src/index.js";

const id = "11111111-1111-4111-8111-111111111111";
const candidate = { studyId: id, transcriptId: id, sourceVersion: id,
  startChar: 1, endChar: 6, exactText: "ordered", rationale: "Past behavior", confidence: 0.9 };
const firstExample = (schema: { meta(): Record<string, unknown> | undefined }) =>
  (schema.meta()?.examples as unknown[] | undefined)?.[0];

describe("Gate 3 evidence contracts", () => {
  it("requires an immutable source version, exact text and private provenance", () => {
    expect(EvidenceQuoteCandidateV2Schema.parse(candidate)).toEqual(candidate);
    expect(EvidenceQuoteCandidateV2Schema.safeParse({ ...candidate, sourceVersion: "latest" }).success).toBe(false);
    expect(EvidenceQuoteCandidateV2Schema.safeParse({ ...candidate, endChar: 1 }).success).toBe(false);
    expect(EvidenceQuoteCandidateV2Schema.safeParse({ ...candidate, confidence: 1.1 }).success).toBe(false);
  });

  it("keeps model rationale out of the researcher evidence shape", () => {
    expect(VerifiedEvidenceQuoteV2Schema.safeParse(candidate).success).toBe(false);
    const verified = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "rationale"));
    expect(VerifiedEvidenceQuoteV2Schema.parse(verified)).toEqual(verified);
  });

  it("preserves v1 while requiring V2 provenance in private analyst output", () => {
    const v1 = firstExample(ThemeSetSchema);
    expect(ThemeSetSchema.safeParse(v1).success).toBe(true);
    expect(AnalystThemeSetV2Schema.safeParse(v1).success).toBe(false);
    expect(AnalystThemeSetV2Schema.safeParse(firstExample(AnalystThemeSetV2Schema)).success).toBe(true);
  });

  it("accepts Unicode codepoint offsets but rejects private fields in publication", () => {
    const quote = { ...candidate, startChar: 2, endChar: 3, exactText: "😀" };
    const verified = Object.fromEntries(Object.entries(quote).filter(([key]) => key !== "rationale"));
    const privateTheme = { claim: "A respondent used emoji.", count: 1, total: 1,
      confidence: "high" as const, supportingQuotes: [quote], contradictingQuotes: [] };
    const published = { executiveAnswer: "An emoji appeared.", themes: [{ ...privateTheme,
      supportingQuotes: [verified] }],
    hypotheses: [{ hypothesis: "Emoji matter.", result: "untested" as const }] };
    expect(AnalystThemeSetV2Schema.safeParse({ ...published, themes: [privateTheme],
      followUpBrief: (firstExample(AnalystThemeSetV2Schema) as { followUpBrief: unknown }).followUpBrief
    }).success).toBe(true);
    expect(PublishedThemeSetV2Schema.safeParse(published).success).toBe(true);
    expect(PublishedThemeSetV2Schema.safeParse({ ...published, themes: [{ ...privateTheme,
      supportingQuotes: [{ ...verified, rationale: "private" }] }] }).success).toBe(false);
    expect(PublishedThemeSetV2Schema.safeParse({ ...published, followUpBrief: {} }).success).toBe(false);
  });
});
