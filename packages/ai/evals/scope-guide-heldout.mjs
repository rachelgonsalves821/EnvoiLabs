import { createHash } from "node:crypto";
import { BriefSchema, GuideDraftSchema } from "@envoi-labs/contracts";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const digest = /^[0-9a-f]{64}$/;
const price = /(?:[$€£]\s*\d+(?:\.\d+)?|\b(?:usd|cad)\s*\d+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\s*(?:dollars?|usd|cad|cents?)\b)/i;
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function index(rows, name) {
  if (!Array.isArray(rows) || rows.length !== 25) throw new Error(`${name}: exactly 25 rows required`);
  const byId = new Map();
  for (const row of rows) {
    if (!object(row) || !text(row.id) || byId.has(row.id))
      throw new Error(`${name}: missing or duplicate id`);
    byId.set(row.id, row);
  }
  return byId;
}

function matchingRows(inputs, outputs, judgments) {
  const inputById = index(inputs, "inputs");
  const outputById = index(outputs, "outputs");
  const judgmentById = index(judgments, "judgments");
  if ([...inputById.keys()].some((id) => !outputById.has(id) || !judgmentById.has(id)))
    throw new Error("Held-out case IDs differ");
  return { inputById, outputById, judgmentById };
}

function versions(output) {
  return text(output.model) && text(output.promptVersion);
}

/** Aggregate only. The real conversation, model output and adjudication stay private. */
export function scoreScopingHeldout(inputs, outputs, judgments) {
  const { inputById, outputById, judgmentById } = matchingRows(inputs, outputs, judgments);
  let complete = 0; let priceViolations = 0; let invalidBriefs = 0;
  const pinnedVersions = new Set();
  for (const [id, input] of inputById) {
    const output = outputById.get(id);
    const judgment = judgmentById.get(id);
    if (!Array.isArray(input.conversation) || input.conversation.length === 0
      || !input.conversation.every((message) => object(message)
        && ["researcher", "agent"].includes(message.role) && text(message.content))
      || !output || !judgment || !versions(output)
      || !digest.test(output.inputDigest) || output.inputDigest !== sha(input.conversation)
      || judgment.inputDigest !== output.inputDigest || !text(judgment.reviewerId)
      || typeof judgment.completeForDecision !== "boolean"
      || !Array.isArray(output.agentMessages) || output.agentMessages.length === 0
      || !output.agentMessages.every(text)) throw new Error("Incomplete scoping case");
    pinnedVersions.add(JSON.stringify([output.model, output.promptVersion]));
    const valid = BriefSchema.safeParse(output.brief).success
      && output.brief.targetCompletes >= 10;
    if (!valid) invalidBriefs++;
    if (valid && judgment.completeForDecision) complete++;
    if (output.agentMessages.some((message) => price.test(message))) priceViolations++;
  }
  if (pinnedVersions.size !== 1) throw new Error("Mixed scoping model or prompt versions");
  const completenessRate = complete / 25;
  return { mode: "scoping-held-out-scoring", sampleSize: 25, complete,
    completenessRate, invalidBriefs, priceViolations,
    rubricPassed: completenessRate >= 0.9 && priceViolations === 0 };
}

/** A reviewer labels leading questions; the contract checks the 6-8 question shape. */
export function scoreGuideHeldout(inputs, outputs, judgments) {
  const { inputById, outputById, judgmentById } = matchingRows(inputs, outputs, judgments);
  let validGuides = 0; let leadingQuestions = 0;
  const pinnedVersions = new Set();
  for (const [id, input] of inputById) {
    const output = outputById.get(id);
    const judgment = judgmentById.get(id);
    if (!BriefSchema.safeParse(input.brief).success || !output || !judgment
      || !versions(output) || !digest.test(output.inputDigest)
      || output.inputDigest !== sha(input.brief)
      || judgment.inputDigest !== output.inputDigest || !text(judgment.reviewerId)
      || !Array.isArray(judgment.leadingQuestionIndexes)
      || !judgment.leadingQuestionIndexes.every((index) => Number.isSafeInteger(index)
        && index >= 0 && Array.isArray(output.coreQuestions)
        && index < output.coreQuestions.length)
      || new Set(judgment.leadingQuestionIndexes).size !== judgment.leadingQuestionIndexes.length)
      throw new Error("Incomplete guide case");
    pinnedVersions.add(JSON.stringify([output.model, output.promptVersion]));
    if (GuideDraftSchema.safeParse({ coreQuestions: output.coreQuestions }).success
      && output.coreQuestions.every((question) => question.trim().endsWith("?")))
      validGuides++;
    leadingQuestions += judgment.leadingQuestionIndexes.length;
  }
  if (pinnedVersions.size !== 1) throw new Error("Mixed guide model or prompt versions");
  return { mode: "guide-held-out-scoring", sampleSize: 25, validGuides,
    leadingQuestions, rubricPassed: validGuides === 25 && leadingQuestions === 0 };
}

/** Fictional repeated cases prove the scorer wiring only, never independent quality. */
export function syntheticScopeGuide() {
  const brief = { title: "Fictional meal choice", decision: "Which choice was confusing?",
    hypotheses: ["Delivery clarity matters."],
    criteria: [{ kind: "must", text: "Ordered a meal recently" }],
    targetCompletes: 10, stimulus: null, deadlineAt: "2030-01-01T00:00:00.000Z" };
  const questions = ["What were you looking for?", "What options did you compare?",
    "How did you decide?", "What was confusing?", "What happened next?",
    "What would you change?"];
  const scoping = { inputs: [], outputs: [], judgments: [] };
  const guide = { inputs: [], outputs: [], judgments: [] };
  for (let n = 1; n <= 25; n++) {
    const id = `fictional-${String(n).padStart(2, "0")}`;
    const conversation = [{ role: "researcher", content: `I want to understand meal choice ${n}.` },
      { role: "agent", content: "What decision will this research support?" }];
    const scopingDigest = sha(conversation);
    scoping.inputs.push({ id, conversation });
    scoping.outputs.push({ id, inputDigest: scopingDigest, brief: structuredClone(brief),
      agentMessages: ["What made that decision difficult?"],
      model: "fictional", promptVersion: "fixture-v1" });
    scoping.judgments.push({ id, inputDigest: scopingDigest,
      reviewerId: "fictional-script", completeForDecision: true });
    const guideDigest = sha(brief);
    guide.inputs.push({ id, brief: structuredClone(brief) });
    guide.outputs.push({ id, inputDigest: guideDigest, coreQuestions: [...questions],
      model: "fictional", promptVersion: "fixture-v1" });
    guide.judgments.push({ id, inputDigest: guideDigest,
      reviewerId: "fictional-script", leadingQuestionIndexes: [] });
  }
  return { scoping, guide };
}
