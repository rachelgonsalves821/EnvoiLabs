import { describe, expect, it, vi } from "vitest";
import { createProbeDecisionPort, sweepDueProbeTimeouts,
  type ProbeRpc } from "@envoi-labs/services/probe-turn";

const ids = { sessionId: "session", questionId: "question", answerId: "answer",
  turnId: "turn", transcriptRevision: "a".repeat(64),
  sourceVersion: "019ac928-4718-7b62-b72d-8c9fb79b337c" };
const winning = { action: "probe" as const, turnId: ids.turnId,
  text: "What made speed matter?", uploadConfirmedAtMs: 1000 };
const committed = { ...ids, decision: winning, probeId: "probe" };
const buildRequest = ({ sourceText, questionText }: {
  sourceText: string; questionText: string }) => ({ purpose: "probe",
  promptVersion: "synthetic-1", system: questionText,
  messages: [{ role: "user" as const, content: sourceText }] });

describe("probe persistence boundary", () => {
  it("passes only current redacted source to the AI request builder", async () => {
    let source = "";
    const call: ProbeRpc = async () => ({ error: null, data: { ...ids,
      probesUsed: 0, maxProbes: 2, decisionDeadlineAtMs: 6000,
      serverUploadConfirmedAtMs: 0, browserUploadConfirmedAtMs: 1000,
      transcriptReadyAtMs: 100, sourceText: "Qualified synthetic answer",
      questionText: "What happened?" } });
    const port = createProbeDecisionPort(call, "respondent", (value) => {
      source = value.sourceText;
      return buildRequest(value);
    });
    const ready = await port.readReadyTurn(ids.sessionId, ids.turnId);
    expect(source).toBe("Qualified synthetic answer");
    expect(ready?.request.messages[0]?.content).toBe(source);
    expect(ready?.turn).toEqual({ sessionId: "session", questionId: "question",
      answerId: "answer", turnId: "turn", probesUsed: 0, maxProbes: 2,
      decisionDeadlineAtMs: 6000 });
    expect(ready).not.toHaveProperty("sourceText");
  });

  it("returns the database winner when a competing decision loses the race", async () => {
    const call: ProbeRpc = async (name) => ({ error: null,
      data: name === "commit_gate3_probe_decision"
        ? { status: "committed", value: committed } : committed });
    const port = createProbeDecisionPort(call, "respondent", buildRequest);
    const saved = await port.commitDecision({ ...ids,
      decision: { action: "next", turnId: "turn", outcome: "no_probe" } });
    expect(saved).toEqual({ status: "committed", value: committed });
    expect(await port.readCommitted("session", "turn")).toEqual(committed);
  });

  it("does not accept a mismatched or unavailable database result", async () => {
    const bad: ProbeRpc = async () => ({ error: null,
      data: { status: "committed", value: { ...committed, sessionId: "other" } } });
    const port = createProbeDecisionPort(bad, "respondent", buildRequest);
    expect(await port.commitDecision({ ...ids, decision: winning }))
      .toEqual({ status: "unavailable" });
    const outage = createProbeDecisionPort(async () => ({ data: null, error: Error("offline") }),
      "respondent", buildRequest);
    expect(await outage.markShown({ sessionId: "session", turnId: "turn",
      probeId: "probe", browserRenderedAtMs: 1200 })).toBe("unavailable");
    const malformed = createProbeDecisionPort(async () => ({ data: { decision: "broken" },
      error: null }), "respondent", buildRequest);
    await expect(malformed.readCommitted("session", "turn"))
      .rejects.toThrow("invalid committed probe");
    const badSource = createProbeDecisionPort(async () => ({ data: {
      ...committed, sourceVersion: "not-a-uuid" }, error: null }),
    "respondent", buildRequest);
    await expect(badSource.readCommitted("session", "turn"))
      .rejects.toThrow("invalid committed probe");
  });

  it("records an authorized timeout and preserves the first decision on retry", async () => {
    const answerId = "a9720000-0000-4000-8000-000000000005";
    const saved = { ...committed, answerId, probeId: null,
      decision: { action: "next", turnId: ids.turnId, outcome: "timeout" } };
    const call = vi.fn<ProbeRpc>().mockResolvedValue({ data: {
      status: "committed", value: saved }, error: null });
    const port = createProbeDecisionPort(call, "verified-respondent", buildRequest);
    expect(await port.recordTimeout(answerId)).toEqual({ status: "committed", value: saved });
    expect(call).toHaveBeenCalledWith("record_gate3_probe_timeout", {
      supplied_answer_id: answerId, supplied_auth_user_id: "verified-respondent" });
    call.mockResolvedValueOnce({ data: { status: "not_due" }, error: null });
    expect(await port.recordTimeout(answerId)).toEqual({ status: "not_due" });
    call.mockResolvedValueOnce({ data: { status: "committed",
      value: { ...saved, answerId: "another-answer" } }, error: null });
    expect(await port.recordTimeout(answerId)).toEqual({ status: "unavailable" });
    expect(await port.recordTimeout("not-a-uuid")).toEqual({ status: "stale" });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("sweeps only database-selected overdue answers with no model request", async () => {
    const answerId = "a9720000-0000-4000-8000-000000000005";
    const authUserId = "90300000-0000-4000-8000-000000000001";
    const call = vi.fn<ProbeRpc>().mockImplementation(async (name) => ({ error: null,
      data: name === "list_gate3_probe_due"
        ? [{ answerId, authUserId }]
        : { status: "committed", value: { ...committed, answerId } } }));
    expect(await sweepDueProbeTimeouts(call, 1)).toEqual({
      scanned: 1, timedOut: 0, alreadyDecided: 1,
      notDue: 0, stale: 0, unavailable: 0 });
    expect(call).toHaveBeenNthCalledWith(1, "list_gate3_probe_due", { supplied_limit: 1 });
    expect(call).toHaveBeenNthCalledWith(2, "record_gate3_probe_timeout", {
      supplied_answer_id: answerId, supplied_auth_user_id: authUserId });
    expect(call).toHaveBeenCalledTimes(2);
    const timeout = { ...committed, answerId, probeId: null,
      decision: { action: "next", turnId: ids.turnId, outcome: "timeout" } };
    call.mockImplementation(async (name) => ({ error: null,
      data: name === "list_gate3_probe_due"
        ? [{ answerId, authUserId }]
        : { status: "committed", value: timeout } }));
    expect(await sweepDueProbeTimeouts(call, 1)).toEqual({
      scanned: 1, timedOut: 1, alreadyDecided: 0,
      notDue: 0, stale: 0, unavailable: 0 });
    await expect(sweepDueProbeTimeouts(async () => ({ error: null,
      data: [{ answerId, authUserId: "browser-supplied" }] })))
      .rejects.toThrow("invalid private timeout candidate");
    await expect(sweepDueProbeTimeouts(call, 101))
      .rejects.toThrow("timeout sweep limit");
  });
});
