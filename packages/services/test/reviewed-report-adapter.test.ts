import { describe, expect, it, vi } from "vitest";
import { PublishedThemeSetV2Schema } from "@envoi-labs/contracts";
import { loadQualifiedReport, publishReviewedReport, recordWithheldProposal,
  type ReviewedEvidenceDecision } from "../src/reviewed-report-adapter.js";

const content = PublishedThemeSetV2Schema.parse({ version: 2,
  executiveAnswer: "One soup order", hypotheses: [], themes: [{
    claim: "One diner ordered soup", count: 1, total: 1, confidence: "medium",
    supportingQuotes: [{ studyId: "90600000-0000-4000-8000-000000000001",
      transcriptId: "a9700000-0000-4000-8000-000000000005",
      sourceVersion: "a9700000-0000-4000-8000-000000000010",
      startChar: 4, endChar: 16, exactText: "ordered soup", confidence: 0.9 }], contradictingQuotes: [],
  }] });
const policy = { policyDigest: "a".repeat(64), qualificationDigest: "b".repeat(64) };
const quote = { studyId: "90600000-0000-4000-8000-000000000001",
  transcriptId: "a9700000-0000-4000-8000-000000000005",
  sourceVersion: "a9700000-0000-4000-8000-000000000010",
  startChar: 4, endChar: 16, exactText: "ordered soup" };
const reviews: ReviewedEvidenceDecision[] = [{
  proposalId: "a9700000-0000-4000-8000-000000000033",
  candidate: { ...quote, rationale: "private" }, privateRationale: "private",
  modelName: "synthetic", modelVersion: "v1", promptVersion: "p1",
  actorId: "reviewer", causationId: "a9700000-0000-4000-8000-000000000034",
  findingPosition: 1, action: "accept", approvedQuote: quote,
}];

describe("reviewed report database adapter", () => {
  it("sends qualified content and private decisions through the single transaction, including exact replay", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await publishReviewedReport(db, "report-id", content, ["finding-id"], policy, reviews))
        .toBe(true);
    }
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc.mock.calls[0]).toEqual(db.rpc.mock.calls[1]);
    expect(db.rpc).toHaveBeenCalledWith("publish_gate3_reviewed_report", expect.objectContaining({
      supplied_claims: { "finding-id": "One diner ordered soup" },
      supplied_quotes: { "1": [quote] }, supplied_reviews: reviews,
      supplied_positions: { "finding-id": 1 },
    }));
  });

  it("rejects an incomplete finding map before writing and propagates database errors", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: false, error: null }) };
    expect(await publishReviewedReport(db, "report-id", content, [], policy, reviews)).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await publishReviewedReport(db, "report-id", content, ["finding-id"], policy, reviews))
      .toBe(false);
    db.rpc.mockResolvedValue({ data: null, error: new Error("transaction failed") });
    await expect(publishReviewedReport(db, "report-id", content, ["finding-id"], policy, reviews))
      .rejects.toThrow("transaction failed");
  });

  it("records a withheld proposal without creating a public report", async () => {
    const db = { rpc: vi.fn().mockResolvedValue({ data: true, error: null }) };
    const withheld = { studyId: quote.studyId, reportId: null, proposalId: reviews[0]!.proposalId,
      candidate: reviews[0]!.candidate, modelName: "synthetic", modelVersion: "v1",
      promptVersion: "p1", privateRationale: "private", actorId: "reviewer",
      causationId: reviews[0]!.causationId, reason: "source withdrawn" };
    expect(await recordWithheldProposal(db, withheld)).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("record_gate3_withheld_proposal",
      expect.objectContaining({ supplied_report_id: null, supplied_reason: "source withdrawn" }));
  });

  it("reads the current scoped projection for each report/export request", async () => {
    const reportId = "a9700000-0000-4000-8000-000000000006";
    const payload = { report: { id: reportId, studyId: quote.studyId, summary: content },
      findings: [] };
    const db = { rpc: vi.fn().mockResolvedValueOnce({ data: payload, error: null })
      .mockResolvedValueOnce({ data: null, error: null }) };
    expect(await loadQualifiedReport(db, quote.studyId, reportId)).toEqual(payload);
    expect(await loadQualifiedReport(db, quote.studyId, reportId)).toBeNull();
    expect(db.rpc).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenCalledWith("read_gate3_qualified_report", {
      supplied_study_id: quote.studyId, supplied_report_id: reportId });
  });
});
