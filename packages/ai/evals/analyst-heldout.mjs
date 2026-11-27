import { createHash } from "node:crypto";
import { verifyEvidence } from "../src/report-evidence.ts";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const shaText = (value) => createHash("sha256").update(value).digest("hex");

function indexed(rows, name) {
  if (!Array.isArray(rows) || rows.length !== 10) throw new Error(`${name}: exactly 10 studies required`);
  const indexedRows = new Map();
  for (const row of rows) {
    if (!object(row) || !text(row.id) || indexedRows.has(row.id))
      throw new Error(`${name}: missing or duplicate id`);
    indexedRows.set(row.id, row);
  }
  return indexedRows;
}

function mappedContext(input, output, judgment) {
  const fields = [input.hypotheses, input.guideQuestions, output.mapPromptVersion,
    output.mapPromptDigest, output.briefDigest, output.mapCount, output.mapEvidence,
    judgment.briefDigest];
  if (fields.every((value) => value === undefined)) return null;
  if (!Array.isArray(input.hypotheses) || input.hypotheses.length === 0
    || !input.hypotheses.every(text)
    || !Array.isArray(input.guideQuestions) || input.guideQuestions.length < 4
    || input.guideQuestions.length > 10
    || !input.guideQuestions.every((question) => object(question)
      && uuid.test(question.id) && text(question.text))
    || new Set(input.guideQuestions.map((question) => question.id.toLowerCase())).size
      !== input.guideQuestions.length
    || !text(output.mapPromptVersion) || !digest.test(output.mapPromptDigest)
    || !digest.test(output.briefDigest) || output.briefDigest !== judgment.briefDigest
    || output.briefDigest !== sha({ decisionQuestion: input.decisionQuestion,
      hypotheses: input.hypotheses, guideQuestions: input.guideQuestions })
    || output.mapCount !== input.sources.length || !Array.isArray(output.mapEvidence))
    throw new Error("Incomplete mapped analyst provenance");
  for (const source of input.sources) {
    if (!uuid.test(source.questionId)
      || !input.guideQuestions.some((question) => question.id === source.questionId))
      throw new Error("Invalid mapped guide binding");
  }
  for (const evidence of output.mapEvidence) {
    const source = input.sources.find((item) => item.transcriptId === evidence?.transcriptId);
    if (!object(evidence) || !source || evidence.sourceVersion !== source.sourceVersion
      || evidence.questionId !== source.questionId
      || !Number.isSafeInteger(evidence.startChar) || !Number.isSafeInteger(evidence.endChar)
      || evidence.startChar < 0 || evidence.endChar <= evidence.startChar
      || !text(evidence.exactText)
      || Array.from(source.redactedText).slice(evidence.startChar, evidence.endChar).join("")
        !== evidence.exactText) throw new Error("Invalid mapped evidence span");
  }
  return { promptVersion: output.mapPromptVersion, promptDigest: output.mapPromptDigest,
    evidence: output.mapEvidence };
}

function quoteWasMapped(quote, mapped) {
  return !mapped || mapped.evidence.some((evidence) => evidence.transcriptId === quote.transcriptId
    && evidence.sourceVersion === quote.sourceVersion && evidence.startChar === quote.startChar
    && evidence.endChar === quote.endChar && evidence.exactText === quote.exactText);
}

