import { readFile } from "node:fs/promises";
import { scoreSizingHeldout, syntheticSizingHeldout } from "./scope-guide-heldout.mjs";

const args = process.argv.slice(2);
let data;
try {
  if (args.length === 1 && args[0] === "--synthetic") data = syntheticSizingHeldout();
  else if (args.length === 3) {
    const [inputs, outputs, judgments] = await Promise.all(args.map(async (path) =>
      JSON.parse(await readFile(path, "utf8"))));
    data = { inputs, outputs, judgments };
  } else {
    console.error("Usage: node evals/run-sizing-heldout.mjs --synthetic | inputs.json outputs.json judgments.json");
    process.exit(2);
  }
} catch {
  console.error("Unable to read sizing held-out files");
  process.exit(2);
}

try {
  const report = scoreSizingHeldout(data.inputs, data.outputs, data.judgments);
  const synthetic = args[0] === "--synthetic";
  console.log(JSON.stringify(synthetic
    ? { ...report, rubricPassed: null, fixtureRubricPass: report.rubricPassed,
      evidence: "synthetic-pipeline-smoke-only" }
    : { ...report, evidence: "reviewer-labels-supplied" }, null, 2));
  if (!synthetic && !report.rubricPassed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid sizing held-out data");
  process.exitCode = 2;
}
