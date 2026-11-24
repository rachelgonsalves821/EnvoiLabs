import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeInterviewRuns } from "./summarize-interview-runs.mjs";

const revision = "a".repeat(40);
const resource = (encodedBodyBytes, path = "/_next/static/chunks/entry.js") =>
  ({ path, encodedBodyBytes });
const run = (index, lcpMs, mode = "voice") => ({
  mode, run: index, lcpMs, jsEncodedBodyBytes: 199_000,
  echoRequested: true, echoEncodedBodyBytes: 500,
  js: [resource(198_500), resource(500, "/_next/static/chunks/echo.js")],
});
const report = (runs) => ({ revision, buildId: "build-1", finalWebglEcho: true,
  profile: "synthetic device", browserVersion: "test browser", runs });

test("summarizes LCP percentiles and excludes only observed Echo bytes", () => {
  const runs = Array.from({ length: 20 }, (_, index) => run(index + 1, 2000 + index * 50));
  const result = summarizeInterviewRuns(report(runs));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.modes.voice, {
    count: 20, enoughSamples: true, lcpMedianMs: 2475, lcpP75Ms: 2700,
    lcpP95Ms: 2900, lcpAbove2500Count: 10,
    nonEchoJsMedianBytes: 198_500, nonEchoJsMaxBytes: 198_500, echoRequestCount: 20,
  });
  assert.match(result.note, /Diagnostic summary only/);
});

test("keeps modes separate and marks a local three-run baseline incomplete", () => {
  const result = summarizeInterviewRuns({ ...report([
    run(1, 3560), run(2, 2708), run(3, 2552),
    { ...run(1, 2400, "typed"), echoRequested: false, echoEncodedBodyBytes: null,
      jsEncodedBodyBytes: 198_500, js: [resource(198_500)] },
  ]), buildId: null, finalWebglEcho: false });
  assert.equal(result.modes.voice.lcpMedianMs, 2708);
  assert.equal(result.modes.voice.lcpAbove2500Count, 3);
  assert.equal(result.modes.typed.echoRequestCount, 0);
  assert.equal(result.modes.typed.nonEchoJsMaxBytes, 198_500);
  assert.equal(result.modes.voice.enoughSamples, false);
  assert.ok(result.warnings.some((warning) => warning.includes("3/20")));
  assert.ok(result.warnings.some((warning) => warning.includes("WebGL")));
});

test("rejects missing transfer accounting rather than presenting a budget result", () => {
  assert.throws(() => summarizeInterviewRuns(report([{ ...run(1, 2200), jsEncodedBodyBytes: 200_000 }])),
    /do not match/);
  assert.throws(() => summarizeInterviewRuns(report([{ ...run(1, 2200), echoEncodedBodyBytes: null }])),
    /Echo exclusion/);
  assert.throws(() => summarizeInterviewRuns(report([])), /pinned revision/);
});
