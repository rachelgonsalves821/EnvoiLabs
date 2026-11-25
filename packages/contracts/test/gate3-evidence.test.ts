import { describe, expect, it } from "vitest";
import { EvidenceQuoteCandidateV2Schema, VerifiedEvidenceQuoteV2Schema } from "../src/index.js";

const id = "11111111-1111-4111-8111-111111111111";
const candidate = { studyId: id, transcriptId: id, sourceVersion: id,
  startChar: 1, endChar: 6, exactText: "ordered", rationale: "Past behavior", confidence: 0.9 };

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
});
