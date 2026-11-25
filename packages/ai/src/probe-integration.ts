import type { LLMProvider, LLMRequest } from "./index.js";
import { decideProbe, presentProbeIfCurrent, type ProbeDecision,
  type ProbePaintWait } from "./probe-runtime.js";
import { advanceProbeState, beginProbeTurn, type ProbeTurn } from "./probe-state.js";
import type { ProbeOutcome } from "./probe-metrics.js";

/** Platform-owned read must authorize the respondent and bind the transcript revision. */
export interface ReadyProbeTurn {
  readonly turn: ProbeTurn;
  readonly transcriptRevision: string;
  readonly sourceVersion: string;
  /** Same server clock as decisionDeadlineAtMs and transcriptReadyAtMs. */
  readonly serverUploadConfirmedAtMs: number;
  /** Opaque value from the browser's monotonic clock, echoed only for render timing. */
  readonly browserUploadConfirmedAtMs: number;
  readonly transcriptReadyAtMs: number;
  readonly request: LLMRequest;
}

export interface CommittedProbe {
  readonly sessionId: string;
  readonly questionId: string;
  readonly answerId: string;
  readonly turnId: string;
  readonly transcriptRevision: string;
  readonly sourceVersion: string;
  readonly decision: ProbeDecision;
  readonly probeId: string | null;
}

export interface ProbeDecisionPort {
  /** Return only a decision still current for this authorized session/turn. */
  readCommitted(sessionId: string, turnId: string): Promise<CommittedProbe | null>;
  readReadyTurn(sessionId: string, turnId: string): Promise<ReadyProbeTurn | null>;
  /** Compare and set on session/question/answer/turn/revision/cap/deadline, idempotently. */
  commitDecision(input: {
    readonly sessionId: string; readonly questionId: string; readonly answerId: string;
    readonly turnId: string; readonly transcriptRevision: string;
    readonly sourceVersion: string;
    readonly decision: ProbeDecision;
  }): Promise<{ status: "committed"; value: CommittedProbe } |
    { status: "conflict" | "stale" | "unavailable" }>;
  /** Compare and set before storing shown_at for this exact persisted probe. */
  markShown(input: { readonly sessionId: string; readonly turnId: string;
    readonly probeId: string; readonly browserRenderedAtMs: number }): Promise<"recorded" | "stale" | "unavailable">;
}

export type ProbeIntegrationResult = { readonly status: "committed"; readonly value: CommittedProbe } |
  { readonly status: "stale" | "unavailable" };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sameReady(left: ReadyProbeTurn, right: ReadyProbeTurn): boolean {
  return left.turn.sessionId === right.turn.sessionId
    && left.turn.questionId === right.turn.questionId
    && left.turn.answerId === right.turn.answerId
    && left.turn.turnId === right.turn.turnId
    && left.turn.probesUsed === right.turn.probesUsed
    && left.turn.maxProbes === right.turn.maxProbes
    && left.turn.decisionDeadlineAtMs === right.turn.decisionDeadlineAtMs
    && left.transcriptRevision === right.transcriptRevision
    && left.sourceVersion === right.sourceVersion
    && left.serverUploadConfirmedAtMs === right.serverUploadConfirmedAtMs
    && left.browserUploadConfirmedAtMs === right.browserUploadConfirmedAtMs
    && left.transcriptReadyAtMs === right.transcriptReadyAtMs
    && JSON.stringify(left.request) === JSON.stringify(right.request);
}

function validCommitted(value: CommittedProbe, sessionId: string, turnId: string): boolean {
  return value.sessionId === sessionId && value.turnId === turnId
    && !!value.questionId && !!value.answerId && !!value.transcriptRevision
    && uuid.test(value.sourceVersion)
    && value.decision.turnId === turnId
    && (value.decision.action === "probe"
      ? !!value.probeId && typeof value.decision.text === "string"
        && !!value.decision.text.trim() && value.decision.text.length <= 240
        && value.decision.text.endsWith("?")
        && Number.isFinite(value.decision.uploadConfirmedAtMs)
      : value.decision.action === "next" && value.probeId === null
        && ["no_probe", "error", "timeout", "superseded"].includes(value.decision.outcome));
}

