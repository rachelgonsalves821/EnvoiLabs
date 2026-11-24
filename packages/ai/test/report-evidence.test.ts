import { describe, expect, it } from "vitest";
import { prepareFindings, verifyEvidence } from "../src/report-evidence.js";
import type { ProposedEvidence, RedactedSource } from "../src/report-evidence.js";

const source: RedactedSource = {
  studyId: "study-a", transcriptId: "transcript-a", version: "redaction-v1:answer-2",
  redactedText: "I tried the soup 🍲 twice; delivery was slow.", published: true, withdrawn: false,
};
const quote: ProposedEvidence = {
  studyId: source.studyId, transcriptId: source.transcriptId, sourceVersion: source.version,
  startChar: 26, endChar: 43, quote: "delivery was slow", rationale: "Delivery friction",
  confidence: 0.8,
};
const publishClaim = (claim: string) => claim;

describe("IT-3.2 report evidence integrity", () => {
  it("accepts only an exact span of the current published redacted source", () => {
    const decision = verifyEvidence(source.studyId, [quote], [source])[0];
    expect(decision?.action).toBe("accept");
    expect(verifyEvidence(source.studyId, [{ ...quote, quote: "delivery was fast" }], [source])[0])
      .toMatchObject({ action: "drop", reason: "quote differs from redacted source" });
  });

  it("uses Unicode character offsets rather than UTF-16 code units", () => {
    const emoji = { ...quote, startChar: 17, endChar: 18, quote: "🍲" };
    expect(verifyEvidence(source.studyId, [emoji], [source])[0]?.action).toBe("accept");
  });

  it("rejects another study, bad offsets, invalid provenance and missing sources", () => {
    const candidates = [
      { ...quote, studyId: "study-b" },
      { ...quote, startChar: -1 },
      { ...quote, endChar: 1000 },
      { ...quote, confidence: Number.NaN },
      { ...quote, transcriptId: "unknown" },
    ];
    expect(verifyEvidence(source.studyId, candidates, [source]).map((item) => item.action))
      .toEqual(["drop", "drop", "drop", "drop", "drop"]);
    expect(verifyEvidence("study-b", [quote], [source])[0]?.action).toBe("drop");
  });

  it("invalidates report and export findings after re-redaction, withdrawal or deletion", () => {
    const finding = { claim: "Delivery was slow", supporting: [quote], contradicting: [] };
    expect(prepareFindings(source.studyId, [finding], [source], publishClaim).findings).toHaveLength(1);
    for (const changed of [
      { ...source, version: "redaction-v2:answer-2" },
      { ...source, withdrawn: true },
      { ...source, published: false },
    ]) {
      expect(prepareFindings(source.studyId, [finding], [changed], publishClaim).findings).toEqual([]);
    }
    expect(prepareFindings(source.studyId, [finding], [], publishClaim).findings).toEqual([]);
  });

  it("drops a fabricated lead quote but retains valid contradictory evidence", () => {
    const result = prepareFindings(source.studyId, [{
      claim: "Delivery was slow", supporting: [quote, { ...quote, quote: "fabricated" }],
      contradicting: [quote],
    }], [source], publishClaim);
    expect(result.findings[0]?.supporting).toEqual([expect.objectContaining({ quote: quote.quote, sourceVersion: quote.sourceVersion })]);
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
