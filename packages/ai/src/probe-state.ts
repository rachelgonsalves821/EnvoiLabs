import type { ProbeDecision } from "./probe-runtime.js";

export interface ProbeTurn {
  readonly sessionId: string;
  readonly questionId: string;
  readonly answerId: string;
  readonly turnId: string;
  readonly probesUsed: number;
  readonly maxProbes: number;
  /** Monotonic timestamp at which the interview must advance. */
  readonly decisionDeadlineAtMs: number;
}

export type ProbeState =
  | { readonly phase: "awaiting_upload"; readonly turn: ProbeTurn }
  | { readonly phase: "transcribing"; readonly turn: ProbeTurn; readonly uploadConfirmedAtMs: number }
  | { readonly phase: "deciding"; readonly turn: ProbeTurn; readonly uploadConfirmedAtMs: number }
  | { readonly phase: "ready"; readonly turn: ProbeTurn; readonly uploadConfirmedAtMs: number;
      readonly text: string }
  | { readonly phase: "rendered"; readonly turn: ProbeTurn; readonly uploadConfirmedAtMs: number;
      readonly renderedAtMs: number; readonly text: string }
  | { readonly phase: "next"; readonly turn: ProbeTurn;
      readonly outcome: "no_probe" | "error" | "timeout" | "superseded" };

export type ProbeEvent =
  | { readonly type: "upload_confirmed"; readonly turnId: string; readonly atMs: number }
  | { readonly type: "transcript_ready"; readonly turnId: string; readonly atMs: number }
  | { readonly type: "transcript_failed"; readonly turnId: string }
  | { readonly type: "decision"; readonly turnId: string; readonly atMs: number;
      readonly decision: ProbeDecision }
  | { readonly type: "rendered"; readonly turnId: string; readonly atMs: number }
  | { readonly type: "next_question"; readonly turnId: string };

/** Pure guide-turn state: no provider call or respondent data is retained here. */
export function beginProbeTurn(turn: ProbeTurn, nowMs: number): ProbeState {
  if (!turn.sessionId || !turn.questionId || !turn.answerId || !turn.turnId
    || !Number.isSafeInteger(turn.probesUsed) || !Number.isSafeInteger(turn.maxProbes)
    || turn.probesUsed < 0 || turn.maxProbes < 0 || turn.maxProbes > 2
    || !Number.isFinite(nowMs) || !Number.isFinite(turn.decisionDeadlineAtMs)) {
    return { phase: "next", turn, outcome: "error" };
  }
  if (turn.probesUsed >= turn.maxProbes || nowMs >= turn.decisionDeadlineAtMs)
    return { phase: "next", turn, outcome: "no_probe" };
  return { phase: "awaiting_upload", turn };
}

export function advanceProbeState(state: ProbeState, event: ProbeEvent): ProbeState {
  if (event.turnId !== state.turn.turnId) return state;
  if (event.type === "next_question") {
    return state.phase === "next" ? state : { phase: "next", turn: state.turn, outcome: "superseded" };
  }
  if (state.phase === "next" || state.phase === "rendered") return state;
  if (event.type === "upload_confirmed" && state.phase === "awaiting_upload") {
    if (!Number.isFinite(event.atMs)) return { phase: "next", turn: state.turn, outcome: "error" };
    return event.atMs >= state.turn.decisionDeadlineAtMs
      ? { phase: "next", turn: state.turn, outcome: "no_probe" }
      : { phase: "transcribing", turn: state.turn, uploadConfirmedAtMs: event.atMs };
  }
  if (event.type === "transcript_failed" && state.phase === "transcribing")
    return { phase: "next", turn: state.turn, outcome: "error" };
  if (event.type === "transcript_ready" && state.phase === "transcribing") {
    if (!Number.isFinite(event.atMs) || event.atMs < state.uploadConfirmedAtMs)
      return { phase: "next", turn: state.turn, outcome: "error" };
    return event.atMs >= state.turn.decisionDeadlineAtMs
      ? { phase: "next", turn: state.turn, outcome: "timeout" }
      : { phase: "deciding", turn: state.turn, uploadConfirmedAtMs: state.uploadConfirmedAtMs };
  }
  if (event.type === "decision" && state.phase === "deciding") {
    if (!Number.isFinite(event.atMs) || event.atMs < state.uploadConfirmedAtMs)
      return { phase: "next", turn: state.turn, outcome: "error" };
    if (event.atMs >= state.turn.decisionDeadlineAtMs)
      return { phase: "next", turn: state.turn, outcome: "timeout" };
    if (event.decision.turnId !== state.turn.turnId)
      return { phase: "next", turn: state.turn, outcome: "superseded" };
    return event.decision.action === "probe"
      ? { phase: "ready", turn: state.turn, uploadConfirmedAtMs: state.uploadConfirmedAtMs,
        text: event.decision.text }
      : { phase: "next", turn: state.turn, outcome: event.decision.outcome };
  }
  if (event.type === "rendered" && state.phase === "ready") {
    if (!Number.isFinite(event.atMs) || event.atMs < state.uploadConfirmedAtMs)
      return { phase: "next", turn: state.turn, outcome: "error" };
    return { phase: "rendered", turn: state.turn, uploadConfirmedAtMs: state.uploadConfirmedAtMs,
      renderedAtMs: event.atMs, text: state.text };
  }
  return state;
}
