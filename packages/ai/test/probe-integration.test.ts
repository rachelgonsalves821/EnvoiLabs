import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, LLMResponse } from "../src/index.js";
import { presentCommittedProbe, runProbeDecision, type ProbeDecisionPort,
  type ReadyProbeTurn } from "../src/probe-integration.js";

const response = (output: unknown): LLMResponse => ({ output, model: "fictional",
  inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 });
const provider = (generate: LLMProvider["generate"]): LLMProvider => ({ generate });
const ready: ReadyProbeTurn = {
  turn: { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
    turnId: "turn-1", probesUsed: 0, maxProbes: 2, decisionDeadlineAtMs: 1000 },
  transcriptRevision: "source-1", serverUploadConfirmedAtMs: 100,
  browserUploadConfirmedAtMs: 50, transcriptReadyAtMs: 200,
  request: { purpose: "probe", promptVersion: "v1", system: "fictional",
    messages: [{ role: "user", content: "Fictional answer" }] },
};

function setup() {
  let current: ReadyProbeTurn | null = ready;
  let committed: Awaited<ReturnType<ProbeDecisionPort["readCommitted"]>> = null;
  const port: ProbeDecisionPort = {
    readCommitted: vi.fn(async () => committed),
    readReadyTurn: vi.fn(async () => current),
    commitDecision: vi.fn(async (input) => {
      committed = { ...input, probeId: input.decision.action === "probe" ? "probe-1" : null };
      return { status: "committed" as const, value: committed };
    }),
    markShown: vi.fn(async () => "recorded" as const),
  };
  return { port, setCurrent: (value: ReadyProbeTurn | null) => { current = value; },
    setCommitted: (value: typeof committed) => { committed = value; } };
}

