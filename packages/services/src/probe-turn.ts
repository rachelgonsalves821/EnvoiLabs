// Platform persistence boundary for Gate 3's ProbeDecisionPort. The caller must
// use a server-only service client and obtain authUserId from verified claims.
export type ProbeDecision =
  | { readonly action: "probe"; readonly turnId: string; readonly text: string;
    readonly uploadConfirmedAtMs: number }
  | { readonly action: "next"; readonly turnId: string;
    readonly outcome: "no_probe" | "error" | "timeout" | "superseded" };

export interface CommittedProbe {
  readonly sessionId: string; readonly questionId: string; readonly answerId: string;
  readonly turnId: string; readonly transcriptRevision: string;
  readonly sourceVersion: string;
  readonly decision: ProbeDecision; readonly probeId: string | null;
}

export interface ReadyProbeTurn {
  readonly turn: { readonly sessionId: string; readonly questionId: string;
    readonly answerId: string; readonly turnId: string; readonly probesUsed: number;
    readonly maxProbes: number; readonly decisionDeadlineAtMs: number };
  readonly transcriptRevision: string;
  readonly sourceVersion: string;
  readonly serverUploadConfirmedAtMs: number;
  readonly browserUploadConfirmedAtMs: number;
  readonly transcriptReadyAtMs: number;
  readonly request: { readonly purpose: string; readonly promptVersion: string;
    readonly system: string; readonly messages: readonly {
      readonly role: "user" | "assistant"; readonly content: string }[] };
}

export type ProbeRpc = (name: string, args: Record<string, unknown>) =>
  Promise<{ data: unknown; error: unknown }>;
