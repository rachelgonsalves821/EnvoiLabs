import type { LLMProvider, LLMRequest, LLMResponse } from "./index.js";
import { analystDeadline } from "./analyst-deadline.js";
import { analystTextDigest, type AnalystDraftPort, type AnalystDraftResult,
  type AnalystSourceSnapshot } from "./analyst-draft.js";
import { screenAnalystV2Evidence, type ScreenedAnalystEvidence } from
  "./analyst-evidence-screen.js";

type Code = { readonly label: string; readonly hypothesis: string | null;
  readonly startChar: number; readonly endChar: number; readonly exactText: string };
type MapOutput = { readonly version: 1; readonly transcriptId: string;
  readonly sourceVersion: string; readonly questionId: string; readonly codes: readonly Code[] };

export interface AnalystMapReduceInput {
  readonly studyId: string;
  readonly providerModel: string;
  /** Overall private draft deadline, including source and purpose rechecks. */
  readonly timeoutMs: number;
  readonly mapPromptVersion: string;
  readonly mapSystemPrompt: string;
  readonly reducePromptVersion: string;
  readonly reduceSystemPrompt: string;
}

export interface AnalystMapReduceSnapshot extends AnalystSourceSnapshot {
  /** Frozen reviewed brief and guide; Platform binds these to the study version. */
  readonly hypotheses: readonly string[];
  readonly guideQuestions: readonly { readonly id: string; readonly text: string }[];
  readonly sources: readonly (AnalystSourceSnapshot["sources"][number] & {
    readonly questionId: string })[];
}

export interface AnalystMapReducePort extends AnalystDraftPort {
  readCurrent(studyId: string): Promise<AnalystMapReduceSnapshot | null>;
}

