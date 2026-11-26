import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scoreProbeHeldout, syntheticProbeHeldout } from "../evals/probe-heldout.mjs";

it("scores all 60 fictional cases without echoing answer text into the report", () => {
  const { inputs, outputs, judgments, answerReceipts } = syntheticProbeHeldout();
  const report = scoreProbeHeldout(inputs, outputs, judgments, answerReceipts);
  expect(report).toMatchObject({ sampleSize: 60, probes: 60, acceptable: 60,
    model: "synthetic-script", promptVersion: "synthetic-v1",
    qualityRate: 1, probeCoverageRate: 1, appropriateDecisions: 60,
    decisionAppropriateRate: 1, inappropriateNoProbeDecisions: 0,
    offTopicAnswers: 0, rubricPassed: true });
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

it("does not promote the fictional 60 rows passed as files into pilot evidence", () => {
  const data = syntheticProbeHeldout();
  const files = [data.inputs, data.outputs, data.judgments, data.answerReceipts]
    .map((rows, index) => {
      const path = join(tmpdir(), `envoi-probe-${randomUUID()}-${index}.json`);
      writeFileSync(path, JSON.stringify(rows));
      return path;
    });
  try {
    const run = spawnSync(process.execPath,
      [fileURLToPath(new URL("../evals/run-probe-heldout.mjs", import.meta.url)),
        ...files], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ rubricPassed: null,
      scoredRubricPass: true, gateQualified: false,
      evidence: "supplied-labels-unverified" });
  } finally { files.forEach((path) => unlinkSync(path)); }
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

it("reports inappropriate skipped probes separately from emitted-probe quality", () => {
  const data = syntheticProbeHeldout();
  for (const [index, appropriate] of [false, true].entries()) {
    data.outputs[index] = { ...data.outputs[index], action: "next", text: undefined };
    data.judgments[index] = { ...data.judgments[index], decisionAppropriate: appropriate,
      nonLeading: null, onGoal: null, offTopicFollowUp: null, followUpAnswerId: null };
  }
  data.answerReceipts.splice(0, 2);
  const report = scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    data.answerReceipts);
  expect(report).toMatchObject({ probes: 58, noProbes: 2, acceptable: 58,
    qualityRate: 1, probeCoverageRate: 58 / 60, appropriateDecisions: 59,
    decisionAppropriateRate: 59 / 60, inappropriateNoProbeDecisions: 1 });
  // The documented 90% target judges emitted probes. Decision coverage and
  // skipped opportunities remain visible for the separate human review.
  expect(report.rubricPassed).toBe(true);
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
  expect(() => scoreProbeHeldout(data.inputs, [
    { ...data.outputs[0], sourceVersion: data.inputs[1].sourceVersion },
    ...data.outputs.slice(1)], data.judgments, data.answerReceipts))
    .toThrow("Held-out source or model provenance differs");
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, [
    { ...data.judgments[0], answerDigest: "f".repeat(64) },
    ...data.judgments.slice(1)], data.answerReceipts))
    .toThrow("Held-out source or model provenance differs");
  expect(() => scoreProbeHeldout(data.inputs, [
    data.outputs[0], { ...data.outputs[1], promptVersion: "other-prompt" },
    ...data.outputs.slice(2)], data.judgments, data.answerReceipts))
    .toThrow("Mixed held-out model or prompt versions");
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    [{ ...data.answerReceipts[0], parentSourceVersion: data.inputs[1].sourceVersion },
      ...data.answerReceipts.slice(1)])).toThrow("Incomplete probe judgment");
});