/** Exact redacted-span and hand-count scorer; the reviewer/source records remain private. */
export function scoreAnalystHeldout(inputs, outputs, judgments) {
  const inputById = indexed(inputs, "inputs");
  const outputById = indexed(outputs, "outputs");
  const judgmentById = indexed(judgments, "judgments");
  const versions = new Set();
  const studyIds = new Set();
  const transcriptIds = new Set();
  const sourceVersions = new Set();
  let quotes = 0; let verifiedQuotes = 0; let themes = 0;
  let countsWithinOne = 0; let totalsMatched = 0;
  for (const [id, input] of inputById) {
    const output = outputById.get(id);
    const judgment = judgmentById.get(id);
    if (!uuid.test(input.studyId) || studyIds.has(input.studyId.toLowerCase())
      || !text(input.decisionQuestion)
      || !Array.isArray(input.sources) || input.sources.length === 0
      || !input.sources.every((source) => object(source)
        && source.studyId === input.studyId && uuid.test(source.transcriptId)
        && uuid.test(source.sourceVersion) && text(source.redactedText)
        && source.published === true && source.withdrawn === false)
      || new Set(input.sources.map((source) => source.transcriptId.toLowerCase())).size !== input.sources.length
      || !output || !judgment || !digest.test(output.sourceDigest)
      || output.sourceDigest !== sha(input.sources)
      || judgment.sourceDigest !== output.sourceDigest
      || output.decisionQuestionDigest !== shaText(input.decisionQuestion)
      || judgment.decisionQuestionDigest !== output.decisionQuestionDigest
      || !text(output.model) || !text(output.promptVersion)
      || !text(judgment.reviewerId) || !Array.isArray(output.themes)
      || output.themes.length === 0 || !Array.isArray(judgment.labels))
      throw new Error("Incomplete analyst study");
    for (const source of input.sources) {
      if (transcriptIds.has(source.transcriptId.toLowerCase())
        || sourceVersions.has(source.sourceVersion.toLowerCase()))
        throw new Error("Repeated analyst source across studies");
      transcriptIds.add(source.transcriptId.toLowerCase());
      sourceVersions.add(source.sourceVersion.toLowerCase());
    }
    studyIds.add(input.studyId.toLowerCase());
    const mapped = mappedContext(input, output, judgment);
    versions.add(JSON.stringify([output.model, output.promptVersion,
      mapped?.promptVersion ?? null, mapped?.promptDigest ?? null]));
    const labels = new Map();
    for (const label of judgment.labels) {
      if (!object(label) || !text(label.labelId) || labels.has(label.labelId)
        || !Number.isSafeInteger(label.handCount) || label.handCount <= 0
        || !Number.isSafeInteger(label.handTotal) || label.handTotal <= 0
        || label.handCount > label.handTotal)
        throw new Error("Invalid analyst hand label");
      labels.set(label.labelId, label);
    }
    if (labels.size !== output.themes.length) throw new Error("Missing analyst hand label");
    const seen = new Set();
    for (const theme of output.themes) {
      if (!object(theme) || !text(theme.labelId) || seen.has(theme.labelId)
        || !labels.has(theme.labelId) || !Number.isSafeInteger(theme.count)
        || theme.count <= 0 || !Number.isSafeInteger(theme.total) || theme.total <= 0
        || theme.count > theme.total || !Array.isArray(theme.supportingQuotes)
        || theme.supportingQuotes.length === 0 || !Array.isArray(theme.contradictingQuotes))
        throw new Error("Invalid analyst theme match");
      seen.add(theme.labelId);
      const label = labels.get(theme.labelId);
      themes++;
      if (Math.abs(theme.count - label.handCount) <= 1) countsWithinOne++;
      if (theme.total === label.handTotal) totalsMatched++;
      for (const quote of [...theme.supportingQuotes, ...theme.contradictingQuotes]) {
        quotes++;
        if (quoteWasMapped(quote, mapped)
          && verifyEvidence(input.studyId, [quote], input.sources)[0]?.action === "accept")
          verifiedQuotes++;
      }
    }
    if (seen.size !== labels.size) throw new Error("Missing analyst hand label");
  }
  if ([...outputById.keys(), ...judgmentById.keys()].some((id) => !inputById.has(id)))
    throw new Error("Analyst study IDs differ");
  if (versions.size !== 1) throw new Error("Mixed analyst model or prompt versions");
  return { mode: "analyst-held-out-scoring", sampleSize: 10, themes, quotes,
    verifiedQuotes, countsWithinOne, totalsMatched,
    rubricPassed: quotes > 0 && verifiedQuotes === quotes
      && countsWithinOne === themes && totalsMatched === themes };
}

/** Ten fictional, repeated studies test wiring only and are not independent evidence. */
export function syntheticAnalystHeldout() {
  const inputs = []; const outputs = []; const judgments = [];
  for (let n = 1; n <= 10; n++) {
    const id = `fictional-${n}`;
    const studyId = `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const transcriptId = `a9710000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const sourceVersion = `a9720000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const sources = [{ studyId, transcriptId, sourceVersion,
      redactedText: "A fictional answer.", published: true, withdrawn: false }];
    const sourceDigest = sha(sources);
    const quote = { studyId, transcriptId, sourceVersion, startChar: 2,
      endChar: 11, exactText: "fictional", rationale: "Fictional reviewer context",
      confidence: 0.9 };
    const decisionQuestion = "Would a clear receipt change your decision?";
    const decisionQuestionDigest = shaText(decisionQuestion);
    inputs.push({ id, studyId, decisionQuestion, sources });
    outputs.push({ id, sourceDigest, decisionQuestionDigest,
      model: "fictional", promptVersion: "fixture-v1",
      themes: [{ labelId: "theme-1", count: 1, total: 1,
        supportingQuotes: [quote], contradictingQuotes: [] }] });
    judgments.push({ id, sourceDigest, decisionQuestionDigest,
      reviewerId: "fictional-script",
      labels: [{ labelId: "theme-1", handCount: 1, handTotal: 1 }] });
  }
  return { inputs, outputs, judgments };
}
