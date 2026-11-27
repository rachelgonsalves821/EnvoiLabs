import { analystTextDigest, type AnalystDraftPort, type AnalystDraftResult,
  type AnalystSourceSnapshot } from
  "./analyst-draft.js";
import { verifyEvidence, type ProposedEvidence, type VerifiedEvidence } from
  "./report-evidence.js";
import { meetsConfidenceFloor, type FindingConfidence } from "./report-confidence.js";
import { BriefSchema } from "@envoi-labs/contracts";

export interface ScreenedAnalystEvidence {
  /** Evidence only. Model claims, rationale, hypotheses and brief remain private. */
  readonly themes: readonly { readonly position: number;
    readonly supportingQuotes: readonly VerifiedEvidence[];
    readonly contradictingQuotes: readonly VerifiedEvidence[] }[];
  readonly decisions: readonly { readonly themePosition: number;
    readonly side: "supporting" | "contradicting"; readonly candidateIndex: number;
    readonly action: "accept" | "drop"; readonly reason?: string }[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const nonblank = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim();

type MappedProvenance = { readonly mapPromptVersion: string;
  readonly mapPromptDigest: string; readonly briefDigest: string;
  readonly mapCount: number;
  readonly mapEvidence: readonly { readonly transcriptId: string;
    readonly sourceVersion: string; readonly questionId: string;
    readonly startChar: number; readonly endChar: number;
    readonly exactText: string }[] };

function mappedProvenance(draft: AnalystDraftResult): MappedProvenance | null | false {
  const value = draft as unknown as Record<string, unknown>;
  const names = ["mapPromptVersion", "mapPromptDigest", "briefDigest", "mapCount",
    "mapEvidence"];
  if (!names.some((name) => name in value)) return null;
  if (!nonblank(value.mapPromptVersion) || !digest.test(String(value.mapPromptDigest))
    || !digest.test(String(value.briefDigest)) || !Number.isSafeInteger(value.mapCount)
    || Number(value.mapCount) < 1 || value.mapCount !== draft.sources?.length
    || !Array.isArray(value.mapEvidence)
    || !value.mapEvidence.every((item: unknown) => record(item)
      && exact(item, ["transcriptId", "sourceVersion", "questionId", "startChar",
        "endChar", "exactText"])
      && uuid.test(String(item.transcriptId)) && uuid.test(String(item.sourceVersion))
      && uuid.test(String(item.questionId)) && Number.isSafeInteger(item.startChar)
      && Number.isSafeInteger(item.endChar) && Number(item.startChar) >= 0
      && Number(item.endChar) > Number(item.startChar) && nonblank(item.exactText)
      && Array.from(item.exactText).length === Number(item.endChar) - Number(item.startChar)))
    return false;
  return { mapPromptVersion: value.mapPromptVersion,
    mapPromptDigest: String(value.mapPromptDigest), briefDigest: String(value.briefDigest),
    mapCount: Number(value.mapCount), mapEvidence: value.mapEvidence };
}

function quotesAreMapped(output: { themes: readonly { supportingQuotes: readonly ProposedEvidence[];
  contradictingQuotes: readonly ProposedEvidence[] }[] }, mapped: MappedProvenance): boolean {
  return output.themes.every((theme) =>
    [...theme.supportingQuotes, ...theme.contradictingQuotes].every((quote) =>
      mapped.mapEvidence.some((code) => code.transcriptId === quote.transcriptId
        && code.sourceVersion === quote.sourceVersion
        && code.startChar === quote.startChar && code.endChar === quote.endChar
        && code.exactText === quote.exactText)));
}

function frozenCurrent(source: AnalystSourceSnapshot): AnalystSourceSnapshot {
  return Object.freeze({ studyId: source.studyId, decisionQuestion: source.decisionQuestion,
    sources: Object.freeze(source.sources.map((item) => Object.freeze({
      studyId: item.studyId, transcriptId: item.transcriptId,
      sourceVersion: item.sourceVersion, redactedText: item.redactedText,
      policyDigest: item.policyDigest, qualificationDigest: item.qualificationDigest,
    }))),
  });
}

async function matchingCurrent(raw: AnalystSourceSnapshot | null,
  draft: AnalystDraftResult, mapped: MappedProvenance | null): Promise<AnalystSourceSnapshot | null> {
  if (!raw || raw.studyId !== draft.studyId || !nonblank(raw.decisionQuestion)
    || !Array.isArray(raw.sources) || raw.sources.length !== draft.sources.length) return null;
  if (mapped) {
    const value = raw as unknown as Record<string, unknown>;
    if (!Array.isArray(value.hypotheses) || value.hypotheses.length === 0
      || !value.hypotheses.every(nonblank)
      || !Array.isArray(value.guideQuestions) || value.guideQuestions.length < 4
      || value.guideQuestions.length > 10 || !value.guideQuestions.every((question: unknown) =>
        record(question) && uuid.test(String(question.id)) && nonblank(question.text))) return null;
    const ids = value.guideQuestions.map((question: { id: string }) => question.id.toLowerCase());
    if (new Set(ids).size !== ids.length) return null;
    const hypotheses = value.hypotheses as string[];
    const briefDigest = await analystTextDigest(JSON.stringify({
      decisionQuestion: raw.decisionQuestion, hypotheses,
      guideQuestions: value.guideQuestions }));
    if (briefDigest !== mapped.briefDigest || mapped.mapCount !== raw.sources.length) return null;
    const scored = record(draft.output) && Array.isArray(draft.output.hypotheses)
      ? draft.output.hypotheses.map((item: unknown) =>
        record(item) ? item.hypothesis : null) : [];
    if (scored.length !== hypotheses.length
      || new Set(scored).size !== scored.length
      || scored.some((item) => typeof item !== "string" || !hypotheses.includes(item))) return null;
  }
  const current = frozenCurrent(raw);
  if (await analystTextDigest(current.decisionQuestion) !== draft.decisionQuestionDigest) return null;
  const matched = new Set<string>();
  for (const source of current.sources) {
    if (!source || source.studyId !== draft.studyId || !uuid.test(source.transcriptId)
      || !uuid.test(source.sourceVersion) || !nonblank(source.redactedText)
      || !digest.test(source.policyDigest) || !digest.test(source.qualificationDigest)
      || matched.has(source.transcriptId.toLowerCase())) return null;
    matched.add(source.transcriptId.toLowerCase());
    const original = draft.sources.find((item) => item.transcriptId === source.transcriptId);
    const sourceRow = raw.sources.find((item) => item.transcriptId === source.transcriptId);
    const questionId = (sourceRow as unknown as Record<string, unknown> | undefined)?.questionId;
    const proposedQuestionId = (original as unknown as Record<string, unknown> | undefined)?.questionId;
    if (!original || original.sourceVersion !== source.sourceVersion
      || (mapped && (!uuid.test(String(questionId)) || questionId !== proposedQuestionId
        || !(raw as unknown as { guideQuestions: { id: string }[] }).guideQuestions
          .some((question) => question.id === questionId)))
      || original.policyDigest !== source.policyDigest
      || original.qualificationDigest !== source.qualificationDigest
      || await analystTextDigest(source.redactedText) !== original.redactedDigest) return null;
  }
  if (mapped && mapped.mapEvidence.some((code) => {
    const source = raw.sources.find((item) => item.transcriptId === code.transcriptId);
    return !source || source.sourceVersion !== code.sourceVersion
      || (source as unknown as Record<string, unknown>).questionId !== code.questionId
      || Array.from(source.redactedText).slice(code.startChar, code.endChar).join("")
        !== code.exactText;
  })) return null;
  return current;
}

function quote(value: unknown): value is ProposedEvidence {
  return record(value) && exact(value, ["studyId", "transcriptId", "sourceVersion",
    "startChar", "endChar", "exactText", "rationale", "confidence"])
    && typeof value.studyId === "string" && typeof value.transcriptId === "string"
    && typeof value.sourceVersion === "string" && Number.isSafeInteger(value.startChar)
    && Number.isSafeInteger(value.endChar) && typeof value.exactText === "string"
    && typeof value.rationale === "string" && typeof value.confidence === "number";
}

function privateV2(value: unknown): value is { themes: readonly {
  supportingQuotes: readonly ProposedEvidence[]; contradictingQuotes: readonly ProposedEvidence[] }[] } {
  if (!record(value) || !exact(value, ["version", "executiveAnswer", "themes",
    "hypotheses", "followUpBrief"]) || value.version !== 2
    || !nonblank(value.executiveAnswer) || !Array.isArray(value.themes)
    || !Array.isArray(value.hypotheses)) return false;
  const brief = BriefSchema.safeParse(value.followUpBrief);
  if (!brief.success || brief.data.targetCompletes < 10) return false;
  if (!value.hypotheses.every((item: unknown) => record(item)
    && exact(item, ["hypothesis", "result"]) && nonblank(item.hypothesis)
    && ["supported", "weakened", "untested"].includes(String(item.result)))) return false;
  return value.themes.every((item: unknown) => record(item)
    && exact(item, ["claim", "count", "total", "confidence", "supportingQuotes",
      "contradictingQuotes"]) && nonblank(item.claim)
    && Number.isSafeInteger(item.count) && Number(item.count) > 0
    && Number.isSafeInteger(item.total) && Number(item.total) >= Number(item.count)
    && ["high", "medium", "low"].includes(String(item.confidence))
    && meetsConfidenceFloor(Number(item.count), Number(item.total),
      item.confidence as FindingConfidence)
    && Array.isArray(item.supportingQuotes) && item.supportingQuotes.length >= 1
    && item.supportingQuotes.length <= 10 && item.supportingQuotes.every(quote)
    && Array.isArray(item.contradictingQuotes) && item.contradictingQuotes.every(quote));
}

/** Private pre-review evidence screen; Gate 2's V2 schema and publisher remain mandatory. */
export async function screenAnalystV2Evidence(port: AnalystDraftPort,
  draft: AnalystDraftResult): Promise<ScreenedAnalystEvidence | null> {
  try {
    const candidate = structuredClone(draft) as AnalystDraftResult;
    const mapped = mappedProvenance(candidate);
    if (!uuid.test(candidate.studyId) || !digest.test(candidate.promptDigest)
      || !digest.test(candidate.decisionQuestionDigest) || !nonblank(candidate.model)
      || !nonblank(candidate.promptVersion) || !Array.isArray(candidate.sources)
      || candidate.sources.length === 0 || mapped === false
      || !privateV2(candidate.output)) return null;
    if (mapped && !quotesAreMapped(candidate.output, mapped)) return null;
    const current = await matchingCurrent(await port.readCurrent(candidate.studyId), candidate, mapped);
    if (!current) return null;
    if (mapped && await port.authorize({ purpose: "ai_analysis", providerModel: candidate.model,
      promptVersion: mapped.mapPromptVersion, promptDigest: mapped.mapPromptDigest,
      snapshot: current }) !== true) return null;
    if (await port.authorize({ purpose: "ai_analysis", providerModel: candidate.model,
      promptVersion: candidate.promptVersion, promptDigest: candidate.promptDigest,
      snapshot: current }) !== true) return null;
    const after = await matchingCurrent(await port.readCurrent(candidate.studyId), candidate, mapped);
    if (mapped && after && await port.authorize({ purpose: "ai_analysis",
      providerModel: candidate.model, promptVersion: mapped.mapPromptVersion,
      promptDigest: mapped.mapPromptDigest, snapshot: after }) !== true) return null;
    if (!after || await port.authorize({ purpose: "ai_analysis", providerModel: candidate.model,
      promptVersion: candidate.promptVersion, promptDigest: candidate.promptDigest,
      snapshot: after }) !== true) return null;
    const sources = after.sources.map((source) => ({ ...source,
      published: true, withdrawn: false }));
    const decisions: ScreenedAnalystEvidence["decisions"][number][] = [];
    const themes: ScreenedAnalystEvidence["themes"][number][] = [];
    for (const [index, theme] of candidate.output.themes.entries()) {
      const position = index + 1;
      const screen = (side: "supporting" | "contradicting",
        candidates: readonly ProposedEvidence[]) => verifyEvidence(candidate.studyId, candidates, sources)
        .flatMap((decision, candidateIndex) => {
          decisions.push({ themePosition: position, side, candidateIndex,
            action: decision.action, ...(decision.action === "drop" ? { reason: decision.reason } : {}) });
          return decision.action === "accept" ? [decision.evidence] : [];
        });
      const supportingQuotes = screen("supporting", theme.supportingQuotes);
      const contradictingQuotes = screen("contradicting", theme.contradictingQuotes);
      if (supportingQuotes.length > 0) themes.push({ position,
        supportingQuotes, contradictingQuotes });
    }
    return { themes, decisions };
  } catch {
    return null;
  }
}
