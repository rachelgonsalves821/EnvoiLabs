import { describe, expect, it } from "vitest";
import { prepareFindings, verifyEvidence } from "../src/report-evidence.js";
import type { ProposedEvidence, RedactedSource } from "../src/report-evidence.js";

const source: RedactedSource = {
  studyId: "11111111-1111-4111-8111-111111111111",
  transcriptId: "22222222-2222-4222-8222-222222222222",
  sourceVersion: "33333333-3333-4333-8333-333333333333",
  redactedText: "I tried the soup 🍲 twice; delivery was slow.", published: true, withdrawn: false,
};
const quote: ProposedEvidence = {
  studyId: source.studyId, transcriptId: source.transcriptId, sourceVersion: source.sourceVersion,
  startChar: 26, endChar: 43, exactText: "delivery was slow", rationale: "Delivery friction",
  confidence: 0.8,
};
const publishClaim = (claim: string) => claim;

describe("IT-3.2 report evidence integrity", () => {
  it("accepts only an exact span of the current published redacted source", () => {
    const decision = verifyEvidence(source.studyId, [quote], [source])[0];
    expect(decision?.action).toBe("accept");
    expect(verifyEvidence(source.studyId, [{ ...quote, exactText: "delivery was fast" }], [source])[0])
      .toMatchObject({ action: "drop", reason: "quote differs from redacted source" });
  });

  it("uses Unicode character offsets rather than UTF-16 code units", () => {
    const emoji = { ...quote, startChar: 17, endChar: 18, exactText: "🍲" };
    expect(verifyEvidence(source.studyId, [emoji], [source])[0]?.action).toBe("accept");
  });

  it("rejects another study, bad offsets, invalid provenance and missing sources", () => {
    const candidates = [
      { ...quote, studyId: "44444444-4444-4444-8444-444444444444" },
      { ...quote, startChar: -1 },
      { ...quote, endChar: 1000 },
      { ...quote, confidence: Number.NaN },
      { ...quote, transcriptId: "55555555-5555-4555-8555-555555555555" },
    ];
    expect(verifyEvidence(source.studyId, candidates, [source]).map((item) => item.action))
      .toEqual(["drop", "drop", "drop", "drop", "drop"]);
    expect(verifyEvidence("44444444-4444-4444-8444-444444444444", [quote], [source])[0]?.action).toBe("drop");
  });

  it("fails closed when an old unversioned quote reference reaches the gate", () => {
    const oldReference = { transcriptId: quote.transcriptId, startChar: quote.startChar, endChar: quote.endChar };
    expect(verifyEvidence(source.studyId, [oldReference as ProposedEvidence], [source])[0]?.action).toBe("drop");
    expect(prepareFindings(source.studyId, [{ claim: "Delivery", supporting: [oldReference as ProposedEvidence],
      contradicting: [] }], [source], publishClaim).findings).toEqual([]);
  });

  it("invalidates report and export findings after re-redaction, withdrawal or deletion", () => {
    const finding = { claim: "Delivery was slow", supporting: [quote], contradicting: [] };
    expect(prepareFindings(source.studyId, [finding], [source], publishClaim).findings).toHaveLength(1);
    for (const changed of [
      { ...source, sourceVersion: "66666666-6666-4666-8666-666666666666" },
      { ...source, withdrawn: true },
      { ...source, published: false },
    ]) {
      expect(prepareFindings(source.studyId, [finding], [changed], publishClaim).findings).toEqual([]);
    }
    expect(prepareFindings(source.studyId, [finding], [], publishClaim).findings).toEqual([]);
  });

  it("drops a fabricated lead quote but retains valid contradictory evidence", () => {
    const result = prepareFindings(source.studyId, [{
      claim: "Delivery was slow", supporting: [quote, { ...quote, exactText: "fabricated" }],
      contradicting: [quote],
    }], [source], publishClaim);
    expect(result.findings[0]?.supporting).toEqual([expect.objectContaining({ exactText: quote.exactText, sourceVersion: quote.sourceVersion })]);
    expect(result.findings[0]?.supporting[0]).not.toHaveProperty("rationale");
    expect(result.findings[0]?.contradicting).toEqual(result.findings[0]?.supporting);
    expect(result.audit.map((event) => event.action)).toEqual(["accept", "drop", "accept"]);
  });

  it("withholds model claims without publication approval and never exposes model rationales", () => {
    const privateName = "Avery Chen";
    const modelClaim = `${privateName} disliked delivery`;
    const privateQuote = { ...quote, rationale: `${privateName} works at Example Market` };
    const proposed = [{ claim: modelClaim, supporting: [privateQuote], contradicting: [] }];
    expect(prepareFindings(source.studyId, proposed, [source]).findings).toEqual([]);
    expect(prepareFindings(source.studyId, proposed, [source], () => null).findings).toEqual([]);
    const result = prepareFindings(source.studyId, proposed, [source], (claim) => claim.replace(privateName, "[PERSON]"));
    expect(result.findings).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(privateName);
    expect(JSON.stringify(result)).not.toContain("Example Market");
    expect(result.findings[0]?.claim).toBe("[PERSON] disliked delivery");
  });
});
