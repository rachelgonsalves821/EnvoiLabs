import { createHash } from "node:crypto";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonblank = (value) => typeof value === "string" && value.trim().length > 0;
const actions = new Set(["probe", "next", "error", "timeout"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/i;

function indexed(rows, kind) {
  if (!Array.isArray(rows) || rows.length !== 60) throw new Error(`${kind}: exactly 60 rows required`);
  const result = new Map();
  for (const row of rows) {
    if (!isObject(row) || !nonblank(row.id) || result.has(row.id))
      throw new Error(`${kind}: missing or duplicate id`);
    result.set(row.id, row);
  }
  return result;
}

/** Scores held-out responses without reading provider inputs or raw answers into the report. */
export function scoreProbeHeldout(inputs, outputs, judgments, answerReceipts) {
  const inputById = indexed(inputs, "inputs");
  const outputById = indexed(outputs, "outputs");
  const judgmentById = indexed(judgments, "judgments");
  if (!Array.isArray(answerReceipts)) throw new Error("Answer receipts required");
  const receiptById = new Map();
  for (const receipt of answerReceipts) {
    if (!isObject(receipt) || !nonblank(receipt.id) || !nonblank(receipt.caseId)
      || !uuid.test(receipt.sourceVersion) || !digest.test(receipt.answerDigest)
      || receiptById.has(receipt.id)) throw new Error("Invalid answer receipt");
    receiptById.set(receipt.id, receipt);
  }
  let probes = 0; let acceptable = 0; let offTopicAnswers = 0;
  let noProbes = 0; let errors = 0; let timeouts = 0;
  let appropriateDecisions = 0; let inappropriateNoProbeDecisions = 0;
  const followUpAnswerIds = new Set();
  for (const [id, input] of inputById) {
    const output = outputById.get(id);
    const judgment = judgmentById.get(id);
    if (!nonblank(input.coreQuestion) || !nonblank(input.answer) || !nonblank(input.guideGoal)
      || !output || !judgment || !actions.has(output.action)
      || !nonblank(judgment.reviewerId) || typeof judgment.decisionAppropriate !== "boolean")
      throw new Error("Incomplete held-out case");
    if (judgment.decisionAppropriate) appropriateDecisions++;
    if (output.action === "probe") {
      if (!nonblank(output.text) || !output.text.trim().endsWith("?")
        || typeof judgment.nonLeading !== "boolean" || typeof judgment.onGoal !== "boolean"
        || typeof judgment.offTopicFollowUp !== "boolean"
        || !nonblank(judgment.followUpAnswerId)
        || followUpAnswerIds.has(judgment.followUpAnswerId)
        || receiptById.get(judgment.followUpAnswerId)?.caseId !== id)
        throw new Error("Incomplete probe judgment");
      followUpAnswerIds.add(judgment.followUpAnswerId);
      probes++;
      if (judgment.decisionAppropriate && judgment.nonLeading && judgment.onGoal) acceptable++;
      if (judgment.offTopicFollowUp) offTopicAnswers++;
    } else {
      if (output.text !== undefined || judgment.nonLeading !== null
        || judgment.onGoal !== null || judgment.offTopicFollowUp !== null
        || judgment.followUpAnswerId !== null)
        throw new Error("Invalid no-probe judgment");
      if (output.action === "next") noProbes++;
      if (output.action === "next" && !judgment.decisionAppropriate)
        inappropriateNoProbeDecisions++;
      if (output.action === "error") errors++;
      if (output.action === "timeout") timeouts++;
    }
  }
  if (outputById.size !== inputById.size || judgmentById.size !== inputById.size
    || [...outputById.keys(), ...judgmentById.keys()].some((id) => !inputById.has(id)))
    throw new Error("Held-out case IDs differ");
  if (receiptById.size !== followUpAnswerIds.size
    || [...receiptById.keys()].some((id) => !followUpAnswerIds.has(id)))
    throw new Error("Unmatched answer receipts");
  const qualityRate = probes === 0 ? null : acceptable / probes;
  const probeCoverageRate = probes / inputById.size;
  const decisionAppropriateRate = appropriateDecisions / inputById.size;
  return { mode: "held-out-scoring", sampleSize: 60, probes, acceptable, qualityRate,
    probeCoverageRate, appropriateDecisions, decisionAppropriateRate,
    inappropriateNoProbeDecisions, offTopicAnswers, noProbes, errors, timeouts,
    rubricPassed: probes > 0 && qualityRate >= 0.9 && offTopicAnswers === 0 };
}

/** Repeated fictional examples exercise the pipeline only; they are not independent labels. */
export function syntheticProbeHeldout() {
  const seeds = [
    ["What happened at checkout?", "I hesitated at the last step.", "Checkout friction", "What made you hesitate at checkout?"],
    ["How did you choose delivery?", "I compared the choices.", "Delivery choice", "What mattered in the delivery choice?"],
    ["What did you notice about price?", "The total surprised me.", "Price expectations", "What about the price surprised you?"],
    ["How did support respond?", "I waited for a reply.", "Support experience", "How did support reply?"],
    ["How did you find the details?", "I searched around.", "Product details", "Where did you search for the details?"],
    ["What happened after the cart?", "I looked elsewhere.", "Cart abandonment", "Where did you look after leaving the cart?"],
    ["How did you compare options?", "One option felt simpler.", "Option comparison", "What made that option simpler?"],
    ["What stood out on the page?", "The layout felt crowded.", "Page navigation", "Which part of the layout felt crowded?"],
    ["How did you make the choice?", "I asked a friend first.", "Decision process", "What did you ask your friend?"],
    ["What did you do next?", "I stopped and returned later.", "Next action", "What led you to return later?"],
    ["How was the confirmation?", "The message was unclear.", "Confirmation clarity", "What about the message was unclear?"],
    ["How did you use the search?", "I tried a few terms.", "Search behavior", "Which search terms did you try?"],
  ];
  const inputs = []; const outputs = []; const judgments = []; const answerReceipts = [];
  const variants = ["on a phone", "during a lunch break", "for a small order",
    "on a slow connection", "after comparing two sites"];
  for (const [seedIndex, [coreQuestion, answer, guideGoal, text]] of seeds.entries()) {
    for (const [variantIndex, variant] of variants.entries()) {
      const id = `synthetic-${String(seedIndex + 1).padStart(2, "0")}-${variantIndex + 1}`;
      inputs.push({ id, coreQuestion, answer: `${answer} This happened ${variant}.`, guideGoal });
      outputs.push({ id, action: "probe", text });
      judgments.push({ id, reviewerId: "synthetic-script", decisionAppropriate: true,
        nonLeading: true, onGoal: true, offTopicFollowUp: false,
        followUpAnswerId: `${id}-fictional-follow-up` });
      answerReceipts.push({ id: `${id}-fictional-follow-up`, caseId: id,
        sourceVersion: `a9700000-0000-4000-8000-${String(seedIndex * 5 + variantIndex + 1).padStart(12, "0")}`,
        answerDigest: createHash("sha256").update(`fictional reply ${id}`).digest("hex") });
    }
  }
  return { inputs, outputs, judgments, answerReceipts };
}
