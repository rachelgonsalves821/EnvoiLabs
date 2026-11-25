import type { LLMProvider, LLMRequest } from "./index.js";

export interface QualifiedAnalystSource {
  readonly studyId: string;
  readonly transcriptId: string;
  readonly sourceVersion: string;
  readonly redactedText: string;
  readonly policyDigest: string;
  readonly qualificationDigest: string;
}

export interface AnalystSourceSnapshot {
  readonly studyId: string;
  readonly decisionQuestion: string;
  readonly sources: readonly QualifiedAnalystSource[];
}

export interface AnalystDraftPort {
  /** Platform must return only current qualified redacted sources for this study. */
  readCurrent(studyId: string): Promise<AnalystSourceSnapshot | null>;
  /** Platform must verify the current ai_analysis grant, provider and every source receipt. */
  authorize(input: { readonly purpose: "ai_analysis"; readonly providerModel: string;
    readonly promptVersion: string; readonly promptDigest: string;
    readonly snapshot: AnalystSourceSnapshot }): Promise<boolean>;
}

export interface AnalystDraftResult {
  readonly output: unknown;
  readonly model: string;
  readonly promptVersion: string;
  readonly promptDigest: string;
  readonly studyId: string;
  readonly decisionQuestionDigest: string;
  readonly sources: readonly { readonly transcriptId: string; readonly sourceVersion: string;
    readonly redactedDigest: string; readonly policyDigest: string;
    readonly qualificationDigest: string }[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly costMicros: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/i;
const nonblank = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export async function analystTextDigest(value: string): Promise<string> {
  const hashed = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hashed), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function valid(snapshot: AnalystSourceSnapshot | null, studyId: string): snapshot is AnalystSourceSnapshot {
  if (!snapshot || snapshot.studyId !== studyId || !nonblank(snapshot.decisionQuestion)
    || !Array.isArray(snapshot.sources) || snapshot.sources.length === 0) return false;
  const seen = new Set<string>();
  const first = snapshot.sources[0];
  for (const source of snapshot.sources) {
    if (!source || source.studyId !== studyId || !uuid.test(source.transcriptId)
      || !uuid.test(source.sourceVersion) || !nonblank(source.redactedText)
      || !digest.test(source.policyDigest) || !digest.test(source.qualificationDigest)
      || source.policyDigest !== first?.policyDigest
      || source.qualificationDigest !== first?.qualificationDigest
      || seen.has(source.transcriptId.toLowerCase())) return false;
    seen.add(source.transcriptId.toLowerCase());
  }
  return true;
}

function frozen(snapshot: AnalystSourceSnapshot): AnalystSourceSnapshot {
  return Object.freeze({ studyId: snapshot.studyId,
    decisionQuestion: snapshot.decisionQuestion,
    sources: Object.freeze(snapshot.sources.map((source) => Object.freeze({
      studyId: source.studyId, transcriptId: source.transcriptId,
      sourceVersion: source.sourceVersion, redactedText: source.redactedText,
      policyDigest: source.policyDigest, qualificationDigest: source.qualificationDigest,
    }))),
  });
}

function same(left: AnalystSourceSnapshot, right: AnalystSourceSnapshot): boolean {
  const normalized = (snapshot: AnalystSourceSnapshot) => JSON.stringify({
    studyId: snapshot.studyId, decisionQuestion: snapshot.decisionQuestion,
    sources: [...snapshot.sources].sort((a, b) => a.transcriptId.localeCompare(b.transcriptId)),
  });
  return normalized(left) === normalized(right);
}

/** Private draft only; the reviewed qualified publisher remains the final public gate. */
export async function runAnalystDraft(port: AnalystDraftPort, provider: LLMProvider,
  input: { readonly studyId: string; readonly providerModel: string;
    readonly promptVersion: string; readonly systemPrompt: string }): Promise<AnalystDraftResult | null> {
  if (!uuid.test(input.studyId) || !nonblank(input.providerModel)
    || !nonblank(input.promptVersion) || !nonblank(input.systemPrompt)) return null;
  try {
    const first = await port.readCurrent(input.studyId);
    if (!valid(first, input.studyId)) return null;
    const snapshot = frozen(first);
    const promptDigest = await analystTextDigest(input.systemPrompt);
    if (await port.authorize({ purpose: "ai_analysis", providerModel: input.providerModel,
        promptVersion: input.promptVersion, promptDigest, snapshot }) !== true) return null;
    const beforeRaw = await port.readCurrent(input.studyId);
    if (!valid(beforeRaw, input.studyId)) return null;
    const beforeDispatch = frozen(beforeRaw);
    if (!same(snapshot, beforeDispatch)
      || await port.authorize({ purpose: "ai_analysis", providerModel: input.providerModel,
        promptVersion: input.promptVersion, promptDigest, snapshot: beforeDispatch }) !== true) return null;
    const request: LLMRequest = { purpose: "ai_analysis", promptVersion: input.promptVersion,
      system: input.systemPrompt, messages: [{ role: "user", content: JSON.stringify({
        studyId: snapshot.studyId, decisionQuestion: snapshot.decisionQuestion,
        sources: snapshot.sources.map(({ transcriptId, sourceVersion, redactedText }) =>
          ({ transcriptId, sourceVersion, redactedText })),
      }) }] };
    const result = await provider.generate(request);
    if (result.model !== input.providerModel
      || ![result.inputTokens, result.outputTokens, result.latencyMs, result.costMicros]
        .every((value) => Number.isSafeInteger(value) && value >= 0)) return null;
    const sources = await Promise.all(snapshot.sources.map(async (source) => ({
      transcriptId: source.transcriptId, sourceVersion: source.sourceVersion,
      redactedDigest: await analystTextDigest(source.redactedText),
      policyDigest: source.policyDigest, qualificationDigest: source.qualificationDigest,
    })));
    const decisionQuestionDigest = await analystTextDigest(snapshot.decisionQuestion);
    const afterRaw = await port.readCurrent(input.studyId);
    if (!valid(afterRaw, input.studyId)) return null;
    const afterDispatch = frozen(afterRaw);
    if (!same(snapshot, afterDispatch)
      || await port.authorize({ purpose: "ai_analysis", providerModel: input.providerModel,
        promptVersion: input.promptVersion, promptDigest, snapshot: afterDispatch }) !== true) return null;
    return { output: result.output, model: result.model, promptVersion: input.promptVersion,
      promptDigest,
      studyId: snapshot.studyId, decisionQuestionDigest, sources,
      inputTokens: result.inputTokens, outputTokens: result.outputTokens,
      latencyMs: result.latencyMs, costMicros: result.costMicros };
  } catch {
    return null;
  }
}
