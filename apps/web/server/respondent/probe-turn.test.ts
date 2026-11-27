import { describe, expect, it, vi } from "vitest";
import { createProbeDecisionPort, dispatchReadyProbeBatch,
  dispatchReadyProbeCandidates, listReadyProbeCandidates,
  sweepDueProbeRenders, sweepDueProbeTimeouts,
  type ProbeReadyCandidate, type ProbeRpc } from "@envoi-labs/services/probe-turn";

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
  it("begins only the stored captured-clock turn for a verified respondent", async () => {
    const answerId = "a9720000-0000-4000-8000-000000000005";
    const turnId = "a9720000-0000-4000-8000-000000000006";
    const call = vi.fn<ProbeRpc>().mockResolvedValue({ data: turnId, error: null });
    const port = createProbeDecisionPort(call, "verified-respondent", buildRequest);
    expect(await port.beginCurrentTurn(answerId)).toBe(turnId);
    expect(call).toHaveBeenCalledWith("begin_gate3_probe_turn_with_clock", {
      supplied_answer_id: answerId, supplied_auth_user_id: "verified-respondent" });
    expect(await port.beginCurrentTurn("browser-selected")).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
    call.mockResolvedValueOnce({ data: null, error: null });
    expect(await port.beginCurrentTurn(answerId)).toBeNull();
    call.mockResolvedValueOnce({ data: "wrong", error: null });
    await expect(port.beginCurrentTurn(answerId)).rejects.toThrow("invalid captured probe turn");
  });
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
      probeId: "probe", browserClockOriginId: "page-clock",
      browserRenderedAtMs: 1200 })).toBe("unavailable");
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

  it("reports only a stored terminal render result for the verified respondent", async () => {
    const turnId = "a9720000-0000-4000-8000-000000000007";
    const call = vi.fn<ProbeRpc>().mockResolvedValue({ error: null,
      data: { status: "resolved", outcome: "timeout", turnId } });
    const port = createProbeDecisionPort(call, "verified-respondent", buildRequest);
    expect(await port.recordRenderTerminal(turnId))
      .toEqual({ status: "resolved", outcome: "timeout" });
    call.mockResolvedValueOnce({ error: null,
      data: { status: "resolved", outcome: "error", turnId } });
    expect(await port.recordRenderTerminal(turnId))
      .toEqual({ status: "resolved", outcome: "error" });
    expect(call).toHaveBeenCalledWith("record_gate3_probe_render_terminal", {
      supplied_turn_id: turnId, supplied_auth_user_id: "verified-respondent" });
    call.mockResolvedValueOnce({ error: null, data: { status: "not_due" } });
    expect(await port.recordRenderTerminal(turnId)).toEqual({ status: "not_due" });
    call.mockResolvedValueOnce({ error: null, data: {
      status: "resolved", outcome: "shown", turnId: "another-turn" } });
    expect(await port.recordRenderTerminal(turnId)).toEqual({ status: "unavailable" });
    expect(await port.recordRenderTerminal("bad-id")).toEqual({ status: "stale" });
  });

  it("records a failed-frame terminal with exact turn identity and no model call", async () => {
    const input = { sessionId: "a9720000-0000-4000-8000-000000000004",
      turnId: "a9720000-0000-4000-8000-000000000007",
      probeId: "a9720000-0000-4000-8000-000000000008" };
    const call = vi.fn<ProbeRpc>().mockResolvedValue({ error: null,
      data: { status: "resolved", outcome: "error", turnId: input.turnId } });
    const port = createProbeDecisionPort(call, "verified-respondent", buildRequest);
    expect(await port.recordRenderError(input)).toEqual({ status: "resolved", outcome: "error" });
    expect(call).toHaveBeenCalledWith("record_gate3_probe_render_error", {
      supplied_session_id: input.sessionId, supplied_turn_id: input.turnId,
      supplied_probe_id: input.probeId, supplied_auth_user_id: "verified-respondent" });
    expect(await port.recordRenderError({ ...input, probeId: "wrong" }))
      .toEqual({ status: "stale" });
    expect(call).toHaveBeenCalledTimes(1);
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

  it("reads bounded ready identities without exposing a model source", async () => {
    const answerId = "a9720000-0000-4000-8000-000000000005";
    const sessionId = "a9720000-0000-4000-8000-000000000004";
    const authUserId = "90300000-0000-4000-8000-000000000001";
    const call = vi.fn<ProbeRpc>().mockResolvedValue({ error: null,
      data: [{ answerId, sessionId, authUserId }] });
    expect(await listReadyProbeCandidates(call, 1)).toEqual([{ answerId, sessionId, authUserId }]);
    expect(call).toHaveBeenCalledWith("list_gate3_probe_ready", { supplied_limit: 1 });
    await expect(listReadyProbeCandidates(async () => ({ error: null,
      data: [{ answerId, sessionId, authUserId }, { answerId, sessionId, authUserId }] }), 2))
      .rejects.toThrow("duplicate ready answer");
    await expect(listReadyProbeCandidates(async () => ({ error: null,
      data: [{ answerId, sessionId, authUserId, sourceText: "private fixture" }] }), 1))
      .rejects.toThrow("invalid private ready selector");
    await expect(listReadyProbeCandidates(call, 101)).rejects.toThrow("ready selector limit");
  });

  it("dispatches a bounded ID batch and records independent stale or failed outcomes", async () => {
    const candidates = [0, 1, 2].map((index) => ({
      answerId: `a9720000-0000-4000-8000-00000000000${index + 1}`,
      sessionId: "a9720000-0000-4000-8000-000000000004",
      authUserId: "90300000-0000-4000-8000-000000000001" }));
    const call = vi.fn<ProbeRpc>().mockResolvedValue({ data: candidates, error: null });
    const run = vi.fn().mockResolvedValueOnce("committed")
      .mockResolvedValueOnce("stale").mockRejectedValueOnce(Error("private source"));
    expect(await dispatchReadyProbeCandidates(call, run, 3)).toEqual({
      scanned: 3, committed: 1, stale: 1, unavailable: 1 });
    expect(run.mock.calls.map(([candidate]) => candidate)).toEqual(candidates);
    expect(call).toHaveBeenCalledWith("list_gate3_probe_ready", { supplied_limit: 3 });
  });

  it("binds each decision port to the database-selected respondent before the runner", async () => {
    const candidate = { answerId: "a9720000-0000-4000-8000-000000000005",
      sessionId: "a9720000-0000-4000-8000-000000000004",
      authUserId: "90300000-0000-4000-8000-000000000001" };
    const turnId = "a9720000-0000-4000-8000-000000000006";
    const call = vi.fn<ProbeRpc>().mockImplementation(async (name) => ({ error: null,
      data: name === "list_gate3_probe_ready" ? [candidate] : turnId }));
    const build = vi.fn((_selected: ProbeReadyCandidate,
      source: { sourceText: string; questionText: string }) => buildRequest(source));
    const run = vi.fn(async (selected: ProbeReadyCandidate,
      port: ReturnType<typeof createProbeDecisionPort>) => {
      expect(selected).toEqual(candidate);
      expect(await port.beginCurrentTurn(selected.answerId)).toBe(turnId);
      return { status: "committed" as const };
    });
    expect(await dispatchReadyProbeBatch(call, build, run, 1)).toEqual({
      scanned: 1, committed: 1, stale: 0, unavailable: 0 });
    expect(call).toHaveBeenCalledWith("begin_gate3_probe_turn_with_clock", {
      supplied_answer_id: candidate.answerId,
      supplied_auth_user_id: candidate.authUserId });
    expect(build).not.toHaveBeenCalled();
  });

  it("settles only private overdue render candidates through the locked writer", async () => {
    const turnId = "a9720000-0000-4000-8000-000000000007";
    const authUserId = "90300000-0000-4000-8000-000000000001";
    const call = vi.fn<ProbeRpc>().mockImplementation(async (name) => ({ error: null,
      data: name === "list_gate3_probe_render_due"
        ? [{ turnId, authUserId }]
        : { status: "resolved", outcome: "timeout", turnId } }));
    expect(await sweepDueProbeRenders(call, 1)).toEqual({
      scanned: 1, shown: 0, timedOut: 1, superseded: 0,
      notDue: 0, stale: 0, unavailable: 0 });
    expect(call).toHaveBeenNthCalledWith(1, "list_gate3_probe_render_due",
      { supplied_limit: 1 });
    expect(call).toHaveBeenNthCalledWith(2, "record_gate3_probe_render_terminal",
      { supplied_turn_id: turnId, supplied_auth_user_id: authUserId });
    expect(call).toHaveBeenCalledTimes(2);
    call.mockImplementation(async (name) => ({ error: null,
      data: name === "list_gate3_probe_render_due"
        ? [{ turnId, authUserId }]
        : { status: "resolved", outcome: "shown", turnId } }));
    expect((await sweepDueProbeRenders(call, 1)).shown).toBe(1);
    await expect(sweepDueProbeRenders(async () => ({ error: null,
      data: [{ turnId, authUserId: "unverified" }] })))
      .rejects.toThrow("invalid private render candidate");
    await expect(sweepDueProbeRenders(call, 101))
      .rejects.toThrow("render sweep limit");
  });
});
