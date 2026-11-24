import { expect, it } from "vitest";
import { scoreProbeHeldout, syntheticProbeHeldout } from "../evals/probe-heldout.mjs";

it("scores all 60 fictional cases without echoing answer text into the report", () => {
  const { inputs, outputs, judgments } = syntheticProbeHeldout();
  const report = scoreProbeHeldout(inputs, outputs, judgments);
  expect(report).toMatchObject({ sampleSize: 60, probes: 60, acceptable: 60,
    qualityRate: 1, offTopicAnswers: 0, rubricPassed: true });
  expect(JSON.stringify(report)).not.toContain("I hesitated at the last step");
});

it("fails the quality or off-topic rubric with reviewed negative labels", () => {
  const data = syntheticProbeHeldout();
  data.judgments[0].onGoal = false;
  data.judgments[1].offTopicFollowUp = true;
  const report = scoreProbeHeldout(data.inputs, data.outputs, data.judgments);
  expect(report).toMatchObject({ probes: 60, acceptable: 59, offTopicAnswers: 1,
    rubricPassed: false });
});

it("refuses incomplete, duplicate or mismatched held-out evidence", () => {
  const data = syntheticProbeHeldout();
  expect(() => scoreProbeHeldout(data.inputs.slice(1), data.outputs, data.judgments))
    .toThrow("exactly 60 rows");
  const duplicate = [...data.inputs];
  duplicate[1] = { ...duplicate[1], id: duplicate[0].id };
  expect(() => scoreProbeHeldout(duplicate, data.outputs, data.judgments))
    .toThrow("duplicate id");
  const missing = data.judgments.map((row, index) => index === 0
    ? { ...row, reviewerId: "" } : row);
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, missing))
    .toThrow("Incomplete held-out case");
  const mismatched = data.outputs.map((row, index) => index === 0
    ? { ...row, id: "extra-case" } : row);
  expect(() => scoreProbeHeldout(data.inputs, mismatched, data.judgments))
    .toThrow("Incomplete held-out case");
  const noFollowUp = data.judgments.map((row, index) => index === 0
    ? { ...row, followUpAnswerId: null } : row);
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, noFollowUp))
    .toThrow("Incomplete probe judgment");
  const duplicateFollowUp = data.judgments.map((row, index) => index === 1
    ? { ...row, followUpAnswerId: data.judgments[0].followUpAnswerId } : row);
  expect(() => scoreProbeHeldout(data.inputs, data.outputs, duplicateFollowUp))
    .toThrow("Incomplete probe judgment");
});