function committedSnapshot(value: CommittedProbe, sessionId: string,
  turnId: string): CommittedProbe | null {
  const copy = structuredClone(value) as CommittedProbe;
  if (!validCommitted(copy, sessionId, turnId)) return null;
  const decision: ProbeDecision = copy.decision.action === "probe"
    ? Object.freeze({ action: "probe", turnId: copy.decision.turnId,
      text: copy.decision.text, uploadConfirmedAtMs: copy.decision.uploadConfirmedAtMs })
    : Object.freeze({ action: "next", turnId: copy.decision.turnId,
      outcome: copy.decision.outcome });
  return Object.freeze({ sessionId: copy.sessionId, questionId: copy.questionId,
    answerId: copy.answerId, turnId: copy.turnId,
    transcriptRevision: copy.transcriptRevision, sourceVersion: copy.sourceVersion,
    probeId: copy.probeId, decision });
}

function sameCommittedTurn(ready: ReadyProbeTurn, value: CommittedProbe): boolean {
  return value.sessionId === ready.turn.sessionId
    && value.questionId === ready.turn.questionId
    && value.answerId === ready.turn.answerId
    && value.turnId === ready.turn.turnId
    && value.transcriptRevision === ready.transcriptRevision
    && value.sourceVersion === ready.sourceVersion;
}

/** Runs one authorized, revision-bound decision; no generated text is shown before commit. */
export async function runProbeDecision(port: ProbeDecisionPort, provider: LLMProvider,
  sessionId: string, turnId: string, timeoutMs: number, now: () => number): Promise<ProbeIntegrationResult> {
  try {
    const previous = await port.readCommitted(sessionId, turnId);
    if (previous) {
      const saved = committedSnapshot(previous, sessionId, turnId);
      return saved ? { status: "committed", value: saved } : { status: "unavailable" };
    }
    const rawReady = await port.readReadyTurn(sessionId, turnId);
    // A service adapter may reuse an object across reads. Keep the exact
    // authorized request and source receipt fixed through the model wait.
    const ready = rawReady ? structuredClone(rawReady) as ReadyProbeTurn : null;
    if (!ready || ready.turn.sessionId !== sessionId || ready.turn.turnId !== turnId
      || !ready.transcriptRevision || !uuid.test(ready.sourceVersion)
      || !Number.isFinite(ready.serverUploadConfirmedAtMs)
      || !Number.isFinite(ready.browserUploadConfirmedAtMs)
      || !Number.isFinite(ready.transcriptReadyAtMs)
      || ready.transcriptReadyAtMs < ready.serverUploadConfirmedAtMs) return { status: "stale" };
    // The Platform read must separately prove the current purpose-specific
    // consent grant. Do not dispatch a mislabeled model request even in tests.
    if (ready.request.purpose !== "ai_followup" || !ready.request.promptVersion.trim())
      return { status: "unavailable" };
    let state = beginProbeTurn(ready.turn, ready.serverUploadConfirmedAtMs);
    if (state.phase === "awaiting_upload") state = advanceProbeState(state,
      { type: "upload_confirmed", turnId, atMs: ready.serverUploadConfirmedAtMs });
    if (state.phase === "transcribing") state = advanceProbeState(state,
      { type: "transcript_ready", turnId, atMs: ready.transcriptReadyAtMs });
    let decision: ProbeDecision;
    if (state.phase === "next") {
      decision = { action: "next", turnId, outcome: state.outcome };
    } else if (state.phase === "deciding") {
      const remainingMs = Math.floor(ready.turn.decisionDeadlineAtMs - now());
      if (remainingMs <= 0) decision = { action: "next", turnId, outcome: "timeout" };
      else {
        const candidate = await decideProbe({ turnId, uploadConfirmedAtMs: ready.browserUploadConfirmedAtMs,
          request: ready.request }, { provider, currentTurnId: () => turnId,
          authorize: async () => {
            const current = await port.readReadyTurn(sessionId, turnId);
            return !!current && sameReady(ready, current);
          },
          timeoutMs: Math.min(timeoutMs, remainingMs) });
        const advanced = advanceProbeState(state, { type: "decision", turnId, atMs: now(),
          decision: candidate });
        decision = advanced.phase === "ready" ? candidate : { action: "next", turnId,
          outcome: advanced.phase === "next" ? advanced.outcome : "error" };
      }
    } else return { status: "unavailable" };
    const current = await port.readReadyTurn(sessionId, turnId);
    if (!current || !sameReady(ready, current)) {
      const committed = await port.readCommitted(sessionId, turnId);
      const saved = committed ? committedSnapshot(committed, sessionId, turnId) : null;
      return saved && sameCommittedTurn(ready, saved)
        ? { status: "committed", value: saved } : { status: "stale" };
    }
    const result = await port.commitDecision({ sessionId, questionId: ready.turn.questionId,
      answerId: ready.turn.answerId, turnId, transcriptRevision: ready.transcriptRevision,
      sourceVersion: ready.sourceVersion, decision });
    if (result.status !== "committed") {
      if (result.status === "stale") return { status: "stale" };
      const winner = await port.readCommitted(sessionId, turnId);
      const saved = winner ? committedSnapshot(winner, sessionId, turnId) : null;
      if (saved) return sameCommittedTurn(ready, saved)
        ? { status: "committed", value: saved } : { status: "stale" };
      return { status: "unavailable" };
    }
    const saved = committedSnapshot(result.value, sessionId, turnId);
    if (!saved
      || !sameCommittedTurn(ready, saved)) return { status: "stale" };
    return { status: "committed", value: saved };
  } catch {
    return { status: "unavailable" };
  }
}

