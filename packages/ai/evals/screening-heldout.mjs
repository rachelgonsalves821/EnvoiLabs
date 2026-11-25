const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const kinds = new Set(["typed", "synthetic_audio"]);
const expected = new Set(["supported", "contradicted", "unclear"]);
const observed = new Set(["supported", "contradicted", "clarify", "review"]);
const outcomes = new Set(["ok", "invalid", "timeout"]);

function indexed(rows, name) {
  if (!Array.isArray(rows) || rows.length < 8 || rows.length % 2 !== 0)
    throw new Error(`${name}: paired typed/audio rows required`);
  const byId = new Map();
  for (const row of rows) {
    if (!object(row) || !text(row.id) || byId.has(row.id))
      throw new Error(`${name}: missing or duplicate id`);
    byId.set(row.id, row);
  }
  return byId;
}

const unresolved = (value) => value === "clarify" || value === "review";
const equivalentDecision = (value) => unresolved(value) ? "unresolved" : value;

/** Aggregate only. Policy must set an acceptable exclusion-error budget before live use. */
export function scoreScreeningHeldout(inputs, outputs, judgments) {
  const inputById = indexed(inputs, "inputs");
  const outputById = indexed(outputs, "outputs");
  const judgmentById = indexed(judgments, "judgments");
  if (inputById.size !== outputById.size || inputById.size !== judgmentById.size
    || [...inputById.keys()].some((id) => !outputById.has(id) || !judgmentById.has(id)))
    throw new Error("Screening case IDs differ");
  const pairs = new Map();
  const versions = new Set();
  const coverage = new Set();
  let interpreted = 0; let agreement = 0; let exclusions = 0;
  let exclusionErrors = 0; let unclearClearDecisions = 0;
  let invalids = 0; let timeouts = 0; let safeFallbacks = 0;
  for (const [id, input] of inputById) {
    const output = outputById.get(id);
    const judgment = judgmentById.get(id);
    if (!text(input.pairId) || !kinds.has(input.kind)
      || !uuid.test(input.sourceVersion) || !digest.test(input.sourceDigest)
      || !output || !judgment || output.sourceDigest !== input.sourceDigest
      || output.sourceVersion !== input.sourceVersion
      || judgment.sourceDigest !== input.sourceDigest
      || judgment.sourceVersion !== input.sourceVersion
      || !text(output.model) || !text(output.promptVersion)
      || !observed.has(output.observed) || !outcomes.has(output.providerOutcome)
      || !text(judgment.reviewerId) || !expected.has(judgment.expected)
      || judgment.equivalentToPair !== true)
      throw new Error("Incomplete screening case");
    versions.add(JSON.stringify([output.model, output.promptVersion]));
    coverage.add(judgment.expected);
    coverage.add(output.providerOutcome);
    const pair = pairs.get(input.pairId) ?? [];
    pair.push({ kind: input.kind, expected: judgment.expected,
      observed: output.observed, providerOutcome: output.providerOutcome });
    pairs.set(input.pairId, pair);
    if (output.observed === "contradicted") {
      exclusions++;
      if (judgment.expected !== "contradicted") exclusionErrors++;
    }
    if (judgment.expected === "unclear" && !unresolved(output.observed))
      unclearClearDecisions++;
    if (output.providerOutcome === "invalid") invalids++;
    if (output.providerOutcome === "timeout") timeouts++;
    if (output.providerOutcome !== "ok") {
      if (unresolved(output.observed)) safeFallbacks++;
    } else {
      interpreted++;
      if (output.observed === judgment.expected
        || (judgment.expected === "unclear" && unresolved(output.observed))) agreement++;
    }
  }
  if (versions.size !== 1) throw new Error("Mixed screening model or prompt versions");
  if (!["supported", "contradicted", "unclear", "invalid", "timeout"]
    .every((item) => coverage.has(item))) throw new Error("Screening label coverage missing");
  let pairedInterpreted = 0; let pairedDisagreements = 0;
  for (const entries of pairs.values()) {
    if (entries.length !== 2 || new Set(entries.map((row) => row.kind)).size !== 2
      || entries[0].expected !== entries[1].expected)
      throw new Error("Typed/audio pair mismatch");
    if (entries.every((row) => row.providerOutcome === "ok")) {
      pairedInterpreted++;
      if (equivalentDecision(entries[0].observed)
        !== equivalentDecision(entries[1].observed)) pairedDisagreements++;
    }
  }
  return { mode: "screening-held-out-scoring", sampleSize: inputById.size,
    pairs: pairs.size, interpreted, agreement, agreementRate: interpreted
      ? agreement / interpreted : null, exclusions, exclusionErrors,
    unclearClearDecisions, invalids, timeouts, safeFallbacks,
    pairedInterpreted, pairedDisagreements,
    safeFallbackRate: invalids + timeouts ? safeFallbacks / (invalids + timeouts) : null,
    exclusionErrorBudget: null, rubricPassed: null };
}

/** Ten fictional rows cover each required class without claiming live quality. */
export function syntheticScreeningHeldout() {
  const inputs = []; const outputs = []; const judgments = [];
  const rows = [
    ["supported", "ok", "supported"],
    ["contradicted", "ok", "contradicted"],
    ["unclear", "ok", "clarify"],
    ["supported", "invalid", "review"],
    ["supported", "timeout", "clarify"],
  ];
  for (const [index, [label, providerOutcome, decision]] of rows.entries()) {
    for (const [kindIndex, kind] of ["typed", "synthetic_audio"].entries()) {
      const id = `fictional-${index + 1}-${kind}`;
      const sourceVersion = `a9700000-0000-4000-8000-${String(index * 2 + kindIndex + 1).padStart(12, "0")}`;
      const sourceDigest = `${String(index * 2 + kindIndex + 1).padStart(64, "0")}`;
      inputs.push({ id, pairId: `fictional-pair-${index + 1}`, kind,
        sourceVersion, sourceDigest });
      outputs.push({ id, sourceVersion, sourceDigest, model: "fictional",
        promptVersion: "fixture-v1", observed: decision, providerOutcome });
      judgments.push({ id, sourceVersion, sourceDigest,
        reviewerId: "fictional-script", expected: label, equivalentToPair: true });
    }
  }
  return { inputs, outputs, judgments };
}