export interface AnalystMapReduceDraft extends AnalystDraftResult {
  readonly mapPromptVersion: string;
  readonly mapPromptDigest: string;
  readonly mapCount: number;
  readonly briefDigest: string;
  readonly mapEvidence: readonly { readonly transcriptId: string;
    readonly sourceVersion: string; readonly questionId: string;
    readonly startChar: number; readonly endChar: number;
    readonly exactText: string }[];
  readonly sources: readonly (AnalystDraftResult["sources"][number] & {
    readonly questionId: string })[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/i;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).sort().join(",") === [...expected].sort().join(",");
const nonblank = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function validSnapshot(value: AnalystMapReduceSnapshot | null, studyId: string): value is AnalystMapReduceSnapshot {
  if (!value || value.studyId !== studyId || !nonblank(value.decisionQuestion)
    || !Array.isArray(value.sources) || value.sources.length === 0
    || !Array.isArray(value.hypotheses) || value.hypotheses.length === 0
    || !value.hypotheses.every(nonblank)
    || !Array.isArray(value.guideQuestions) || value.guideQuestions.length < 4
    || value.guideQuestions.length > 10 || !value.guideQuestions.every((question) =>
      question && uuid.test(question.id) && nonblank(question.text))) return false;
  if (new Set(value.guideQuestions.map((question) => question.id.toLowerCase())).size
    !== value.guideQuestions.length) return false;
  const seen = new Set<string>();
  const first = value.sources[0];
  for (const source of value.sources) {
    if (!source || source.studyId !== studyId || !uuid.test(source.transcriptId)
      || !uuid.test(source.sourceVersion) || !nonblank(source.redactedText)
      || !value.guideQuestions.some((question) => question.id === source.questionId)
      || !digest.test(source.policyDigest) || !digest.test(source.qualificationDigest)
      || source.policyDigest !== first?.policyDigest
      || source.qualificationDigest !== first?.qualificationDigest
      || seen.has(source.transcriptId.toLowerCase())) return false;
    seen.add(source.transcriptId.toLowerCase());
  }
  return true;
}

function freezeSnapshot(value: AnalystMapReduceSnapshot): AnalystMapReduceSnapshot {
  return Object.freeze({ studyId: value.studyId, decisionQuestion: value.decisionQuestion,
    hypotheses: Object.freeze([...value.hypotheses]),
    guideQuestions: Object.freeze(value.guideQuestions.map((question) =>
      Object.freeze({ id: question.id, text: question.text }))),
    sources: Object.freeze(value.sources.map((source) => Object.freeze({ ...source }))) });
}

function sameSnapshot(left: AnalystMapReduceSnapshot, right: AnalystMapReduceSnapshot): boolean {
  const canonical = (value: AnalystMapReduceSnapshot) => JSON.stringify({
    studyId: value.studyId, decisionQuestion: value.decisionQuestion,
    hypotheses: value.hypotheses, guideQuestions: value.guideQuestions,
    sources: [...value.sources].sort((a, b) => a.transcriptId.localeCompare(b.transcriptId)),
  });
  return canonical(left) === canonical(right);
}

function validMap(output: unknown, transcriptId: string, sourceVersion: string, questionId: string,
  redactedText: string, hypotheses: readonly string[]): output is MapOutput {
  if (!object(output) || !keys(output, ["version", "transcriptId", "sourceVersion",
    "questionId", "codes"])
    || output.version !== 1 || output.transcriptId !== transcriptId
    || output.sourceVersion !== sourceVersion || output.questionId !== questionId
    || !Array.isArray(output.codes)
    || output.codes.length > 20) return false;
  const chars = Array.from(redactedText);
  return output.codes.every((code: unknown) => object(code)
    && keys(code, ["label", "hypothesis", "startChar", "endChar", "exactText"])
    && nonblank(code.label) && code.label.length <= 120
    && (code.hypothesis === null || (nonblank(code.hypothesis)
      && hypotheses.includes(code.hypothesis)))
    && Number.isSafeInteger(code.startChar) && Number.isSafeInteger(code.endChar)
    && Number(code.startChar) >= 0 && Number(code.endChar) > Number(code.startChar)
    && Number(code.endChar) <= chars.length && nonblank(code.exactText)
    && code.exactText === chars.slice(Number(code.startChar), Number(code.endChar)).join(""));
}

function validResponse(response: LLMResponse, model: string): boolean {
  return response.model === model
    && [response.inputTokens, response.outputTokens, response.latencyMs, response.costMicros]
      .every((value) => Number.isSafeInteger(value) && value >= 0);
}

/** Map each qualified redacted source, then reduce only validated codes into a private V2 proposal.
 * Platform must independently enforce the purpose, approved-complete threshold, source receipts
 * and report publication transaction. This function never publishes model text. */
export async function runAnalystMapReduceDraft(port: AnalystMapReducePort, provider: LLMProvider,
  input: AnalystMapReduceInput): Promise<AnalystMapReduceDraft | null> {
  const deadline = analystDeadline(input.timeoutMs);
  if (!uuid.test(input.studyId) || !nonblank(input.providerModel) || !deadline
    || !nonblank(input.mapPromptVersion) || !nonblank(input.mapSystemPrompt)
    || !nonblank(input.reducePromptVersion) || !nonblank(input.reduceSystemPrompt)) return null;
  const bounded = deadline.run;
  try {
    const initial = await bounded(() => port.readCurrent(input.studyId));
    if (!validSnapshot(initial, input.studyId)) return null;
    const snapshot = freezeSnapshot(initial);
    const mapPromptDigest = await analystTextDigest(input.mapSystemPrompt);
    const promptDigest = await analystTextDigest(input.reduceSystemPrompt);
    const current = async (promptVersion: string, digestValue: string) => {
      const raw = await bounded(() => port.readCurrent(input.studyId));
      if (!validSnapshot(raw, input.studyId)) return false;
      const fresh = freezeSnapshot(raw);
      return sameSnapshot(snapshot, fresh)
        && await bounded(() => port.authorize({ purpose: "ai_analysis", providerModel: input.providerModel,
          promptVersion, promptDigest: digestValue, snapshot: fresh })) === true;
    };
    const maps: MapOutput[] = [];
    const telemetry: LLMResponse[] = [];
    for (const source of snapshot.sources) {
      if (!await current(input.mapPromptVersion, mapPromptDigest)
        || !await current(input.mapPromptVersion, mapPromptDigest)) return null;
      const request: LLMRequest = { purpose: "ai_analysis", promptVersion: input.mapPromptVersion,
        system: input.mapSystemPrompt, messages: [{ role: "user", content: JSON.stringify({
          studyId: snapshot.studyId, decisionQuestion: snapshot.decisionQuestion,
          hypotheses: snapshot.hypotheses,
          guideQuestion: snapshot.guideQuestions.find((question) => question.id === source.questionId),
          transcriptId: source.transcriptId, sourceVersion: source.sourceVersion,
          redactedText: source.redactedText,
        }) }] };
      const result = await bounded(() => provider.generate(request));
      if (!validResponse(result, input.providerModel)
        || !validMap(result.output, source.transcriptId, source.sourceVersion, source.questionId,
          source.redactedText, snapshot.hypotheses)
        || !await current(input.mapPromptVersion, mapPromptDigest)) return null;
      maps.push(structuredClone(result.output));
      telemetry.push(result);
    }
    if (!await current(input.reducePromptVersion, promptDigest)
      || !await current(input.reducePromptVersion, promptDigest)) return null;
    const reduced = await bounded(() => provider.generate({ purpose: "ai_analysis",
      promptVersion: input.reducePromptVersion, system: input.reduceSystemPrompt,
      messages: [{ role: "user", content: JSON.stringify({ studyId: snapshot.studyId,
        decisionQuestion: snapshot.decisionQuestion, hypotheses: snapshot.hypotheses,
        guideQuestions: snapshot.guideQuestions, maps }) }] }));
    if (!validResponse(reduced, input.providerModel)
      || !await current(input.reducePromptVersion, promptDigest)) return null;
    telemetry.push(reduced);
    const sources = await Promise.all(snapshot.sources.map(async (source) => ({
      transcriptId: source.transcriptId, sourceVersion: source.sourceVersion,
      questionId: source.questionId,
      redactedDigest: await analystTextDigest(source.redactedText),
      policyDigest: source.policyDigest, qualificationDigest: source.qualificationDigest,
    })));
    const sum = (field: "inputTokens" | "outputTokens" | "latencyMs" | "costMicros") =>
      telemetry.reduce((total, item) => total + item[field], 0);
    if ([sum("inputTokens"), sum("outputTokens"), sum("latencyMs"), sum("costMicros")]
      .some((value) => !Number.isSafeInteger(value))
      || !await current(input.reducePromptVersion, promptDigest)) return null;
    const mapEvidence = Object.freeze(maps.flatMap((mapped) => mapped.codes.map((code) =>
      Object.freeze({ transcriptId: mapped.transcriptId, sourceVersion: mapped.sourceVersion,
        questionId: mapped.questionId, startChar: code.startChar, endChar: code.endChar,
        exactText: code.exactText }))));
    if (deadline.expired()) return null;
    return { output: reduced.output, model: reduced.model,
      promptVersion: input.reducePromptVersion, promptDigest,
      mapPromptVersion: input.mapPromptVersion, mapPromptDigest, mapCount: maps.length,
      mapEvidence,
      briefDigest: await analystTextDigest(JSON.stringify({
        decisionQuestion: snapshot.decisionQuestion, hypotheses: snapshot.hypotheses,
        guideQuestions: snapshot.guideQuestions })),
      studyId: snapshot.studyId,
      decisionQuestionDigest: await analystTextDigest(snapshot.decisionQuestion), sources,
      inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"),
      latencyMs: sum("latencyMs"), costMicros: sum("costMicros") };
  } catch { return null; }
}

/** Screen a map/reduce draft only while the frozen brief and question bindings
 * still match. The reviewed Platform publisher remains the final authority. */
export async function screenAnalystMapReduceV2Evidence(port: AnalystMapReducePort,
  draft: AnalystMapReduceDraft): Promise<ScreenedAnalystEvidence | null> {
  try {
    const candidate = structuredClone(draft) as AnalystMapReduceDraft;
    if (!digest.test(candidate.mapPromptDigest) || !digest.test(candidate.briefDigest)
      || !nonblank(candidate.mapPromptVersion)
      || !Number.isSafeInteger(candidate.mapCount) || candidate.mapCount < 1
      || candidate.mapCount !== candidate.sources?.length) return null;
    const current = async () => {
      const raw = await port.readCurrent(candidate.studyId);
      if (!validSnapshot(raw, candidate.studyId) || raw.sources.length !== candidate.mapCount)
        return null;
      const snapshot = freezeSnapshot(raw);
      const briefDigest = await analystTextDigest(JSON.stringify({
        decisionQuestion: snapshot.decisionQuestion, hypotheses: snapshot.hypotheses,
        guideQuestions: snapshot.guideQuestions }));
      if (briefDigest !== candidate.briefDigest) return null;
      for (const source of snapshot.sources) {
        const original = candidate.sources.find((item) => item.transcriptId === source.transcriptId);
        if (!original || original.sourceVersion !== source.sourceVersion
          || original.questionId !== source.questionId
          || original.policyDigest !== source.policyDigest
          || original.qualificationDigest !== source.qualificationDigest
          || original.redactedDigest !== await analystTextDigest(source.redactedText)) return null;
      }
      return snapshot;
    };
    const before = await current();
    if (!before || await port.authorize({ purpose: "ai_analysis", providerModel: candidate.model,
      promptVersion: candidate.mapPromptVersion, promptDigest: candidate.mapPromptDigest,
      snapshot: before }) !== true) return null;
    const screened = await screenAnalystV2Evidence(port, candidate);
    if (!screened) return null;
    const after = await current();
    if (!after || await port.authorize({ purpose: "ai_analysis", providerModel: candidate.model,
      promptVersion: candidate.mapPromptVersion, promptDigest: candidate.mapPromptDigest,
      snapshot: after }) !== true) return null;
    return screened;
  } catch { return null; }
}
