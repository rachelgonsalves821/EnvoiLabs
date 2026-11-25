/** Structural subset of Gate 2's private, whole-study opportunity snapshot. */
export interface PersistedProbeOpportunity {
  readonly answerId: string;
  readonly currentQualified: boolean;
  readonly currentTurn: boolean;
  readonly outcome: "rendered" | "no_probe" | "error" | "timeout" |
    "superseded" | "pending_render" | "pending" | "withheld" | "invalidated";
  readonly renderOutcome: "shown" | "timeout" | "superseded" | null;
}

export interface PersistedProbeSnapshot {
  readonly recordedCount: number;
  readonly items: readonly PersistedProbeOpportunity[];
}

export interface ProbeTerminalCoverage {
  /** Surviving receipts only; deletion can remove older opportunities. */
  readonly survivingRecorded: number;
  readonly withheld: number;
  readonly invalidated: number;
  readonly pending: number;
  readonly pendingRender: number;
  readonly terminal: number;
  readonly decisionTimeouts: number;
  readonly renderTimeouts: number;
  /** Does not establish a historical denominator, latency or model quality. */
  readonly terminalCoverageComplete: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminalOutcomes = new Set(["rendered", "no_probe", "error", "timeout", "superseded"]);

/** Audit stored outcomes without treating an unresolved probe as a timeout. */
export function assessPersistedProbeCoverage(snapshot: PersistedProbeSnapshot): ProbeTerminalCoverage {
  if (!snapshot || !Number.isSafeInteger(snapshot.recordedCount)
    || snapshot.recordedCount < 0 || snapshot.recordedCount > 5000
    || !Array.isArray(snapshot.items) || snapshot.items.length !== snapshot.recordedCount)
    throw new Error("Incomplete private probe snapshot");
  const seen = new Set<string>();
  const counts = { survivingRecorded: snapshot.recordedCount, withheld: 0,
    invalidated: 0, pending: 0, pendingRender: 0, terminal: 0,
    decisionTimeouts: 0, renderTimeouts: 0 };
  for (const item of snapshot.items) {
    if (!item || !uuid.test(item.answerId) || seen.has(item.answerId.toLowerCase())
      || typeof item.currentQualified !== "boolean" || typeof item.currentTurn !== "boolean"
      || ![...terminalOutcomes, "pending", "pending_render", "withheld", "invalidated"]
        .includes(item.outcome)
      || ![null, "shown", "timeout", "superseded"].includes(item.renderOutcome)
      || (!item.currentQualified && item.outcome !== "withheld")
      || (item.outcome === "withheld" && item.currentQualified)
      || (item.outcome === "invalidated" && (!item.currentQualified || item.currentTurn))
      || (item.renderOutcome !== null && item.currentQualified && !item.currentTurn)
      || (["rendered", "no_probe", "error", "timeout", "pending_render"]
        .includes(item.outcome) && !item.currentTurn)
      || (item.outcome === "rendered" && item.renderOutcome !== "shown")
      || (item.renderOutcome === "shown" && item.outcome !== "rendered"
        && item.outcome !== "withheld" && item.outcome !== "invalidated")
      || (item.renderOutcome === "timeout" && item.outcome !== "timeout"
        && item.outcome !== "withheld" && item.outcome !== "invalidated")
      || (item.renderOutcome === "superseded" && item.outcome !== "superseded"
        && item.outcome !== "withheld" && item.outcome !== "invalidated")
      || (item.outcome === "pending_render" && item.renderOutcome !== null))
      throw new Error("Invalid private probe outcome");
    seen.add(item.answerId.toLowerCase());
    if (item.outcome === "withheld") counts.withheld++;
    else if (item.outcome === "invalidated") counts.invalidated++;
    else if (item.outcome === "pending") counts.pending++;
    else if (item.outcome === "pending_render") counts.pendingRender++;
    else {
      counts.terminal++;
      if (item.outcome === "timeout") {
        if (item.renderOutcome === "timeout") counts.renderTimeouts++;
        else counts.decisionTimeouts++;
      }
    }
  }
  return { ...counts, terminalCoverageComplete: counts.terminal > 0
    && counts.pending === 0 && counts.pendingRender === 0 };
}