/** Browser adapter calls this only after commit; Platform rechecks current turn on markShown. */
export async function presentCommittedProbe(port: ProbeDecisionPort, committed: CommittedProbe,
  currentTurnId: () => string, mount: (text: string) => void,
  frame: (callback: () => void) => void, now: () => number,
  retract: () => void = () => undefined, wait: ProbePaintWait = {}): Promise<ProbeOutcome> {
  const clear = () => { try { retract(); } catch { /* Keep the failed render unmeasured. */ } };
  let value: CommittedProbe | null;
  try { value = committedSnapshot(committed, committed.sessionId, committed.turnId); }
  catch { return { outcome: "error" }; }
  if (!value) return { outcome: "error" };
  if (value.decision.action === "next") return { outcome: value.decision.outcome };
  if (!value.probeId) return { outcome: "error" };
  let mounted = false;
  let outcome: ProbeOutcome;
  try {
    outcome = await presentProbeIfCurrent(value.decision, currentTurnId,
      (text) => { mounted = true; mount(text); }, frame, now, wait);
  } catch {
    if (mounted) clear();
    return { outcome: "error" };
  }
  if (outcome.outcome !== "rendered") {
    if (mounted) clear();
    return outcome;
  }
  if (currentTurnId() !== value.turnId) {
    clear();
    return { outcome: "superseded" };
  }
  try {
    const stored = await port.markShown({ sessionId: value.sessionId, turnId: value.turnId,
      probeId: value.probeId, browserRenderedAtMs: outcome.renderedAtMs });
    if (stored === "recorded") {
      if (currentTurnId() === value.turnId) return outcome;
      clear();
      return { outcome: "superseded" };
    }
    clear();
    return { outcome: stored === "stale" ? "superseded" : "error" };
  } catch {
    clear();
    return { outcome: "error" };
  }
}
