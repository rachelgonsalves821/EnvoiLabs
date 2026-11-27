import { describe, expect, it, vi } from "vitest";
import { loadProbeOpportunitySnapshot } from "@envoi-labs/services/probe-opportunities";
import type { ProbeRpc } from "@envoi-labs/services/probe-turn";

const studyId = "90600000-0000-4000-8000-000000000001";
const item = {
  answerId: "a9720000-0000-4000-8000-000000000005",
  sessionId: "a9720000-0000-4000-8000-000000000004",
  questionId: "a9720000-0000-4000-8000-000000000001",
  questionPosition: 1, isFollowup: false, consentReceipt: "a".repeat(64),
  serverUploadConfirmedAt: "2026-11-25T00:00:00Z",
  transcriptReadyAt: "2026-11-25T00:00:08Z",
  decisionDeadlineAt: "2026-11-25T00:00:06Z",
  decidedAt: "2026-11-25T00:00:09Z", shownAt: null,
  sourceVersion: "a9720000-0000-4000-8000-000000000006",
  turnSourceVersion: "a9720000-0000-4000-8000-000000000006",
  turnId: "a9720000-0000-4000-8000-000000000007",
  currentQualified: true, currentTurn: true, outcome: "timeout",
  renderOutcome: null, renderResolvedAt: null,
  probeId: null, browserClockOriginId: null, browserUploadReceiptMs: null,
  browserUploadConfirmedMs: null, browserMeasurementComparable: false,
  browserRenderedMs: null,
};

describe("private probe opportunity snapshot", () => {
  it("retains timeout-only null clocks and a complete qualified denominator", async () => {
    const call = vi.fn<ProbeRpc>().mockResolvedValue({ error: null,
      data: { studyId, recordedCount: 1, items: [item] } });
    expect(await loadProbeOpportunitySnapshot(call, studyId)).toEqual({
      studyId, recordedCount: 1, items: [item] });
    expect(call).toHaveBeenCalledWith("read_gate3_probe_opportunity_snapshot", {
      supplied_study_id: studyId });
  });

  it("accepts a persisted failed-frame outcome without claiming the probe was shown", async () => {
    const failed = { ...item, outcome: "error", renderOutcome: "error",
      renderResolvedAt: "2026-11-25T00:00:10Z" };
    const call: ProbeRpc = async () => ({ error: null,
      data: { studyId, recordedCount: 1, items: [failed] } });
    expect((await loadProbeOpportunitySnapshot(call, studyId)).items[0])
      .toEqual(failed);
  });

  it("accepts a same-origin measured render while preserving its private provenance", async () => {
    const measured = { ...item, outcome: "rendered", renderOutcome: "shown",
      renderResolvedAt: "2026-11-25T00:00:10Z", shownAt: "2026-11-25T00:00:10Z",
      probeId: "a9720000-0000-4000-8000-000000000009",
      browserClockOriginId: "a9720000-0000-4000-8000-000000000008",
      browserUploadReceiptMs: 1000, browserUploadConfirmedMs: 1000,
      browserRenderedMs: 1200, browserMeasurementComparable: true };
    const call: ProbeRpc = async () => ({ error: null,
      data: { studyId, recordedCount: 1, items: [measured] } });
    expect((await loadProbeOpportunitySnapshot(call, studyId)).items[0]).toEqual(measured);
  });

  it("fails closed on truncated, duplicate or falsely rendered results", async () => {
    const call: ProbeRpc = async () => ({ error: null,
      data: { studyId, recordedCount: 2, items: [item] } });
    await expect(loadProbeOpportunitySnapshot(call, studyId))
      .rejects.toThrow("invalid private probe snapshot");
    const duplicate: ProbeRpc = async () => ({ error: null,
      data: { studyId, recordedCount: 2, items: [item, item] } });
    await expect(loadProbeOpportunitySnapshot(duplicate, studyId))
      .rejects.toThrow("duplicate probe opportunity");
    const falseRender: ProbeRpc = async () => ({ error: null,
      data: { studyId, recordedCount: 1,
        items: [{ ...item, outcome: "rendered" }] } });
    await expect(loadProbeOpportunitySnapshot(falseRender, studyId))
      .rejects.toThrow("invalid private probe opportunity");
    const orphanClock: ProbeRpc = async () => ({ error: null,
      data: { studyId, recordedCount: 1, items: [{ ...item,
        browserClockOriginId: "a9720000-0000-4000-8000-000000000008" }] } });
    await expect(loadProbeOpportunitySnapshot(orphanClock, studyId))
      .rejects.toThrow("invalid private probe opportunity");
    const falseComparable: ProbeRpc = async () => ({ error: null,
      data: { studyId, recordedCount: 1, items: [{ ...item,
        browserMeasurementComparable: true }] } });
    await expect(loadProbeOpportunitySnapshot(falseComparable, studyId))
      .rejects.toThrow("invalid private probe opportunity");
    await expect(loadProbeOpportunitySnapshot(duplicate, "other"))
      .rejects.toThrow("study identity required");
  });
});
