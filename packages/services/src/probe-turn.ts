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
      readonly probeId: string; readonly browserRenderedAtMs: number }): Promise<
      "recorded" | "stale" | "unavailable"> {
      const { data, error } = await call("mark_gate3_probe_shown", {
        supplied_session_id: input.sessionId, supplied_turn_id: input.turnId,
        supplied_probe_id: input.probeId, supplied_auth_user_id: authUserId,
        supplied_browser_rendered_ms: input.browserRenderedAtMs });
      if (error) return "unavailable";
      return data === "recorded" || data === "stale" ? data : "unavailable";
    },
  };
}
