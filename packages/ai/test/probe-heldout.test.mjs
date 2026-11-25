import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scoreProbeHeldout, syntheticProbeHeldout } from "../evals/probe-heldout.mjs";

it("scores all 60 fictional cases without echoing answer text into the report", () => {
  const { inputs, outputs, judgments, answerReceipts } = syntheticProbeHeldout();
  const report = scoreProbeHeldout(inputs, outputs, judgments, answerReceipts);
  expect(report).toMatchObject({ sampleSize: 60, probes: 60, acceptable: 60,
    qualityRate: 1, offTopicAnswers: 0, rubricPassed: true });
  expect(JSON.stringify(report)).not.toContain("I hesitated at the last step");
  expect(report).not.toHaveProperty("results");
});

it("never prints case, answer or reviewer identifiers even when supplied incorrectly", () => {
  const data = syntheticProbeHeldout();
  const privateId = "fictional.person@example.invalid";
  const privateAnswerId = "fictional.answer@example.invalid";
  data.inputs[0].id = privateId;
  data.outputs[0].id = privateId;
  data.judgments[0].id = privateId;
  data.judgments[0].reviewerId = "fictional.reviewer@example.invalid";
  data.judgments[0].followUpAnswerId = privateAnswerId;
  data.answerReceipts[0].id = privateAnswerId;
  data.answerReceipts[0].caseId = privateId;
  const report = scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    data.answerReceipts);
  expect(report.rubricPassed).toBe(true);
  expect(JSON.stringify(report)).not.toContain("example.invalid");
});

it("labels the CLI fixture replay without a pilot rubric pass", () => {
  const run = spawnSync(process.execPath,
    [fileURLToPath(new URL("../evals/run-probe-heldout.mjs", import.meta.url)), "--synthetic"],
    { encoding: "utf8" });
  expect(run.status).toBe(0);
  const output = JSON.parse(run.stdout);
  expect(output).toMatchObject({ evidence: "synthetic-pipeline-smoke-only",
    rubricPassed: null, fixtureRubricPass: true, sampleSize: 60 });
});

it("fails the quality or off-topic rubric with reviewed negative labels", () => {
  const data = syntheticProbeHeldout();
  data.judgments[0].onGoal = false;
  data.judgments[1].offTopicFollowUp = true;
  const report = scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    data.answerReceipts);
  expect(report).toMatchObject({ probes: 60, acceptable: 59, offTopicAnswers: 1,
    rubricPassed: false });
});

it("refuses incomplete, duplicate or mismatched held-out evidence", () => {
  const data = syntheticProbeHeldout();
  expect(() => scoreProbeHeldout(data.inputs.slice(1), data.outputs, data.judgments,
    data.answerReceipts))
    .toThrow("exactly 60 rows");
  const duplicate = [...data.inputs];
  duplicate[1] = { ...duplicate[1], id: duplicate[0].id };
  expect(() => scoreProbeHeldout(duplicate, data.outputs, data.judgments,
    data.answerReceipts))
    .toThrow("duplicate id");
  const missing = data.judgments.map((row, index) => index === 0
    ? { ...row, reviewerId: "" } : row);
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, missing,
    data.answerReceipts))
    .toThrow("Incomplete held-out case");
  const mismatched = data.outputs.map((row, index) => index === 0
    ? { ...row, id: "extra-case" } : row);
  expect(() => scoreProbeHeldout(data.inputs, mismatched, data.judgments,
    data.answerReceipts))
    .toThrow("Incomplete held-out case");
  const noFollowUp = data.judgments.map((row, index) => index === 0
    ? { ...row, followUpAnswerId: null } : row);
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, noFollowUp,
    data.answerReceipts))
    .toThrow("Incomplete probe judgment");
  const duplicateFollowUp = data.judgments.map((row, index) => index === 1
    ? { ...row, followUpAnswerId: data.judgments[0].followUpAnswerId } : row);
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, duplicateFollowUp,
    data.answerReceipts))
    .toThrow("Incomplete probe judgment");
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    data.answerReceipts.slice(1))).toThrow("Incomplete probe judgment");
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    [{ ...data.answerReceipts[0], caseId: data.inputs[1].id },
      ...data.answerReceipts.slice(1)])).toThrow("Incomplete probe judgment");
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    [...data.answerReceipts, data.answerReceipts[0]])).toThrow("Invalid answer receipt");
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    [{ ...data.answerReceipts[0], sourceVersion: "not-a-uuid" },
      ...data.answerReceipts.slice(1)])).toThrow("Invalid answer receipt");
});