describe("probe decision and render ports", () => {
  it("commits a revision-bound probe before mounting and records its browser paint", async () => {
    const { port } = setup();
    const chosen = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What happened next?" })), "session-1", "turn-1", 500, () => 300);
    expect(chosen.status).toBe("committed");
    if (chosen.status !== "committed") return;
    expect(port.commitDecision).toHaveBeenCalledWith(expect.objectContaining({
      answerId: "answer-1", transcriptRevision: "source-1",
      decision: expect.objectContaining({ action: "probe" }),
    }));
    const mounted: string[] = [];
    const outcome = await presentCommittedProbe(port, chosen.value, () => "turn-1",
      (text) => { mounted.push(text); }, (callback) => callback(), () => 650);
    expect(mounted).toEqual(["What happened next?"]);
    expect(outcome).toEqual({ outcome: "rendered", uploadConfirmedAtMs: 50, renderedAtMs: 650 });
    expect(port.markShown).toHaveBeenCalledWith({ sessionId: "session-1", turnId: "turn-1",
      probeId: "probe-1", browserRenderedAtMs: 650 });
  });

  it("commits static-guide fallback on provider error, timeout and exhausted probe cap", async () => {
    const { port, setCurrent, setCommitted } = setup();
    const failed = await runProbeDecision(port, provider(async () => { throw Error("offline"); }),
      "session-1", "turn-1", 500, () => 300);
    expect(failed).toMatchObject({ status: "committed", value: { probeId: null,
      decision: { action: "next", outcome: "error" } } });
    setCommitted(null);
    const timedOut = await runProbeDecision(port, provider(() => new Promise(() => undefined)),
      "session-1", "turn-1", 1, () => 300);
    expect(timedOut).toMatchObject({ status: "committed", value: { probeId: null,
      decision: { action: "next", outcome: "timeout" } } });
    setCommitted(null);
    setCurrent({ ...ready, turn: { ...ready.turn, probesUsed: 2 } });
    const unused = vi.fn(async () => response({ action: "probe", text: "Should not run?" }));
    const capped = await runProbeDecision(port, provider(unused), "session-1", "turn-1", 500,
      () => 300);
    expect(capped).toMatchObject({ status: "committed", value: { probeId: null,
      decision: { action: "next", outcome: "no_probe" } } });
    expect(unused).not.toHaveBeenCalled();
  });

  it("does not commit a late decision after the answer or transcript revision changes", async () => {
    const { port, setCurrent } = setup();
    const result = await runProbeDecision(port, provider(async () => {
      setCurrent({ ...ready, transcriptRevision: "source-2" });
      return response({ action: "probe", text: "Late?" });
    }), "session-1", "turn-1", 500, () => 300);
    expect(result).toEqual({ status: "stale" });
    expect(port.commitDecision).not.toHaveBeenCalled();
    setCurrent(null);
    expect(await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "Never?" })), "session-1", "turn-1", 500, () => 300))
      .toEqual({ status: "stale" });
  });

  it("rejects stale or failed persistence and never mounts its text", async () => {
    const { port } = setup();
    port.commitDecision = vi.fn(async () => ({ status: "stale" as const }));
    const result = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What happened?" })), "session-1", "turn-1", 500, () => 300);
    expect(result).toEqual({ status: "stale" });
    const { port: savedPort } = setup();
    const saved = await runProbeDecision(savedPort, provider(async () => response({ action: "probe",
      text: "What happened?" })), "session-1", "turn-1", 500, () => 300);
    if (saved.status !== "committed") return;
    const mount = vi.fn();
    expect(await presentCommittedProbe(savedPort, saved.value, () => "turn-2", mount,
      (callback) => callback(), () => 500)).toEqual({ outcome: "superseded" });
    expect(mount).not.toHaveBeenCalled();
  });

  it("treats a rejected render receipt as stale without reporting a rendered probe", async () => {
    const { port } = setup();
    const saved = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What changed?" })), "session-1", "turn-1", 500, () => 300);
    if (saved.status !== "committed") return;
    port.markShown = vi.fn(async () => "stale" as const);
    const retract = vi.fn();
    expect(await presentCommittedProbe(port, saved.value, () => "turn-1", () => undefined,
      (callback) => callback(), () => 500, retract)).toEqual({ outcome: "superseded" });
    expect(retract).toHaveBeenCalledTimes(1);
  });

  it("replays a current committed decision without another model call", async () => {
    const { port, setCurrent } = setup();
    const first = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What happened?" })), "session-1", "turn-1", 500, () => 300);
    setCurrent(null);
    const generate = vi.fn(async () => response({ action: "probe", text: "Different?" }));
    expect(await runProbeDecision(port, provider(generate), "session-1", "turn-1", 500,
      () => 400)).toEqual(first);
    expect(generate).not.toHaveBeenCalled();
    expect(port.commitDecision).toHaveBeenCalledTimes(1);
  });

  it("returns the first writer's decision if another worker commits during the provider call", async () => {
    const { port, setCurrent, setCommitted } = setup();
    const prior = { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
      turnId: "turn-1", transcriptRevision: "source-1", probeId: null,
      decision: { action: "next" as const, turnId: "turn-1", outcome: "no_probe" as const } };
    const result = await runProbeDecision(port, provider(async () => {
      setCurrent(null);
      setCommitted(prior);
      return response({ action: "probe", text: "Late competing result?" });
    }), "session-1", "turn-1", 500, () => 300);
    expect(result).toEqual({ status: "committed", value: prior });
    expect(port.commitDecision).not.toHaveBeenCalled();
  });

  it("accepts a different first-writer decision returned by the commit port", async () => {
    const { port } = setup();
    const winner = { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
      turnId: "turn-1", transcriptRevision: "source-1", probeId: null,
      decision: { action: "next" as const, turnId: "turn-1", outcome: "no_probe" as const } };
    port.commitDecision = vi.fn(async () => ({ status: "committed" as const, value: winner }));
    expect(await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "Our losing proposal?" })), "session-1", "turn-1", 500, () => 300))
      .toEqual({ status: "committed", value: winner });
  });

  it("reads a conflict winner only for the same still-current answer and revision", async () => {
    const { port, setCommitted } = setup();
    port.commitDecision = vi.fn(async () => ({ status: "conflict" as const }));
    const winner = { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
      turnId: "turn-1", transcriptRevision: "source-1", probeId: "probe-winner",
      decision: { action: "probe" as const, turnId: "turn-1", text: "What changed?",
        uploadConfirmedAtMs: 50 } };
    const model = provider(async () => {
      setCommitted(winner);
      return response({ action: "probe", text: "Different proposed probe?" });
    });
    expect(await runProbeDecision(port, model, "session-1", "turn-1", 500, () => 300))
      .toEqual({ status: "committed", value: winner });
    setCommitted(null);
    const revised = { ...winner, transcriptRevision: "source-2" };
    const staleModel = provider(async () => {
      setCommitted(revised);
      return response({ action: "probe", text: "Still current?" });
    });
    expect(await runProbeDecision(port, staleModel, "session-1", "turn-1", 500, () => 300))
      .toEqual({ status: "stale" });
  });
});
