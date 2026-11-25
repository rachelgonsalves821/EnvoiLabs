import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scoreScreeningHeldout, syntheticScreeningHeldout } from "../evals/screening-heldout.mjs";

it("counts typed and synthetic-audio decisions without exposing row data or claiming a pass", () => {
  const data = syntheticScreeningHeldout();
  const score = scoreScreeningHeldout(data.inputs, data.outputs, data.judgments);
  expect(score).toMatchObject({ sampleSize: 10, pairs: 5, interpreted: 6,
    agreement: 6, exclusions: 2, exclusionErrors: 0, invalids: 2,
    timeouts: 2, safeFallbacks: 4, pairedDisagreements: 0,
    exclusionErrorBudget: null, rubricPassed: null });
  expect(JSON.stringify(score)).not.toContain("fictional");
  expect(score).not.toHaveProperty("results");
});

it("detects wrongful exclusion, unclear decisions and typed/audio disagreement", () => {
  const data = syntheticScreeningHeldout();
  data.outputs[0].observed = "contradicted";
  data.outputs[4].observed = "supported";
  const score = scoreScreeningHeldout(data.inputs, data.outputs, data.judgments);
  expect(score).toMatchObject({ exclusionErrors: 1, unclearClearDecisions: 1,
    pairedDisagreements: 2 });
});

it("counts unsafe provider fallback independently from model agreement", () => {
  const data = syntheticScreeningHeldout();
  data.outputs[6].observed = "contradicted";
  const score = scoreScreeningHeldout(data.inputs, data.outputs, data.judgments);
  expect(score).toMatchObject({ invalids: 2, timeouts: 2, safeFallbacks: 3,
    exclusionErrors: 1 });
});

it("rejects rotated source versions, pair defects and mixed model versions", () => {
  const source = syntheticScreeningHeldout();
  source.outputs[0].sourceVersion = "a9700000-0000-4000-8000-000000000099";
  expect(() => scoreScreeningHeldout(source.inputs, source.outputs,
    source.judgments)).toThrow("Incomplete screening case");
  const pair = syntheticScreeningHeldout();
  pair.inputs[1].kind = "typed";
  expect(() => scoreScreeningHeldout(pair.inputs, pair.outputs,
    pair.judgments)).toThrow("Typed/audio pair mismatch");
  const version = syntheticScreeningHeldout();
  version.outputs[0].model = "different";
  expect(() => scoreScreeningHeldout(version.inputs, version.outputs,
    version.judgments)).toThrow("Mixed screening model");
});

it("runs fictional aggregate-only smoke", () => {
  const run = spawnSync(process.execPath,
    [fileURLToPath(new URL("../evals/run-screening-heldout.mjs", import.meta.url)),
      "--synthetic"], { encoding: "utf8" });
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toMatchObject({ sampleSize: 10,
    rubricPassed: null, evidence: "synthetic-pipeline-smoke-only" });
});
