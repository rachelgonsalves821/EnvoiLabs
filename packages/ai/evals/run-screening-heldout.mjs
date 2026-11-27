import { readFile } from "node:fs/promises";
import { scoreScreeningHeldout, syntheticScreeningHeldout } from "./screening-heldout.mjs";

const args = process.argv.slice(2);
let data;
try {
  if (args.length === 1 && args[0] === "--synthetic") data = syntheticScreeningHeldout();
  else if (args.length === 3) {
    const [inputs, outputs, judgments] = await Promise.all(args.map(async (path) =>
      JSON.parse(await readFile(path, "utf8"))));
    data = { inputs, outputs, judgments };
  } else {
    console.error("Usage: node evals/run-screening-heldout.mjs --synthetic | inputs.json outputs.json judgments.json");
    process.exit(2);
  }
} catch {
  console.error("Unable to read screening held-out files");
  process.exit(2);
}

try {
  const report = scoreScreeningHeldout(data.inputs, data.outputs, data.judgments);
  console.log(JSON.stringify({ ...report,
    evidence: args[0] === "--synthetic"
      ? "synthetic-pipeline-smoke-only" : "reviewer-labels-supplied" }, null, 2));
  // An exclusion-error budget has not been approved. Never issue a pass verdict.
  if (args[0] !== "--synthetic" &&
    (report.safeFallbacks !== report.invalids + report.timeouts
      || report.unclearClearDecisions > 0)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "Invalid screening held-out data");
  process.exitCode = 2;
}
