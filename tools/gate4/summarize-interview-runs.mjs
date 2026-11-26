import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function percentile(sorted, fraction) {
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeInterviewRuns(report, minimumPerMode = 20) {
  if (!/^[a-f\d]{40}$/i.test(report?.revision ?? "") || !Array.isArray(report.runs) ||
      report.runs.length === 0 ||
      !Number.isSafeInteger(minimumPerMode) || minimumPerMode < 1) {
    throw new Error("A pinned revision, run array, and positive sample requirement are required.");
  }
  const groups = new Map();
  const warnings = [];
  for (const run of report.runs) {
    const mode = run.mode ?? "unspecified";
    if (!Number.isFinite(run.lcpMs) || run.lcpMs < 0 ||
        !Number.isSafeInteger(run.jsEncodedBodyBytes) || run.jsEncodedBodyBytes <= 0 ||
        !Array.isArray(run.js) || !["voice", "typed", "unspecified"].includes(mode)) {
      throw new Error("Run has missing or invalid LCP, JavaScript bytes, resources, or mode.");
    }
    const paths = new Set();
    let sum = 0;
    for (const resource of run.js) {
      if (typeof resource.path !== "string" || paths.has(resource.path) ||
          !Number.isSafeInteger(resource.encodedBodyBytes) || resource.encodedBodyBytes < 0) {
        throw new Error("JavaScript resources need unique paths and nonnegative encoded sizes.");
      }
      paths.add(resource.path);
      sum += resource.encodedBodyBytes;
      if (resource.encodedBodyBytes === 0) warnings.push(`${mode} run ${run.run}: zero-byte resource timing`);
    }
    if (sum !== run.jsEncodedBodyBytes) throw new Error("JavaScript resource sizes do not match the run total.");
    const echoBytes = run.echoRequested ? run.echoEncodedBodyBytes : 0;
    if (!Number.isSafeInteger(echoBytes) || echoBytes < 0 || echoBytes > sum ||
        (run.echoRequested && echoBytes === 0)) {
      throw new Error("Echo exclusion lacks a valid observed byte count.");
    }
    if (!groups.has(mode)) groups.set(mode, []);
    groups.get(mode).push({ lcpMs: run.lcpMs, nonEchoJsBytes: sum - echoBytes,
      echoRequested: run.echoRequested === true });
  }
  const modes = {};
  for (const [mode, runs] of groups) {
    const lcps = runs.map((run) => run.lcpMs).sort((a, b) => a - b);
    const js = runs.map((run) => run.nonEchoJsBytes).sort((a, b) => a - b);
    modes[mode] = {
      count: runs.length, enoughSamples: runs.length >= minimumPerMode,
      lcpMedianMs: median(lcps), lcpP75Ms: percentile(lcps, 0.75),
      lcpP95Ms: percentile(lcps, 0.95), lcpAbove2500Count: lcps.filter((ms) => ms >= 2500).length,
      nonEchoJsMedianBytes: median(js), nonEchoJsMaxBytes: js.at(-1),
      echoRequestCount: runs.filter((run) => run.echoRequested).length,
    };
    if (runs.length < minimumPerMode) warnings.push(`${mode}: ${runs.length}/${minimumPerMode} samples`);
  }
  if (!report.buildId) warnings.push("Production build ID was not recorded.");
  if (!report.finalWebglEcho) warnings.push("Final WebGL Echo was not identified in this report.");
  if (!report.profile || !report.browserVersion) warnings.push("Browser or device profile metadata is missing.");
  return { revision: report.revision, buildId: report.buildId ?? null,
    profile: report.profile ?? null, browserVersion: report.browserVersion ?? null,
    minimumPerMode, modes, warnings,
    note: "Diagnostic summary only. Integrated Gate 4 acceptance needs the agreed device, percentile, final WebGL split, raw traces, and coordinator review.",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node summarize-interview-runs.mjs metrics.json");
    const report = JSON.parse(readFileSync(resolve(process.argv[2]), "utf8"));
    console.log(JSON.stringify(summarizeInterviewRuns(report), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid performance report.");
    process.exitCode = 2;
  }
}
