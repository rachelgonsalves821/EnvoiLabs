import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, LLMResponse } from "../src/index.js";
import { presentCommittedProbe, runProbeDecision, type ProbeDecisionPort,
  type ReadyProbeTurn } from "../src/probe-integration.js";

const response = (output: unknown): LLMResponse => ({ output, model: "fictional",
  inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicros: 0 });
const provider = (generate: LLMProvider["generate"]): LLMProvider => ({ generate });
const sourceVersion = "019ac928-4718-7b62-b72d-8c9fb79b337c";
const ready: ReadyProbeTurn = {
  turn: { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
    turnId: "turn-1", probesUsed: 0, maxProbes: 2, decisionDeadlineAtMs: 1000 },
  transcriptRevision: "source-1", sourceVersion, serverUploadConfirmedAtMs: 100,
  browserUploadConfirmedAtMs: 50, transcriptReadyAtMs: 200,
  request: { purpose: "ai_followup", promptVersion: "v1", system: "fictional",
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
  it("rechecks current consent/source authority immediately before model dispatch", async () => {
    const { port } = setup();
    port.readReadyTurn = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce(null);
    const generate = vi.fn(async () => response({ action: "probe", text: "What happened?" }));
    const result = await runProbeDecision(port, provider(generate), "session-1", "turn-1",
      500, () => 300);
    expect(result).toEqual({ status: "stale" });
    expect(generate).not.toHaveBeenCalled();
    expect(port.commitDecision).not.toHaveBeenCalled();
  });

  it("withholds when a reused ready-turn object changes during authorization", async () => {
    const reused = structuredClone(ready);
    const { port } = setup();
    port.readReadyTurn = vi.fn(async () => {
      if (vi.mocked(port.readReadyTurn).mock.calls.length === 2) {
        reused.sourceVersion = "019ac928-4718-7b62-b72d-8c9fb79b337d";
      }
      return reused;
    });
    const generate = vi.fn(async () => response({ action: "probe", text: "What happened?" }));
    expect(await runProbeDecision(port, provider(generate), "session-1", "turn-1", 500,
      () => 300)).toEqual({ status: "stale" });
    expect(generate).not.toHaveBeenCalled();
    expect(port.commitDecision).not.toHaveBeenCalled();
  });

  it("withholds when a reused model request changes before dispatch", async () => {
    const reused = structuredClone(ready);
    const { port } = setup();
    port.readReadyTurn = vi.fn(async () => {
      if (vi.mocked(port.readReadyTurn).mock.calls.length === 2)
        reused.request.messages[0]!.content = "Changed fictional answer";
      return reused;
    });
    const generate = vi.fn(async () => response({ action: "probe", text: "What happened?" }));
    expect(await runProbeDecision(port, provider(generate), "session-1", "turn-1", 500,
      () => 300)).toEqual({ status: "stale" });
    expect(generate).not.toHaveBeenCalled();
    expect(port.commitDecision).not.toHaveBeenCalled();
  });

  it("does not call the provider for a request without the follow-up purpose", async () => {
    const { port, setCurrent } = setup();
    setCurrent({ ...ready, request: { ...ready.request, purpose: "probe" } });
    const generate = vi.fn(async () => response({ action: "probe", text: "What happened?" }));
    expect(await runProbeDecision(port, provider(generate), "session-1", "turn-1", 500,
      () => 300)).toEqual({ status: "unavailable" });
    expect(generate).not.toHaveBeenCalled();
    expect(port.commitDecision).not.toHaveBeenCalled();
  });

  it("withholds a ready turn without an immutable source-version UUID", async () => {
    const { port, setCurrent } = setup();
    setCurrent({ ...ready, sourceVersion: "not-a-uuid" });
    const generate = vi.fn(async () => response({ action: "probe", text: "What happened?" }));
    expect(await runProbeDecision(port, provider(generate), "session-1", "turn-1", 500,
      () => 300)).toEqual({ status: "stale" });
    expect(generate).not.toHaveBeenCalled();
    expect(port.commitDecision).not.toHaveBeenCalled();
  });

  it("commits a revision-bound probe before mounting and records its browser paint", async () => {
    const { port } = setup();
    const chosen = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What happened next?" })), "session-1", "turn-1", 500, () => 300);
    expect(chosen.status).toBe("committed");
    if (chosen.status !== "committed") return;
    expect(port.commitDecision).toHaveBeenCalledWith(expect.objectContaining({
      answerId: "answer-1", transcriptRevision: "source-1", sourceVersion,
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
    setCurrent(ready);
    expect(await runProbeDecision(port, provider(async () => {
      setCurrent({ ...ready, sourceVersion: "019ac928-4718-7b62-b72d-8c9fb79b337d" });
      return response({ action: "probe", text: "Same text, new source?" });
    }), "session-1", "turn-1", 500,
      () => 300)).toEqual({ status: "stale" });
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

  it("retracts text when the active turn changes after mount but before paint", async () => {
    const { port } = setup();
    const saved = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What changed?" })), "session-1", "turn-1", 500, () => 300);
    if (saved.status !== "committed") return;
    let activeTurn = "turn-1";
    const mount = vi.fn(() => { activeTurn = "turn-2"; });
    const retract = vi.fn();
    expect(await presentCommittedProbe(port, saved.value, () => activeTurn, mount,
      (callback) => callback(), () => 500, retract)).toEqual({ outcome: "superseded" });
    expect(mount).toHaveBeenCalledTimes(1);
    expect(retract).toHaveBeenCalledTimes(1);
    expect(port.markShown).not.toHaveBeenCalled();
  });

  it("retracts a partial mount when the rendering callback fails", async () => {
    const { port } = setup();
    const saved = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What changed?" })), "session-1", "turn-1", 500, () => 300);
    if (saved.status !== "committed") return;
    const retract = vi.fn();
    expect(await presentCommittedProbe(port, saved.value, () => "turn-1",
      () => { throw new Error("partial mount"); }, (callback) => callback(), () => 500,
      retract)).toEqual({ outcome: "error" });
    expect(retract).toHaveBeenCalledTimes(1);
    expect(port.markShown).not.toHaveBeenCalled();
  });

  it("retracts mounted text if the browser frame callback fails", async () => {
    const { port } = setup();
    const saved = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What changed?" })), "session-1", "turn-1", 500, () => 300);
    if (saved.status !== "committed") return;
    const mount = vi.fn();
    const retract = vi.fn();
    expect(await presentCommittedProbe(port, saved.value, () => "turn-1", mount,
      () => { throw new Error("frame unavailable"); }, () => 500, retract))
      .toEqual({ outcome: "error" });
    expect(mount).toHaveBeenCalledTimes(1);
    expect(retract).toHaveBeenCalledTimes(1);
    expect(port.markShown).not.toHaveBeenCalled();
  });

  it("retracts an unpainted probe when browser frames remain suspended", async () => {
    const { port } = setup();
    const saved = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What changed?" })), "session-1", "turn-1", 500, () => 300);
    if (saved.status !== "committed") return;
    const mount = vi.fn();
    const retract = vi.fn();
    vi.useFakeTimers();
    try {
      const pending = presentCommittedProbe(port, saved.value, () => "turn-1", mount,
        () => undefined, () => 500, retract, { timeoutMs: 1 });
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ outcome: "timeout" });
      expect(mount).toHaveBeenCalledTimes(1);
      expect(retract).toHaveBeenCalledTimes(1);
      expect(port.markShown).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("retracts when the turn changes between paint and the shown receipt", async () => {
    const { port } = setup();
    const saved = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What changed?" })), "session-1", "turn-1", 500, () => 300);
    if (saved.status !== "committed") return;
    let reads = 0;
    const retract = vi.fn();
    expect(await presentCommittedProbe(port, saved.value,
      () => ++reads < 3 ? "turn-1" : "turn-2",
      () => undefined, (callback) => callback(), () => 500,
      retract)).toEqual({ outcome: "superseded" });
    expect(retract).toHaveBeenCalledTimes(1);
    expect(port.markShown).not.toHaveBeenCalled();
  });

  it("retracts when a shown receipt returns after the browser advances", async () => {
    const { port } = setup();
    const saved = await runProbeDecision(port, provider(async () => response({ action: "probe",
      text: "What changed?" })), "session-1", "turn-1", 500, () => 300);
    if (saved.status !== "committed") return;
    let activeTurn = "turn-1";
    port.markShown = vi.fn(async () => { activeTurn = "turn-2"; return "recorded" as const; });
    const retract = vi.fn();
    expect(await presentCommittedProbe(port, saved.value, () => activeTurn,
      () => undefined, (callback) => callback(), () => 500, retract))
      .toEqual({ outcome: "superseded" });
    expect(retract).toHaveBeenCalledTimes(1);
    expect(port.markShown).toHaveBeenCalledTimes(1);
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

  it("returns a fixed copy of a reused persisted decision", async () => {
    const { port, setCommitted } = setup();
    const persisted = { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
      turnId: "turn-1", transcriptRevision: "source-1", sourceVersion, probeId: "probe-1",
      decision: { action: "probe" as const, turnId: "turn-1", text: "What changed?",
        uploadConfirmedAtMs: 50 } };
    setCommitted(persisted);
    const generate = vi.fn(async () => response({ action: "probe", text: "Different?" }));
    const result = await runProbeDecision(port, provider(generate), "session-1", "turn-1",
      500, () => 300);
    persisted.decision.text = "Mutated after read?";
    persisted.probeId = "probe-2";
    expect(result).toMatchObject({ status: "committed", value: { probeId: "probe-1",
      decision: { text: "What changed?" } } });
    expect(generate).not.toHaveBeenCalled();
  });

  it("does not carry private adapter fields into a returned decision", async () => {
    const { port, setCommitted } = setup();
    const persisted = { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
      turnId: "turn-1", transcriptRevision: "source-1", sourceVersion, probeId: "probe-1",
      privateTranscript: "fictional private answer",
      decision: { action: "probe" as const, turnId: "turn-1", text: "What changed?",
        uploadConfirmedAtMs: 50, privateRationale: "fictional private reasoning" } };
    setCommitted(persisted);
    const result = await runProbeDecision(port, provider(vi.fn()), "session-1", "turn-1",
      500, () => 300);
    expect(result).toMatchObject({ status: "committed", value: { probeId: "probe-1",
      decision: { text: "What changed?" } } });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("fictional private");
  });

  it("uses the original persisted probe identity after its presentation starts", async () => {
    const { port } = setup();
    const persisted = { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
      turnId: "turn-1", transcriptRevision: "source-1", sourceVersion, probeId: "probe-1",
      decision: { action: "probe" as const, turnId: "turn-1", text: "What changed?",
        uploadConfirmedAtMs: 50 } };
    const mounted: string[] = [];
    expect(await presentCommittedProbe(port, persisted, () => "turn-1", (text) => {
      mounted.push(text);
      persisted.probeId = "probe-2";
      persisted.decision.text = "Different text?";
    }, (callback) => callback(), () => 500)).toEqual({ outcome: "rendered",
      uploadConfirmedAtMs: 50, renderedAtMs: 500 });
    expect(mounted).toEqual(["What changed?"]);
    expect(port.markShown).toHaveBeenCalledWith({ sessionId: "session-1", turnId: "turn-1",
      probeId: "probe-1", browserRenderedAtMs: 500 });
  });

  it("returns the first writer's decision if another worker commits during the provider call", async () => {
    const { port, setCurrent, setCommitted } = setup();
    const prior = { sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
      turnId: "turn-1", transcriptRevision: "source-1", sourceVersion, probeId: null,
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
      turnId: "turn-1", transcriptRevision: "source-1", sourceVersion, probeId: null,
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
      turnId: "turn-1", transcriptRevision: "source-1", sourceVersion, probeId: "probe-winner",
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
    setCommitted(null);
    const rotated = { ...winner, sourceVersion: "019ac928-4718-7b62-b72d-8c9fb79b337d" };
    expect(await runProbeDecision(port, provider(async () => {
      setCommitted(rotated);
      return response({ action: "probe", text: "Same text, new source?" });
    }), "session-1", "turn-1", 500, () => 300)).toEqual({ status: "stale" });
  });

  it("withholds a malformed persisted conflict winner", async () => {
    const { port, setCommitted } = setup();
    port.commitDecision = vi.fn(async () => ({ status: "conflict" as const }));
    const result = await runProbeDecision(port, provider(async () => {
      setCommitted({ sessionId: "session-1", questionId: "question-1", answerId: "answer-1",
        turnId: "turn-1", transcriptRevision: "source-1", sourceVersion, probeId: "probe-1",
        decision: { action: "probe", turnId: "turn-1", text: "not a question",
          uploadConfirmedAtMs: 50 } });
      return response({ action: "probe", text: "What happened?" });
    }), "session-1", "turn-1", 500, () => 300);
    expect(result).toEqual({ status: "unavailable" });
  });
});
