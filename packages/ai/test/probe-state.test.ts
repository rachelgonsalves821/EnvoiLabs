import { describe, expect, it } from "vitest";
import { advanceProbeState, beginProbeTurn, type ProbeTurn } from "../src/probe-state.js";

const turn: ProbeTurn = { sessionId: "session-1", questionId: "core-1", answerId: "answer-1",
  turnId: "turn-1", probesUsed: 0, maxProbes: 2, decisionDeadlineAtMs: 1000 };

describe("probe guide-turn state", () => {
  it("moves from upload through transcript and decision to browser render", () => {
    const upload = advanceProbeState(beginProbeTurn(turn, 100),
      { type: "upload_confirmed", turnId: turn.turnId, atMs: 200 });
    expect(upload.phase).toBe("transcribing");
    const deciding = advanceProbeState(upload, { type: "transcript_ready", turnId: turn.turnId,
      atMs: 350 });
    expect(deciding.phase).toBe("deciding");
    const ready = advanceProbeState(deciding, { type: "decision", turnId: turn.turnId, atMs: 500,
      decision: { action: "probe", turnId: turn.turnId, text: "What happened next?",
        uploadConfirmedAtMs: 200 } });
    expect(ready.phase).toBe("ready");
    expect(advanceProbeState(ready, { type: "rendered", turnId: turn.turnId,
      atMs: 750 })).toMatchObject({ phase: "rendered", uploadConfirmedAtMs: 200,
      renderedAtMs: 750 });
  });

  it("takes the static next question when the probe cap or time budget is exhausted", () => {
    expect(beginProbeTurn({ ...turn, probesUsed: 2 }, 100)).toMatchObject({ phase: "next",
      outcome: "no_probe" });
    expect(beginProbeTurn(turn, 1000)).toMatchObject({ phase: "next", outcome: "no_probe" });
    const upload = advanceProbeState(beginProbeTurn(turn, 100),
      { type: "upload_confirmed", turnId: turn.turnId, atMs: 200 });
    expect(advanceProbeState(upload, { type: "transcript_ready", turnId: turn.turnId,
      atMs: 1000 })).toMatchObject({ phase: "next", outcome: "timeout" });
  });

  it("treats transcription and provider failure as next-question outcomes", () => {
    const upload = advanceProbeState(beginProbeTurn(turn, 100),
      { type: "upload_confirmed", turnId: turn.turnId, atMs: 200 });
    expect(advanceProbeState(upload, { type: "transcript_failed", turnId: turn.turnId }))
      .toMatchObject({ phase: "next", outcome: "error" });
    const deciding = advanceProbeState(upload, { type: "transcript_ready", turnId: turn.turnId,
      atMs: 300 });
    expect(advanceProbeState(deciding, { type: "decision", turnId: turn.turnId, atMs: 400,
      decision: { action: "next", turnId: turn.turnId, outcome: "timeout" } }))
      .toMatchObject({ phase: "next", outcome: "timeout" });
    expect(advanceProbeState(deciding, { type: "decision", turnId: turn.turnId, atMs: 1001,
      decision: { action: "probe", turnId: turn.turnId, text: "Too late?",
        uploadConfirmedAtMs: 200 } })).toMatchObject({ phase: "next", outcome: "timeout" });
  });

  it("ignores old-turn events and closes the prior turn when the guide advances", () => {
    const state = beginProbeTurn(turn, 100);
    expect(advanceProbeState(state, { type: "upload_confirmed", turnId: "old-turn",
      atMs: 200 })).toBe(state);
    const next = advanceProbeState(state, { type: "next_question", turnId: turn.turnId });
    expect(next).toMatchObject({ phase: "next", outcome: "superseded" });
    expect(advanceProbeState(next, { type: "decision", turnId: turn.turnId, atMs: 500,
      decision: { action: "probe", turnId: turn.turnId, text: "Late?",
        uploadConfirmedAtMs: 200 } })).toBe(next);
  });
});
