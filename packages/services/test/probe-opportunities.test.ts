import { describe, expect, it, vi } from "vitest";
import { loadProbeOpportunitySnapshot } from "../src/probe-opportunities.js";

const studyId = "90600000-0000-4000-8000-000000000001";
const item = {
  answerId: "a9700000-0000-4000-8000-000000000004",
  sessionId: "a9700000-0000-4000-8000-000000000003",
  questionId: "a9700000-0000-4000-8000-000000000001",
  questionPosition: 1, isFollowup: false, consentReceipt: "a".repeat(64),
  serverUploadConfirmedAt: "2026-11-27T12:00:00.000Z",
  transcriptReadyAt: "2026-11-27T12:00:01.000Z",
  decisionDeadlineAt: "2026-11-27T12:00:06.000Z",
  decidedAt: "2026-11-27T12:00:02.000Z",
  shownAt: "2026-11-27T12:00:07.000Z",
  sourceVersion: "a9700000-0000-4000-8000-000000000005",
  turnSourceVersion: "a9700000-0000-4000-8000-000000000005",
  turnId: "a9700000-0000-4000-8000-000000000006",
  currentQualified: true, currentTurn: true, outcome: "rendered",
  renderOutcome: "shown", renderResolvedAt: "2026-11-27T12:00:07.000Z",
  probeId: "a9700000-0000-4000-8000-000000000007",
  browserClockOriginId: "a9700000-0000-4000-8000-000000000008",
  browserUploadReceiptMs: 1400, browserUploadConfirmedMs: 1400,
  browserRenderedMs: 7500, browserMeasurementComparable: true,
};

describe("private probe opportunity parser", () => {
  it("keeps a valid 6,100 ms paint in the measured sample", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { studyId, recordedCount: 1, items: [item] }, error: null,
    });
    const snapshot = await loadProbeOpportunitySnapshot(rpc, studyId);
    expect(snapshot.items[0]?.browserRenderedMs).toBe(7500);
    expect(snapshot.items[0]?.browserMeasurementComparable).toBe(true);
    expect(rpc).toHaveBeenCalledWith("read_gate3_probe_opportunity_snapshot",
      { supplied_study_id: studyId });
  });

  it("rejects a falsely comparable changed-origin or clockless item", async () => {
    for (const invalid of [
      { browserClockOriginId: null },
      { browserUploadReceiptMs: null },
      { browserUploadConfirmedMs: 1401 },
      { browserRenderedMs: 1399 },
    ]) {
      const rpc = vi.fn().mockResolvedValue({
        data: { studyId, recordedCount: 1, items: [{ ...item, ...invalid }] }, error: null,
      });
      await expect(loadProbeOpportunitySnapshot(rpc, studyId))
        .rejects.toThrow("invalid private probe opportunity");
    }
  });
});
