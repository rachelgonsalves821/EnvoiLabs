export type ProbeOutcome =
  | { readonly outcome: "rendered"; readonly uploadConfirmedAtMs: number; readonly renderedAtMs: number }
  | { readonly outcome: "no_probe" | "error" | "timeout" | "superseded" };

export interface ProbeMetrics {
  readonly total: number;
  readonly rendered: number;
  readonly renderedP95Ms: number | null;
  readonly noProbe: number;
  readonly errors: number;
  readonly timeouts: number;
  readonly superseded: number;
  readonly noProbeRate: number;
  readonly errorRate: number;
  readonly timeoutRate: number;
  readonly supersededRate: number;
}

/** Upload confirmation to browser render, excluding intentional no-probe decisions from latency. */
export function summarizeProbeOutcomes(outcomes: readonly ProbeOutcome[]): ProbeMetrics {
  const latencies = outcomes.filter((item): item is Extract<ProbeOutcome, { outcome: "rendered" }> =>
    item.outcome === "rendered").map((item) => item.renderedAtMs - item.uploadConfirmedAtMs);
  if (latencies.some((ms) => !Number.isFinite(ms) || ms < 0)) throw new Error("Invalid probe timestamps");
  latencies.sort((a, b) => a - b);
  const count = (outcome: ProbeOutcome["outcome"]) => outcomes.filter((item) => item.outcome === outcome).length;
  const rate = (n: number) => outcomes.length === 0 ? 0 : n / outcomes.length;
  const noProbe = count("no_probe");
  const errors = count("error");
  const timeouts = count("timeout");
  const superseded = count("superseded");
  return {
    total: outcomes.length, rendered: latencies.length,
    renderedP95Ms: latencies.length === 0 ? null : latencies[Math.ceil(0.95 * latencies.length) - 1] ?? null,
    noProbe, errors, timeouts, superseded, noProbeRate: rate(noProbe), errorRate: rate(errors),
    timeoutRate: rate(timeouts), supersededRate: rate(superseded),
  };
}
