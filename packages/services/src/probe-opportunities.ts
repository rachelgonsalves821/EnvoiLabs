import type { ProbeRpc } from "./probe-turn";

export type ProbeOpportunityOutcome = "rendered" | "no_probe" | "error" |
  "timeout" | "superseded" | "pending_render" | "pending" |
  "withheld" | "invalidated";
export interface ProbeOpportunity {
  readonly answerId: string;
  readonly sessionId: string;
  readonly questionId: string;
  readonly questionPosition: number;
  readonly isFollowup: boolean;
  readonly consentReceipt: string;
  readonly serverUploadConfirmedAt: string;
  readonly transcriptReadyAt: string | null;
  readonly decisionDeadlineAt: string;
  readonly decidedAt: string | null;
  readonly shownAt: string | null;
  readonly sourceVersion: string | null;
  readonly turnSourceVersion: string | null;
  readonly turnId: string | null;
  readonly currentQualified: boolean;
  readonly currentTurn: boolean;
  readonly outcome: ProbeOpportunityOutcome;
  readonly renderOutcome: "shown" | "error" | "timeout" | "superseded" | null;
  readonly renderResolvedAt: string | null;
  readonly probeId: string | null;
  readonly browserClockOriginId: string | null;
  readonly browserUploadReceiptMs: number | null;
  readonly browserUploadConfirmedMs: number | null;
  readonly browserRenderedMs: number | null;
  readonly browserMeasurementComparable: boolean;
}
export interface ProbeOpportunitySnapshot {
  readonly studyId: string;
  readonly recordedCount: number;
  readonly items: readonly ProbeOpportunity[];
}

const outcomes = new Set<string>([
  "rendered", "no_probe", "error", "timeout", "superseded",
  "pending_render", "pending", "withheld", "invalidated",
]);
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const nullableUuid = (value: unknown): value is string | null =>
  value === null || uuid(value);
const time = (value: unknown): value is string => typeof value === "string" &&
  Number.isFinite(Date.parse(value));
const nullableTime = (value: unknown): value is string | null =>
  value === null || time(value);
const nullableClock = (value: unknown): value is number | null =>
  value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function parseItem(value: unknown): ProbeOpportunity {
  if (!object(value) || !uuid(value.answerId) || !uuid(value.sessionId) ||
    !uuid(value.questionId) || !Number.isInteger(value.questionPosition) ||
    (value.questionPosition as number) < 1 || typeof value.isFollowup !== "boolean" ||
    typeof value.consentReceipt !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.consentReceipt) ||
    !time(value.serverUploadConfirmedAt) || !nullableTime(value.transcriptReadyAt) ||
    !time(value.decisionDeadlineAt) || !nullableTime(value.decidedAt) ||
    !nullableTime(value.shownAt) || !nullableUuid(value.sourceVersion) ||
    !nullableUuid(value.turnSourceVersion) || !nullableUuid(value.turnId) ||
    typeof value.currentQualified !== "boolean" ||
    typeof value.currentTurn !== "boolean" || !outcomes.has(String(value.outcome)) ||
    !(value.renderOutcome === null || value.renderOutcome === "shown" ||
      value.renderOutcome === "error" ||
      value.renderOutcome === "timeout" || value.renderOutcome === "superseded") ||
    !nullableTime(value.renderResolvedAt) ||
    ((value.renderOutcome === null) !== (value.renderResolvedAt === null)) ||
    !nullableUuid(value.probeId) || !nullableUuid(value.browserClockOriginId) ||
    !nullableClock(value.browserUploadReceiptMs) ||
    ((value.browserClockOriginId === null) !== (value.browserUploadReceiptMs === null)) ||
    !nullableClock(value.browserUploadConfirmedMs) ||
    !nullableClock(value.browserRenderedMs) ||
    typeof value.browserMeasurementComparable !== "boolean" ||
    (value.browserMeasurementComparable && (
      value.outcome !== "rendered" || value.renderOutcome !== "shown" ||
      value.browserClockOriginId === null || value.browserUploadReceiptMs === null ||
      value.browserUploadConfirmedMs !== value.browserUploadReceiptMs ||
      value.browserRenderedMs === null ||
      value.browserRenderedMs < value.browserUploadReceiptMs)) ||
    (value.outcome === "rendered" && (value.shownAt === null ||
      value.browserUploadConfirmedMs === null || value.browserRenderedMs === null ||
      value.renderOutcome !== "shown")) ||
    (!value.currentQualified && value.outcome !== "withheld"))
    throw new Error("invalid private probe opportunity");
  return value as unknown as ProbeOpportunity;
}

// This private read returns a whole study snapshot or fails closed. It is not
// the bounded due-work queue and does not infer missing outcomes as timeouts.
export async function loadProbeOpportunitySnapshot(call: ProbeRpc,
  studyId: string): Promise<ProbeOpportunitySnapshot> {
  if (!uuid(studyId)) throw new Error("study identity required");
  const { data, error } = await call("read_gate3_probe_opportunity_snapshot", {
    supplied_study_id: studyId });
  if (error) throw error;
  if (!object(data) || data.studyId !== studyId ||
    !Number.isInteger(data.recordedCount) || (data.recordedCount as number) < 0 ||
    !Array.isArray(data.items) || data.items.length !== data.recordedCount ||
    data.items.length > 5000) throw new Error("invalid private probe snapshot");
  const items = data.items.map(parseItem);
  if (new Set(items.map((item) => item.answerId)).size !== items.length)
    throw new Error("duplicate probe opportunity");
  return { studyId, recordedCount: items.length, items };
}
