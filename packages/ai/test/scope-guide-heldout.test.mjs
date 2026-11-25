import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scoreGuideHeldout, scoreScopingHeldout, scoreSizingHeldout,
  syntheticScopeGuide, syntheticSizingHeldout } from
  "../evals/scope-guide-heldout.mjs";

it("scores 25 fictional conversations and briefs without echoing private content", () => {
  const { scoping, guide } = syntheticScopeGuide();
  const first = scoreScopingHeldout(scoping.inputs, scoping.outputs, scoping.judgments);
  const second = scoreGuideHeldout(guide.inputs, guide.outputs, guide.judgments);
  expect(first).toMatchObject({ sampleSize: 25, complete: 25,
    priceViolations: 0, priceFreeJudgments: 25, rubricPassed: true });
  expect(second).toMatchObject({ sampleSize: 25, validGuides: 25,
    leadingQuestions: 0, rubricPassed: true });
  expect(JSON.stringify({ first, second })).not.toContain("meal choice");
  expect(JSON.stringify({ first, second })).not.toContain("fictional-script");
});

it("refuses mismatched or duplicate cases and reviewer records", () => {
  const { scoping, guide } = syntheticScopeGuide();
  expect(() => scoreScopingHeldout(scoping.inputs.slice(1), scoping.outputs,
    scoping.judgments)).toThrow("exactly 25 rows");
  scoping.outputs[1].id = scoping.outputs[0].id;
  expect(() => scoreScopingHeldout(scoping.inputs, scoping.outputs,
    scoping.judgments)).toThrow("duplicate id");
  guide.judgments[0].leadingQuestionIndexes = [0, 0];
  expect(() => scoreGuideHeldout(guide.inputs, guide.outputs,
    guide.judgments)).toThrow("Incomplete guide case");
});

it("binds both reviews to their exact private input digests", () => {
  const { scoping, guide } = syntheticScopeGuide();
  scoping.inputs[0].conversation[0].content = "Changed after the model run.";
  expect(() => scoreScopingHeldout(scoping.inputs, scoping.outputs,
    scoping.judgments)).toThrow("Incomplete scoping case");
  guide.inputs[0].brief.title = "Changed after the guide run";
  expect(() => scoreGuideHeldout(guide.inputs, guide.outputs,
    guide.judgments)).toThrow("Incomplete guide case");
});

it("rejects mixed model versions and statements presented as guide questions", () => {
  const { scoping, guide } = syntheticScopeGuide();
  scoping.outputs[0].model = "another-model";
  expect(() => scoreScopingHeldout(scoping.inputs, scoping.outputs,
    scoping.judgments)).toThrow("Mixed scoping model");
  guide.outputs[0].promptVersion = "another-prompt";
  expect(() => scoreGuideHeldout(guide.inputs, guide.outputs,
    guide.judgments)).toThrow("Mixed guide model");
  guide.outputs[0].promptVersion = "fixture-v1";
  guide.outputs[0].coreQuestions[0] = "This is a statement";
  expect(scoreGuideHeldout(guide.inputs, guide.outputs,
    guide.judgments)).toMatchObject({ validGuides: 24, rubricPassed: false });
});

it("fails completeness, price and leading-question thresholds separately", () => {
  const { scoping, guide } = syntheticScopeGuide();
  scoping.judgments[0].completeForDecision = false;
  scoping.judgments[1].completeForDecision = false;
  scoping.judgments[2].completeForDecision = false;
  scoping.outputs[3].agentMessages = ["Try $5 per respondent."];
  scoping.outputs[4].agentMessages = ["Try USD 5 per respondent."];
  scoping.judgments[3].priceFree = false;
  scoping.judgments[4].priceFree = false;
  const first = scoreScopingHeldout(scoping.inputs, scoping.outputs, scoping.judgments);
  expect(first).toMatchObject({ complete: 22, priceViolations: 2,
    priceFreeJudgments: 23,
    rubricPassed: false });
  guide.judgments[0].leadingQuestionIndexes = [1];
  guide.outputs[1].coreQuestions = ["One question?"];
  const second = scoreGuideHeldout(guide.inputs, guide.outputs, guide.judgments);
  expect(second).toMatchObject({ validGuides: 24, leadingQuestions: 1,
    rubricPassed: false });
});

it("requires a reviewer to catch written-out prices that the numeric scan misses", () => {
  const data = syntheticScopeGuide().scoping;
  data.outputs[0].agentMessages = ["Try five dollars per respondent."];
  data.judgments[0].priceFree = false;
  expect(scoreScopingHeldout(data.inputs, data.outputs, data.judgments))
    .toMatchObject({ priceViolations: 0, priceFreeJudgments: 24,
      rubricPassed: false });
});

it("marks the CLI fictional run as a smoke test, not a held-out pass", () => {
  const run = spawnSync(process.execPath,
    [fileURLToPath(new URL("../evals/run-scope-guide-heldout.mjs", import.meta.url)),
      "--synthetic"], { encoding: "utf8" });
  expect(run.status).toBe(0);
  const report = JSON.parse(run.stdout);
  expect(report).toMatchObject({ evidence: "synthetic-pipeline-smoke-only",
    scoping: { rubricPassed: null, fixtureRubricPass: true },
    guide: { rubricPassed: null, fixtureRubricPass: true } });
});

it("requires all ten sizing goals to get reviewed pushback and an alternative", () => {
  const data = syntheticSizingHeldout();
  expect(scoreSizingHeldout(data.inputs, data.outputs, data.judgments))
    .toMatchObject({ sampleSize: 10, pushedBack: 10, alternatives: 10,
      unsupportedNumbers: 0, rubricPassed: true });
  data.judgments[0].pushedBack = false;
  data.judgments[1].offeredQualitativeAlternative = false;
  data.outputs[2].message = "20 percent would buy it.";
  expect(scoreSizingHeldout(data.inputs, data.outputs, data.judgments))
    .toMatchObject({ pushedBack: 9, alternatives: 9, unsupportedNumbers: 1,
      rubricPassed: false });
});

it("rejects switched sizing inputs and labels fictional CLI output as unproved", () => {
  const data = syntheticSizingHeldout();
  data.inputs[0].conversation[0].content = "Changed private sizing goal";
  expect(() => scoreSizingHeldout(data.inputs, data.outputs, data.judgments))
    .toThrow("Incomplete sizing case");
  const run = spawnSync(process.execPath,
    [fileURLToPath(new URL("../evals/run-sizing-heldout.mjs", import.meta.url)),
      "--synthetic"], { encoding: "utf8" });
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toMatchObject({ sampleSize: 10,
    rubricPassed: null, fixtureRubricPass: true,
    evidence: "synthetic-pipeline-smoke-only" });
});