export interface ProbeReadyCandidate {
  readonly answerId: string;
  readonly sessionId: string;
  readonly authUserId: string;
}
type Request = ReadyProbeTurn["request"];
type Source = { readonly sourceText: string; readonly questionText: string };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function string(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function uuid(value: unknown): value is string {
  return string(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// IDs only: the model-ready source is fetched later under the answer/session
// lock through begin_gate3_probe_turn_with_clock and readReadyTurn.
export async function listReadyProbeCandidates(call: ProbeRpc, limit = 25):
  Promise<readonly ProbeReadyCandidate[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("ready selector limit must be between 1 and 100");
  const { data, error } = await call("list_gate3_probe_ready", { supplied_limit: limit });
  if (error) throw error;
  if (!Array.isArray(data) || data.length > limit ||
    data.some((value) => {
      const item = record(value);
      return !item || Object.keys(item).length !== 3 ||
        !uuid(item.answerId) || !uuid(item.sessionId) || !uuid(item.authUserId);
    })) throw new Error("invalid private ready selector");
  const items = data as ProbeReadyCandidate[];
  if (new Set(items.map((item) => item.answerId)).size !== items.length)
    throw new Error("duplicate ready answer");
  return items;
}

// Both the qualified-answer wake and browser-receipt wake may arrive first.
// Select the exact saved answer; a global bounded page can omit it until expiry.
export async function readReadyProbeAnswer(call: ProbeRpc, answerId: string):
  Promise<ProbeReadyCandidate | null> {
  if (!uuid(answerId)) return null;
  const { data, error } = await call("read_gate3_probe_ready_answer", {
    supplied_answer_id: answerId });
  if (error) throw error;
  if (data === null) return null;
  const item = record(data);
  if (!item || Object.keys(item).length !== 3 || item.answerId !== answerId
    || !uuid(item.sessionId) || !uuid(item.authUserId))
    throw new Error("invalid private targeted candidate");
  return item as unknown as ProbeReadyCandidate;
}

export async function dispatchReadyProbeAnswer(call: ProbeRpc, answerId: string,
  buildRequest: (candidate: ProbeReadyCandidate, source: Source) => Request,
  runSaved: (candidate: ProbeReadyCandidate,
    port: ReturnType<typeof createProbeDecisionPort>) =>
      Promise<{ readonly status: "committed" | "stale" | "unavailable" }>):
  Promise<"committed" | "stale" | "unavailable"> {
  try {
    const candidate = await readReadyProbeAnswer(call, answerId);
    if (!candidate) return "stale";
    const port = createProbeDecisionPort(call, candidate.authUserId,
      (source) => buildRequest(candidate, source));
    return (await runSaved(candidate, port)).status;
  } catch { return "unavailable"; }
}

export interface ProbeDispatchBatchResult {
  readonly scanned: number;
  readonly committed: number;
  readonly stale: number;
  readonly unavailable: number;
}

// An injected runner must begin the captured turn and re-read current source,
// consent, cap and deadline before dispatch. Selection alone authorizes no AI.
export async function dispatchReadyProbeCandidates(call: ProbeRpc,
  runOne: (candidate: ProbeReadyCandidate) => Promise<"committed" | "stale" | "unavailable">,
  limit = 25): Promise<ProbeDispatchBatchResult> {
  const candidates = await listReadyProbeCandidates(call, limit);
  const counts = { scanned: 0, committed: 0, stale: 0, unavailable: 0 };
  for (const candidate of candidates) {
    let status: "committed" | "stale" | "unavailable";
    try { status = await runOne(candidate); }
    catch { status = "unavailable"; }
    counts.scanned++;
    if (status === "committed") counts.committed++;
    else if (status === "stale") counts.stale++;
    else counts.unavailable++;
  }
  return counts;
}

// Bind the candidate's respondent identity before handing the saved-answer
// wrapper a port. A worker cannot replace it with request or model input.
export async function dispatchReadyProbeBatch(call: ProbeRpc,
  buildRequest: (candidate: ProbeReadyCandidate, source: Source) => Request,
  runSaved: (candidate: ProbeReadyCandidate,
    port: ReturnType<typeof createProbeDecisionPort>) =>
      Promise<{ readonly status: "committed" | "stale" | "unavailable" }>,
  limit = 25): Promise<ProbeDispatchBatchResult> {
  return dispatchReadyProbeCandidates(call, async (candidate) => {
    const port = createProbeDecisionPort(call, candidate.authUserId,
      (source) => buildRequest(candidate, source));
    return (await runSaved(candidate, port)).status;
  }, limit);
}
function decision(value: unknown): ProbeDecision | null {
  const item = record(value);
  if (!item || !string(item.turnId)) return null;
  if (item.action === "probe" && string(item.text)
    && item.text.length <= 240 && item.text.endsWith("?")
    && finite(item.uploadConfirmedAtMs)) return item as unknown as ProbeDecision;
  if (item.action === "next" && ["no_probe", "error", "timeout", "superseded"]
    .includes(String(item.outcome))) return item as unknown as ProbeDecision;
  return null;
}
function committed(value: unknown): CommittedProbe | null {
  const item = record(value);
  if (!item || !string(item.sessionId) || !string(item.questionId)
    || !string(item.answerId) || !string(item.turnId)
    || !string(item.transcriptRevision) || !uuid(item.sourceVersion)) return null;
  const saved = decision(item.decision);
  if (!saved || saved.turnId !== item.turnId
    || (saved.action === "probe" ? !string(item.probeId) : item.probeId !== null)) return null;
  return { sessionId: item.sessionId, questionId: item.questionId,
    answerId: item.answerId, turnId: item.turnId,
    transcriptRevision: item.transcriptRevision, sourceVersion: item.sourceVersion,
    decision: saved,
    probeId: item.probeId as string | null };
}

export function createProbeDecisionPort(call: ProbeRpc, authUserId: string,
  buildRequest: (source: Source) => Request) {
  if (!string(authUserId)) throw new Error("verified respondent identity required");
  return {
    async beginCurrentTurn(answerId: string): Promise<string | null> {
      if (!uuid(answerId)) return null;
      const { data, error } = await call("begin_gate3_probe_turn_with_clock", {
        supplied_answer_id: answerId, supplied_auth_user_id: authUserId });
      if (error) throw error;
      if (data === null) return null;
      if (!uuid(data)) throw new Error("invalid captured probe turn");
      return data;
    },
    async readCommitted(sessionId: string, turnId: string): Promise<CommittedProbe | null> {
      const { data, error } = await call("read_gate3_committed_probe", {
        supplied_session_id: sessionId, supplied_turn_id: turnId,
        supplied_auth_user_id: authUserId });
      if (error) throw error;
      const saved = committed(data);
      if (data !== null && !saved) throw new Error("invalid committed probe");
      return saved?.sessionId === sessionId && saved.turnId === turnId ? saved : null;
    },
    async readReadyTurn(sessionId: string, turnId: string): Promise<ReadyProbeTurn | null> {
      const { data, error } = await call("read_gate3_ready_probe_turn", {
        supplied_session_id: sessionId, supplied_turn_id: turnId,
        supplied_auth_user_id: authUserId });
      if (error) throw error;
      const item = record(data);
      if (!item || item.sessionId !== sessionId || item.turnId !== turnId
        || !string(item.questionId) || !string(item.answerId)
        || !string(item.transcriptRevision) || !uuid(item.sourceVersion)
        || !string(item.sourceText)
        || !string(item.questionText) || !finite(item.probesUsed)
        || !finite(item.maxProbes) || !finite(item.decisionDeadlineAtMs)
        || !finite(item.serverUploadConfirmedAtMs)
        || !finite(item.browserUploadConfirmedAtMs)
        || !finite(item.transcriptReadyAtMs)) return null;
      return { turn: { sessionId, questionId: item.questionId,
        answerId: item.answerId, turnId, probesUsed: item.probesUsed,
        maxProbes: item.maxProbes, decisionDeadlineAtMs: item.decisionDeadlineAtMs },
        transcriptRevision: item.transcriptRevision,
        sourceVersion: item.sourceVersion,
        serverUploadConfirmedAtMs: item.serverUploadConfirmedAtMs,
        browserUploadConfirmedAtMs: item.browserUploadConfirmedAtMs,
        transcriptReadyAtMs: item.transcriptReadyAtMs,
        request: buildRequest({ sourceText: item.sourceText, questionText: item.questionText }) };
    },
    async commitDecision(input: { readonly sessionId: string; readonly questionId: string;
      readonly answerId: string; readonly turnId: string;
      readonly transcriptRevision: string; readonly sourceVersion: string;
      readonly decision: ProbeDecision }): Promise<
      { status: "committed"; value: CommittedProbe } |
      { status: "stale" | "unavailable" }> {
      const { data, error } = await call("commit_gate3_probe_decision", {
        supplied_session_id: input.sessionId, supplied_question_id: input.questionId,
        supplied_answer_id: input.answerId, supplied_turn_id: input.turnId,
        supplied_auth_user_id: authUserId,
        supplied_source_version: input.sourceVersion,
        supplied_transcript_revision: input.transcriptRevision,
        supplied_decision: input.decision });
      if (error) return { status: "unavailable" };
      const result = record(data);
      if (result?.status === "stale") return { status: "stale" };
      const saved = committed(result?.value);
      return result?.status === "committed" && saved
        && saved.sessionId === input.sessionId && saved.questionId === input.questionId
        && saved.answerId === input.answerId && saved.turnId === input.turnId
        && saved.transcriptRevision === input.transcriptRevision
        && saved.sourceVersion === input.sourceVersion
        ? { status: "committed", value: saved } : { status: "unavailable" };
    },
    async markShown(input: { readonly sessionId: string; readonly turnId: string;
      readonly probeId: string; readonly browserClockOriginId: string;
      readonly browserRenderedAtMs: number }): Promise<
      "recorded" | "stale" | "unavailable"> {
      const { data, error } = await call("mark_gate3_probe_shown_with_clock", {
        supplied_session_id: input.sessionId, supplied_turn_id: input.turnId,
        supplied_probe_id: input.probeId, supplied_auth_user_id: authUserId,
        supplied_browser_clock_origin_id: input.browserClockOriginId,
        supplied_browser_rendered_ms: input.browserRenderedAtMs });
      if (error) return "unavailable";
      return data === "recorded" || data === "stale" ? data : "unavailable";
    },
    async recordRenderError(input: { readonly sessionId: string;
      readonly turnId: string; readonly probeId: string }): Promise<
      { status: "resolved"; outcome: "shown" | "error" | "timeout" | "superseded" } |
      { status: "stale" | "unavailable" }> {
      if (!uuid(input.sessionId) || !uuid(input.turnId) || !uuid(input.probeId))
        return { status: "stale" };
      const { data, error } = await call("record_gate3_probe_render_error", {
        supplied_session_id: input.sessionId, supplied_turn_id: input.turnId,
        supplied_probe_id: input.probeId, supplied_auth_user_id: authUserId });
      if (error) return { status: "unavailable" };
      const result = record(data);
      if (result?.status === "stale") return { status: "stale" };
      if (result?.status === "resolved" && result.turnId === input.turnId &&
        (result.outcome === "shown" || result.outcome === "error" ||
          result.outcome === "timeout" || result.outcome === "superseded"))
        return { status: "resolved", outcome: result.outcome };
      return { status: "unavailable" };
    },
    async recordTimeout(answerId: string): Promise<
      { status: "committed"; value: CommittedProbe } |
      { status: "not_due" | "stale" | "unavailable" }> {
      if (!uuid(answerId)) return { status: "stale" };
      const { data, error } = await call("record_gate3_probe_timeout", {
        supplied_answer_id: answerId, supplied_auth_user_id: authUserId });
      if (error) return { status: "unavailable" };
      const result = record(data);
      if (result?.status === "stale" || result?.status === "not_due")
        return { status: result.status };
      const saved = committed(result?.value);
      return result?.status === "committed" && saved?.answerId === answerId
        ? { status: "committed", value: saved } : { status: "unavailable" };
    },
    async recordRenderTerminal(turnId: string): Promise<
      { status: "resolved"; outcome: "shown" | "error" | "timeout" | "superseded" } |
      { status: "not_due" | "stale" | "unavailable" }> {
      if (!uuid(turnId)) return { status: "stale" };
      const { data, error } = await call("record_gate3_probe_render_terminal", {
        supplied_turn_id: turnId, supplied_auth_user_id: authUserId });
      if (error) return { status: "unavailable" };
      const result = record(data);
      if (result?.status === "not_due" || result?.status === "stale")
        return { status: result.status };
      if (result?.status === "resolved" && result.turnId === turnId &&
        (result.outcome === "shown" || result.outcome === "error" || result.outcome === "timeout" ||
          result.outcome === "superseded"))
        return { status: "resolved", outcome: result.outcome };
      return { status: "unavailable" };
    },
  };
}

export interface ProbeTimeoutSweepResult {
  readonly scanned: number;
  readonly timedOut: number;
  readonly alreadyDecided: number;
  readonly notDue: number;
  readonly stale: number;
  readonly unavailable: number;
}

// Use a service-role RPC only. The selector supplies respondent identity from
// current database rows; no browser or model output can choose who is swept.
export async function sweepDueProbeTimeouts(call: ProbeRpc,
  limit = 100): Promise<ProbeTimeoutSweepResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("timeout sweep limit must be between 1 and 100");
  const { data, error } = await call("list_gate3_probe_due", { supplied_limit: limit });
  if (error) throw error;
  if (!Array.isArray(data) || data.length > limit)
    throw new Error("invalid private timeout sweep");
  // These are sweep observations, not an authoritative metric numerator:
  // concurrent workers may each observe the same first-writer timeout.
  const counts = { scanned: 0, timedOut: 0, alreadyDecided: 0,
    notDue: 0, stale: 0, unavailable: 0 };
  for (const value of data) {
    const item = record(value);
    if (!item || !uuid(item.answerId) || !uuid(item.authUserId))
      throw new Error("invalid private timeout candidate");
    const port = createProbeDecisionPort(call, item.authUserId, () => {
      throw new Error("timeout sweep cannot build a model request");
    });
    const result = await port.recordTimeout(item.answerId);
    counts.scanned++;
    if (result.status === "committed") {
      if (result.value.decision.action === "next"
        && result.value.decision.outcome === "timeout") counts.timedOut++;
      else counts.alreadyDecided++;
    }
    else if (result.status === "not_due") counts.notDue++;
    else if (result.status === "stale") counts.stale++;
    else counts.unavailable++;
  }
  return counts;
}

export interface ProbeRenderSweepResult {
  readonly scanned: number;
  readonly shown: number;
  readonly timedOut: number;
  readonly superseded: number;
  readonly notDue: number;
  readonly stale: number;
  readonly unavailable: number;
}

// This is an injected, service-role worker boundary. The selector never
// determines the terminal outcome; the session-locked RPC rechecks it.
export async function sweepDueProbeRenders(call: ProbeRpc,
  limit = 100): Promise<ProbeRenderSweepResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("render sweep limit must be between 1 and 100");
  const { data, error } = await call("list_gate3_probe_render_due", {
    supplied_limit: limit });
  if (error) throw error;
  if (!Array.isArray(data) || data.length > limit)
    throw new Error("invalid private render sweep");
  // Counts are worker observations, not authoritative metric numerators.
  const counts = { scanned: 0, shown: 0, timedOut: 0, superseded: 0,
    notDue: 0, stale: 0, unavailable: 0 };
  for (const value of data) {
    const item = record(value);
    if (!item || !uuid(item.turnId) || !uuid(item.authUserId))
      throw new Error("invalid private render candidate");
    const port = createProbeDecisionPort(call, item.authUserId, () => {
      throw new Error("render sweep cannot build a model request");
    });
    const result = await port.recordRenderTerminal(item.turnId);
    counts.scanned++;
    if (result.status === "resolved") {
      if (result.outcome === "shown") counts.shown++;
      else if (result.outcome === "timeout") counts.timedOut++;
      else counts.superseded++;
    } else if (result.status === "not_due") counts.notDue++;
    else if (result.status === "stale") counts.stale++;
    else counts.unavailable++;
  }
  return counts;
}
