import { describe, expect, it, vi } from "vitest";
import { publishReviewedFromQualified, type QuoteIdentity, type ReviewedDecision,
  type ReportSnapshot } from "../src/reviewed-report-bridge.js";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reportId = id(1);
const studyId = id(2);
const policy = { policyDigest: "a".repeat(64), qualificationDigest: "b".repeat(64) };
const quote = (n: number): QuoteIdentity => ({ studyId, transcriptId: id(10 + n),
  sourceVersion: id(20 + n), startChar: 0, endChar: 7, exactText: `quote ${n}` });
const q1 = quote(1);
const q2 = quote(2);
const content = { version: 2, executiveAnswer: "Qualified answer", hypotheses: [], themes: [
  { claim: "Qualified claim one", supportingQuotes: [q1], contradictingQuotes: [] },
  { claim: "Qualified claim two", supportingQuotes: [q2], contradictingQuotes: [] },
] };
const quoteMap = { "1": [q1], "2": [q2] };
const snapshot: ReportSnapshot = { reportId, studyId, findings: [
  { id: id(102), position: 2 }, { id: id(101), position: 1 },
] };
const review = (n: number, approvedQuote: QuoteIdentity, action: "accept" | "edit" = "accept"):
  ReviewedDecision => ({ proposalId: id(200 + n), causationId: id(300 + n),
    candidate: { ...approvedQuote, rationale: `private reason ${n}` },
    privateRationale: `private reason ${n}`, modelName: "fictional",
    modelVersion: "v1", promptVersion: "p1", actorId: "fictional reviewer",
    findingPosition: n, action, approvedQuote,
    ...(action === "edit" ? { editedQuoteText: approvedQuote.exactText } : {}),
  });
const reviews: ReviewedDecision[] = [review(1, q1), review(2, q2, "edit"), {
  ...review(3, quote(3)), findingPosition: 2, action: "drop", approvedQuote: null,
}];

function setup(current: ReportSnapshot | null = snapshot) {
  return { loadReport: vi.fn().mockResolvedValue(current),
    publishReviewedReport: vi.fn().mockResolvedValue(true) };
}

describe("PR #138 reviewed report bridge", () => {
  it("binds qualified themes to current positional finding IDs and private decisions", async () => {
    const ports = setup();
    expect(await publishReviewedFromQualified(ports, reportId, content, quoteMap, policy, reviews))
      .toBe(true);
    expect(ports.publishReviewedReport).toHaveBeenCalledWith(reportId, content,
      [id(101), id(102)], policy, reviews);
    expect(JSON.stringify(content)).not.toContain("private reason");
  });

  it("withholds mismatched or untrusted report/finding position maps", async () => {
    for (const current of [null, { ...snapshot, reportId: id(999) },
      { ...snapshot, findings: [{ id: id(101), position: 1 }, { id: id(102), position: 3 }] },
      { ...snapshot, findings: [{ id: id(101), position: 1 }, { id: id(101), position: 2 }] }]) {
      const ports = setup(current);
      expect(await publishReviewedFromQualified(ports, reportId, content, quoteMap, policy, reviews))
        .toBe(false);
      expect(ports.publishReviewedReport).not.toHaveBeenCalled();
    }
  });

  it("rejects swapped, extra, cross-study or private public quote membership", async () => {
    const cases = [
      { map: { "1": [q2], "2": [q1] }, result: content },
      { map: { "1": [q1, q1], "2": [q2] }, result: content },
      { map: { "1": [{ ...q1, rationale: "private" }], "2": [q2] }, result: content },
      { map: { "1": [q1], "unexpected": [q2] }, result: content },
      { map: quoteMap, result: { ...content, themes: [{ ...content.themes[0]!,
        supportingQuotes: [{ ...q1, studyId: id(999) }] }, content.themes[1]!] } },
      { map: quoteMap, result: { ...content, themes: [{ ...content.themes[0]!,
        supportingQuotes: [{ ...q1, rationale: "private" }] }, content.themes[1]!] } },
      { map: quoteMap, result: { ...content, themes: [{ ...content.themes[0]!,
        supportingQuotes: [{ ...q1, exactText: "a longer invented quote" }] }, content.themes[1]!] } },
    ];
    for (const item of cases) {
      const ports = setup();
      expect(await publishReviewedFromQualified(ports, reportId, item.result, item.map,
        policy, reviews)).toBe(false);
      expect(ports.publishReviewedReport).not.toHaveBeenCalled();
    }
  });

  it("rejects missing, replayed or unqualified private decisions", async () => {
    const cases: readonly ReviewedDecision[][] = [
      reviews.slice(1),
      [reviews[0]!, { ...reviews[1]!, proposalId: reviews[0]!.proposalId }],
      [reviews[0]!, { ...reviews[1]!, causationId: reviews[0]!.causationId }],
      [{ ...reviews[0]!, privateRationale: "different" }, reviews[1]!],
      [{ ...reviews[0]!, approvedQuote: q2 }, reviews[1]!],
      [{ ...reviews[0]!, approvedQuote: { ...q1, rationale: "private" } }, reviews[1]!],
      [{ ...reviews[0]!, candidate: { ...q1, studyId: id(999), rationale: "private reason 1" } },
        reviews[1]!],
      [reviews[0]!, { ...reviews[1]!, editedQuoteText: "unverified edit" }],
    ];
    for (const entries of cases) {
      const ports = setup();
      expect(await publishReviewedFromQualified(ports, reportId, content, quoteMap,
        policy, entries)).toBe(false);
      expect(ports.publishReviewedReport).not.toHaveBeenCalled();
    }
  });
});
