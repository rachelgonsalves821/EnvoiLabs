import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreAnalystHeldout, syntheticAnalystHeldout } from "../evals/analyst-heldout.mjs";

it("scores ten fictional studies and prints only aggregate evidence", () => {
  const { inputs, outputs, judgments } = syntheticAnalystHeldout();
  expect(outputs[0].decisionQuestionDigest).toBe(createHash("sha256")
    .update(inputs[0].decisionQuestion).digest("hex"));
  const report = scoreAnalystHeldout(inputs, outputs, judgments);
  expect(report).toMatchObject({ sampleSize: 10, themes: 10, quotes: 10,
    verifiedQuotes: 10, countsWithinOne: 10, totalsMatched: 10, rubricPassed: true });
  expect(JSON.stringify(report)).not.toContain("fictional");
  expect(report).not.toHaveProperty("results");
});

it("fails a fabricated quote, source version rotation and count miss", () => {
  const data = syntheticAnalystHeldout();
  data.outputs[0].themes[0].supportingQuotes[0].exactText = "invented";
  data.outputs[1].themes[0].supportingQuotes[0].sourceVersion =
    "a9720000-0000-4000-8000-000000000099";
  data.outputs[2].themes[0].count = 4;
  data.outputs[2].themes[0].total = 4;
  const report = scoreAnalystHeldout(data.inputs, data.outputs, data.judgments);
  expect(report).toMatchObject({ verifiedQuotes: 8, countsWithinOne: 9,
    totalsMatched: 9, rubricPassed: false });
});

it("refuses altered sources, missing labels and mixed model versions", () => {
  const source = syntheticAnalystHeldout();
  source.inputs[0].sources[0].redactedText = "A revised fictional answer.";
  expect(() => scoreAnalystHeldout(source.inputs, source.outputs,
    source.judgments)).toThrow("Incomplete analyst study");
  const label = syntheticAnalystHeldout();
  label.judgments[0].labels = [];
  expect(() => scoreAnalystHeldout(label.inputs, label.outputs,
    label.judgments)).toThrow("Missing analyst hand label");
  const version = syntheticAnalystHeldout();
  version.outputs[0].model = "another-model";
  expect(() => scoreAnalystHeldout(version.inputs, version.outputs,
    version.judgments)).toThrow("Mixed analyst model");
  const question = syntheticAnalystHeldout();
  question.inputs[0].decisionQuestion = "Would a different price change your decision?";
  expect(() => scoreAnalystHeldout(question.inputs, question.outputs,
    question.judgments)).toThrow("Incomplete analyst study");
  const review = syntheticAnalystHeldout();
  review.judgments[0].decisionQuestionDigest = "f".repeat(64);
  expect(() => scoreAnalystHeldout(review.inputs, review.outputs,
    review.judgments)).toThrow("Incomplete analyst study");
});

it("rejects duplicate study and output IDs", () => {
  const data = syntheticAnalystHeldout();
  data.inputs[1].studyId = data.inputs[0].studyId;
  expect(() => scoreAnalystHeldout(data.inputs, data.outputs,
    data.judgments)).toThrow("Incomplete analyst study");
  const duplicate = syntheticAnalystHeldout();
  duplicate.outputs[1].id = duplicate.outputs[0].id;
  expect(() => scoreAnalystHeldout(duplicate.inputs, duplicate.outputs,
    duplicate.judgments)).toThrow("duplicate id");
  const source = syntheticAnalystHeldout();
  source.inputs[0].sources.push({ ...source.inputs[0].sources[0],
    transcriptId: source.inputs[0].sources[0].transcriptId.toUpperCase() });
  expect(() => scoreAnalystHeldout(source.inputs, source.outputs,
    source.judgments)).toThrow("Incomplete analyst study");
});

it("labels the fictional CLI result as unproved", () => {
  const run = spawnSync(process.execPath,
    [fileURLToPath(new URL("../evals/run-analyst-heldout.mjs", import.meta.url)),
      "--synthetic"], { encoding: "utf8" });
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toMatchObject({ sampleSize: 10,
    rubricPassed: null, fixtureRubricPass: true,
    evidence: "synthetic-pipeline-smoke-only" });
});

it("does not promote fictional rows passed as files into independent evidence", () => {
  const data = syntheticAnalystHeldout();
  const files = [data.inputs, data.outputs, data.judgments].map((rows, index) => {
    const path = join(tmpdir(), `envoi-analyst-${randomUUID()}-${index}.json`);
    writeFileSync(path, JSON.stringify(rows));
    return path;
  });
  try {
    const run = spawnSync(process.execPath,
      [fileURLToPath(new URL("../evals/run-analyst-heldout.mjs", import.meta.url)),
        ...files], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ rubricPassed: null,
      scoredRubricPass: true, gateQualified: false,
      evidence: "supplied-labels-unverified" });
  } finally { files.forEach((path) => unlinkSync(path)); }
});
