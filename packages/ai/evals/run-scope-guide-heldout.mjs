import { readFile } from "node:fs/promises";
import { scoreGuideHeldout, scoreScopingHeldout, syntheticScopeGuide } from "./scope-guide-heldout.mjs";

const args = process.argv.slice(2);
let data;
try {
  if (args.length === 1 && args[0] === "--synthetic") data = syntheticScopeGuide();
  else if (args.length === 6) {
    const [scopingInputs, scopingOutputs, scopingJudgments,
      guideInputs, guideOutputs, guideJudgments] = await Promise.all(args.map(async (path) =>
      JSON.parse(await readFile(path, "utf8"))));
    data = { scoping: { inputs: scopingInputs, outputs: scopingOutputs,
      judgments: scopingJudgments }, guide: { inputs: guideInputs,
      outputs: guideOutputs, judgments: guideJudgments } };
  } else {
    console.error("Usage: node evals/run-scope-guide-heldout.mjs --synthetic | scoping-inputs.json scoping-outputs.json scoping-judgments.json guide-inputs.json guide-outputs.json guide-judgments.json");
    process.exit(2);
  }
} catch {
  console.error("Unable to read held-out input files");
  process.exit(2);
}

try {
  const scoping = scoreScopingHeldout(data.scoping.inputs, data.scoping.outputs,
    data.scoping.judgments);
  const guide = scoreGuideHeldout(data.guide.inputs, data.guide.outputs,
    data.guide.judgments);
  const synthetic = args[0] === "--synthetic";
  const annotate = (result) => synthetic
    ? { ...result, rubricPassed: null, fixtureRubricPass: result.rubricPassed }
    : result;
  console.log(JSON.stringify({ evidence: synthetic ? "synthetic-pipeline-smoke-only"
    : "reviewer-labels-supplied", scoping: annotate(scoping), guide: annotate(guide) }, null, 2));
  if (!synthetic && (!scoping.rubricPassed || !guide.rubricPassed)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid held-out input");
  process.exitCode = 2;
}
