export type ProbeOutcome =
  | { readonly outcome: "rendered"; readonly uploadConfirmedAtMs: number; readonly renderedAtMs: number }
  | { readonly outcome: "timeout"; readonly stage?: "decision" | "render" }
  | { readonly outcome: "no_probe" | "error" | "superseded" };

export interface ProbeMetrics {
  readonly total: number;
  readonly rendered: number;
  readonly renderedP95Ms: number | null;
  readonly noProbe: number;
  readonly errors: number;
  readonly timeouts: number;
  readonly decisionTimeouts: number;
  readonly renderTimeouts: number;
  readonly unclassifiedTimeouts: number;
  readonly superseded: number;
  readonly noProbeRate: number;
  readonly errorRate: number;
  readonly timeoutRate: number;
  readonly supersededRate: number;
}

export interface ProbeAttemptRecord {
  readonly turnId: string;
  readonly device: "ios-safari" | "android-chrome";
  readonly evidence: "fixture" | "physical-device";
  readonly result: ProbeOutcome;
}

/** Platform supplies this complete, current-qualified opportunity manifest independently of outcomes. */
export interface ProbeOpportunity {
  readonly turnId: string;
  readonly sourceVersion: string;
  /** Absent for a qualified timeout recorded before a browser turn existed. */
  readonly browserUploadConfirmedAtMs: number | null;
  readonly device: ProbeAttemptRecord["device"];
  readonly evidence: ProbeAttemptRecord["evidence"];
}

export interface ProbeMeasuredAttempt extends ProbeAttemptRecord {
  readonly sourceVersion: string;
}

export interface ProbeAttemptLogSummary {
  readonly evidence: "fixture" | "physical-device" | "none";
  readonly overall: ProbeMetrics;
  readonly iosSafari: ProbeMetrics;
  readonly androidChrome: ProbeMetrics;
  readonly bothDeviceLabelsPresent: boolean;
}

/** Keep one outcome per persisted turn and keep fixture timing distinct from device timing. */
export function summarizeProbeAttemptLog(records: readonly ProbeAttemptRecord[]): ProbeAttemptLogSummary {
  const seen = new Set<string>();
  const evidence = new Set<ProbeAttemptRecord["evidence"]>();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const record of records) {
    if (!record || typeof record.turnId !== "string" || !uuid.test(record.turnId)
      || seen.has(record.turnId.toLowerCase())
      || !["ios-safari", "android-chrome"].includes(record.device)
      || !["fixture", "physical-device"].includes(record.evidence)
      || !record.result || !["rendered", "no_probe", "error", "timeout", "superseded"]
        .includes(record.result.outcome)
      || (record.result.outcome === "rendered"
        && (!Number.isFinite(record.result.uploadConfirmedAtMs)
          || !Number.isFinite(record.result.renderedAtMs))))
      throw new Error("Invalid or duplicate probe attempt");
    seen.add(record.turnId.toLowerCase());
    evidence.add(record.evidence);
  }
  if (evidence.size > 1) throw new Error("Mixed fixture and physical-device evidence");
  const forDevice = (device: ProbeAttemptRecord["device"]) => records
    .filter((record) => record.device === device).map((record) => record.result);
  const ios = forDevice("ios-safari");
  const android = forDevice("android-chrome");
  return { evidence: evidence.values().next().value ?? "none",
    overall: summarizeProbeOutcomes(records.map((record) => record.result)),
    iosSafari: summarizeProbeOutcomes(ios), androidChrome: summarizeProbeOutcomes(android),
    bothDeviceLabelsPresent: ios.length > 0 && android.length > 0 };
}

/** Do not score a selected subset of successful probes or replay an old source version. */
export function summarizeCompleteProbeOpportunityLog(
  opportunities: readonly ProbeOpportunity[], records: readonly ProbeMeasuredAttempt[],
): ProbeAttemptLogSummary {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const expected = new Map<string, ProbeOpportunity>();
  for (const opportunity of opportunities) {
    if (!opportunity || !uuid.test(opportunity.turnId)
      || !uuid.test(opportunity.sourceVersion)
      || (opportunity.browserUploadConfirmedAtMs !== null
        && (!Number.isFinite(opportunity.browserUploadConfirmedAtMs)
          || opportunity.browserUploadConfirmedAtMs < 0))
      || !["ios-safari", "android-chrome"].includes(opportunity.device)
      || !["fixture", "physical-device"].includes(opportunity.evidence)
      || expected.has(opportunity.turnId.toLowerCase()))
      throw new Error("Invalid or duplicate probe opportunity");
    expected.set(opportunity.turnId.toLowerCase(), opportunity);
  }
  if (records.length !== expected.size) throw new Error("Incomplete probe opportunity outcomes");
  for (const record of records) {
    if (!record || typeof record.turnId !== "string")
      throw new Error("Probe outcome does not match current opportunity");
    const opportunity = expected.get(record.turnId.toLowerCase());
    if (!uuid.test(record.sourceVersion) || !opportunity
      || opportunity.sourceVersion.toLowerCase() !== record.sourceVersion.toLowerCase()
      || opportunity.device !== record.device || opportunity.evidence !== record.evidence
      || (record.result?.outcome === "rendered"
        && (opportunity.browserUploadConfirmedAtMs === null
          || record.result.uploadConfirmedAtMs !== opportunity.browserUploadConfirmedAtMs))
      || (opportunity.browserUploadConfirmedAtMs === null
        && record.result?.outcome !== "timeout"))
      throw new Error("Probe outcome does not match current opportunity");
  }
  return summarizeProbeAttemptLog(records);
}

/** Upload confirmation to browser render, excluding intentional no-probe decisions from latency. */
export function summarizeProbeOutcomes(outcomes: readonly ProbeOutcome[]): ProbeMetrics {
  if (outcomes.some((item) => item.outcome === "timeout" && item.stage !== undefined
    && item.stage !== "decision" && item.stage !== "render"))
    throw new Error("Invalid probe timeout stage");
  const latencies = outcomes.filter((item): item is Extract<ProbeOutcome, { outcome: "rendered" }> =>
    item.outcome === "rendered").map((item) => item.renderedAtMs - item.uploadConfirmedAtMs);
  if (latencies.some((ms) => !Number.isFinite(ms) || ms < 0)) throw new Error("Invalid probe timestamps");
  latencies.sort((a, b) => a - b);
  const count = (outcome: ProbeOutcome["outcome"]) => outcomes.filter((item) => item.outcome === outcome).length;
  const rate = (n: number) => outcomes.length === 0 ? 0 : n / outcomes.length;
  const noProbe = count("no_probe");
  const errors = count("error");
  const timeouts = count("timeout");
  const decisionTimeouts = outcomes.filter((item) => item.outcome === "timeout"
    && item.stage === "decision").length;
  const renderTimeouts = outcomes.filter((item) => item.outcome === "timeout"
    && item.stage === "render").length;
  const superseded = count("superseded");
  return {
    total: outcomes.length, rendered: latencies.length,
    renderedP95Ms: latencies.length === 0 ? null : latencies[Math.ceil(0.95 * latencies.length) - 1] ?? null,
    noProbe, errors, timeouts, decisionTimeouts, renderTimeouts,
    unclassifiedTimeouts: timeouts - decisionTimeouts - renderTimeouts,
    superseded, noProbeRate: rate(noProbe), errorRate: rate(errors),
    timeoutRate: rate(timeouts), supersededRate: rate(superseded),
  };
}
