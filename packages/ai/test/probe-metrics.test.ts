import { expect, it } from "vitest";
import { summarizeProbeOutcomes } from "../src/probe-metrics.js";

it("reports rendered p95 and separate no-probe, error and timeout rates", () => {
  const result = summarizeProbeOutcomes([
    ...Array.from({ length: 19 }, (_, index) => ({
      outcome: "rendered" as const, uploadConfirmedAtMs: 100,
      renderedAtMs: 100 + (index + 1) * 100,
    })),
    { outcome: "no_probe" }, { outcome: "error" }, { outcome: "timeout" },
  ]);
  expect(result).toMatchObject({ total: 22, rendered: 19, renderedP95Ms: 1900,
    noProbe: 1, errors: 1, timeouts: 1, timeoutRate: 1 / 22 });
  expect(summarizeProbeOutcomes([{ outcome: "no_probe" }]).renderedP95Ms).toBeNull();
  expect(() => summarizeProbeOutcomes([{ outcome: "rendered", uploadConfirmedAtMs: 3, renderedAtMs: 2 }]))
    .toThrow("Invalid probe timestamps");
});
