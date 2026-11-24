import { readFile } from "node:fs/promises";
import { scoreProbeHeldout, syntheticProbeHeldout } from "./probe-heldout.mjs";

const arguments_ = process.argv.slice(2);
let data;
try {
  if (arguments_.length === 1 && arguments_[0] === "--synthetic") {
    data = syntheticProbeHeldout();
  } else if (arguments_.length === 4) {
    const [inputsPath, outputsPath, judgmentsPath, receiptsPath] = arguments_;
    data = {
      inputs: JSON.parse(await readFile(inputsPath, "utf8")),
      outputs: JSON.parse(await readFile(outputsPath, "utf8")),
      judgments: JSON.parse(await readFile(judgmentsPath, "utf8")),
      answerReceipts: JSON.parse(await readFile(receiptsPath, "utf8")),
    };
  } else {
    console.error("Usage: node evals/run-probe-heldout.mjs --synthetic | inputs.json outputs.json judgments.json answer-receipts.json");
    process.exit(2);
  }
} catch {
  console.error("Unable to read held-out input files");
  process.exit(2);
}
try {
  const report = scoreProbeHeldout(data.inputs, data.outputs, data.judgments,
    data.answerReceipts);
  const synthetic = arguments_[0] === "--synthetic";
  console.log(JSON.stringify(synthetic
    ? { ...report, rubricPassed: null, fixtureRubricPass: report.rubricPassed,
      evidence: "synthetic-pipeline-smoke-only" }
    : { ...report, evidence: "reviewer-labels-supplied" }, null, 2));
  if (!report.rubricPassed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid held-out input");
  process.exitCode = 2;
}
