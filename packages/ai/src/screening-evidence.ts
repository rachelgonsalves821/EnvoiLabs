import type { LLMProvider } from "./index.js";

export interface ScreeningEvidenceInput {
  readonly studyId: string;
  readonly answerId: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  /** Frozen, researcher-approved criterion wording for this exact rule version. */
  readonly criterionText: string;
  readonly question: string;
  readonly answerText: string;
  readonly result: "supported" | "contradicted";
  /** Zero-based Unicode code point offsets in the original answer. */
  readonly span: { readonly startChar: number; readonly endChar: number };
}

/** Platform must check current purpose-specific consent and source authority. */
export interface ScreeningModelUsePort {
  authorize(input: ScreeningAuthorizationAttempt): Promise<boolean>;
}

export interface ScreeningAuthorizationAttempt {
  readonly purpose: "ai_screening";
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly promptDigest: string;
  readonly studyId: string;
  readonly answerId: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  /** SHA-256 of the exact current approved rule/question/private answer tuple. */
  readonly sourceDigest: string;
}

export interface ScreeningModelConfig {
  readonly providerModel: string;
  readonly promptVersion: string;
}

interface Judgment {
  readonly relation: "supported" | "contradicted" | "ambiguous";
  readonly evidenceText: string;
  readonly respondentOwnExperience: boolean;
  readonly criterionAndTimeframeMatch: boolean;
  readonly explicitNotInferred: boolean;
}

const system = `You independently check a respondent's answer against the frozen approved screening criterion. Return only a JSON object with keys relation (supported, contradicted, or ambiguous), evidenceText, respondentOwnExperience, criterionAndTimeframeMatch, explicitNotInferred. Read the FULL answer, including negation and qualifications outside the proposed excerpt. A supported or contradicted relation requires an explicit statement about this respondent, the exact criterion and its timeframe. Third-party statements, uncertainty, plans, missing information, partial matches and conflicting statements are ambiguous. Contradicted means explicit evidence against the criterion, not merely absence of support. Copy evidenceText exactly from the proposed excerpt. Do not infer eligibility or decide invite state.`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isJudgment(value: unknown): value is Judgment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Object.keys(data).sort().join(",") === [
    "criterionAndTimeframeMatch", "evidenceText", "explicitNotInferred", "relation", "respondentOwnExperience",
  ].sort().join(",")
    && (data.relation === "supported" || data.relation === "contradicted" || data.relation === "ambiguous")
    && typeof data.evidenceText === "string"
    && typeof data.respondentOwnExperience === "boolean"
    && typeof data.criterionAndTimeframeMatch === "boolean"
    && typeof data.explicitNotInferred === "boolean";
}

function sameInput(current: ScreeningEvidenceInput, frozen: ScreeningEvidenceInput): boolean {
  return current.studyId === frozen.studyId && current.answerId === frozen.answerId
    && current.ruleId === frozen.ruleId && current.ruleVersion === frozen.ruleVersion
    && current.criterionText === frozen.criterionText && current.question === frozen.question
    && current.answerText === frozen.answerText && current.result === frozen.result
    && current.span?.startChar === frozen.span.startChar
    && current.span?.endChar === frozen.span.endChar;
}

/** Advisory Agent 3 port: false forces Platform's review/clarification path. */
export async function evidenceSupports(provider: LLMProvider, input: ScreeningEvidenceInput,
  config: ScreeningModelConfig, modelUse?: ScreeningModelUsePort): Promise<boolean> {
  const frozen: ScreeningEvidenceInput = { studyId: input.studyId, answerId: input.answerId,
    ruleId: input.ruleId, ruleVersion: input.ruleVersion,
    criterionText: input.criterionText, question: input.question,
    answerText: input.answerText, result: input.result,
    span: { startChar: input.span?.startChar, endChar: input.span?.endChar } };
  const { studyId, answerId, ruleId, ruleVersion,
    criterionText, question, answerText, result, span } = frozen;
  if (!uuid.test(studyId) || !uuid.test(answerId) || !uuid.test(ruleId)
    || !Number.isSafeInteger(ruleVersion) || ruleVersion < 1
    || !criterionText?.trim() || !question?.trim() || !answerText?.trim()
    || (result !== "supported" && result !== "contradicted")
    || !Number.isSafeInteger(span?.startChar) || !Number.isSafeInteger(span?.endChar)
    || span.startChar < 0 || span.endChar <= span.startChar
    || !config?.providerModel?.trim() || !config.promptVersion?.trim()) return false;
  const chars = Array.from(answerText);
  if (span.endChar > chars.length) return false;
  const excerpt = chars.slice(span.startChar, span.endChar).join("");
  if (!excerpt.trim()) return false;
  try {
    const providerModel = config.providerModel;
    const promptVersion = config.promptVersion;
    const promptDigest = await sha256(system);
    const sourceDigest = await sha256(JSON.stringify({ studyId, answerId, ruleId,
      ruleVersion, criterionText, question, answerText }));
    const attempt = Object.freeze({ purpose: "ai_screening" as const,
      providerModel, promptVersion, promptDigest, studyId, answerId, ruleId,
      ruleVersion, sourceDigest });
    if (!modelUse || await modelUse.authorize(attempt) !== true
      || !sameInput(input, frozen)
      || await modelUse.authorize(attempt) !== true
      || !sameInput(input, frozen)) return false;
    const generated = await provider.generate({
      purpose: "ai_screening",
      promptVersion,
      system,
      messages: [{ role: "user", content: JSON.stringify({
        approvedCriterion: criterionText, question, fullAnswer: answerText,
        proposedExcerpt: excerpt,
      }) }],
    });
    if (generated.model !== providerModel) return false;
    const parsed: unknown = typeof generated.output === "string"
      ? JSON.parse(generated.output) : generated.output;
    const supported = isJudgment(parsed) && parsed.relation === result && parsed.evidenceText === excerpt
      && parsed.respondentOwnExperience && parsed.criterionAndTimeframeMatch
      && parsed.explicitNotInferred;
    return supported && sameInput(input, frozen)
      && await modelUse.authorize(attempt) === true && sameInput(input, frozen);
  } catch {
    return false;
  }
}
