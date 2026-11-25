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
  draft: AnalystDraftResult): Promise<AnalystSourceSnapshot | null> {
  if (!raw || raw.studyId !== draft.studyId || !nonblank(raw.decisionQuestion)
    || !Array.isArray(raw.sources) || raw.sources.length !== draft.sources.length) return null;
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
    if (!original || original.sourceVersion !== source.sourceVersion
      || original.policyDigest !== source.policyDigest
      || original.qualificationDigest !== source.qualificationDigest
      || await analystTextDigest(source.redactedText) !== original.redactedDigest) return null;
  }
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
    if (!uuid.test(candidate.studyId) || !digest.test(candidate.promptDigest)
      || !digest.test(candidate.decisionQuestionDigest) || !nonblank(candidate.model)
      || !nonblank(candidate.promptVersion) || !Array.isArray(candidate.sources)
      || candidate.sources.length === 0 || !privateV2(candidate.output)) return null;
    const current = await matchingCurrent(await port.readCurrent(candidate.studyId), candidate);
    if (!current) return null;
    if (!await port.authorize({ purpose: "ai_analysis", providerModel: candidate.model,
      promptVersion: candidate.promptVersion, promptDigest: candidate.promptDigest,
      snapshot: current })) return null;
    const after = await matchingCurrent(await port.readCurrent(candidate.studyId), candidate);
    if (!after || !await port.authorize({ purpose: "ai_analysis", providerModel: candidate.model,
      promptVersion: candidate.promptVersion, promptDigest: candidate.promptDigest,
      snapshot: after })) return null;
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
