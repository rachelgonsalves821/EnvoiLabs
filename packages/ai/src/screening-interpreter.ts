import type { LLMProvider } from "./index.js";
import type { ScreeningModelUsePort, ScreeningAuthorizationAttempt } from
  "./screening-evidence.js";

export interface ScreeningInterpretationInput {
  readonly studyId: string;
  readonly answerId: string;
  readonly ruleId: string;
  readonly ruleVersion: number;
  readonly criterionText: string;
  readonly question: string;
  /** Must identify the current qualified redacted screening source, not raw text. */
  readonly redactedSourceVersion: string;
  readonly redactionPolicyDigest: string;
  readonly answerText: string;
}

export interface ScreeningInterpretationConfig {
  readonly providerModel: string;
  readonly promptVersion: string;
  readonly systemPrompt: string;
  readonly timeoutMs: number;
}

export type ScreeningInterpretation = { readonly result: "supported" | "contradicted" | "unclear";
  readonly span: { readonly startChar: number; readonly endChar: number } | null };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

function frozen(input: ScreeningInterpretationInput): ScreeningInterpretationInput {
  return Object.freeze({ studyId: input.studyId, answerId: input.answerId,
    ruleId: input.ruleId, ruleVersion: input.ruleVersion,
    criterionText: input.criterionText, question: input.question,
    redactedSourceVersion: input.redactedSourceVersion,
    redactionPolicyDigest: input.redactionPolicyDigest,
    answerText: input.answerText });
}

function same(left: ScreeningInterpretationInput, right: ScreeningInterpretationInput): boolean {
  return left.studyId === right.studyId && left.answerId === right.answerId
    && left.ruleId === right.ruleId && left.ruleVersion === right.ruleVersion
    && left.criterionText === right.criterionText && left.question === right.question
    && left.redactedSourceVersion === right.redactedSourceVersion
    && left.redactionPolicyDigest === right.redactionPolicyDigest
    && left.answerText === right.answerText;
}

function parse(output: unknown, answerText: string): ScreeningInterpretation | null {
  const value: unknown = typeof output === "string" ? JSON.parse(output) : output;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "result,span"
    || !["supported", "contradicted", "unclear"].includes(String(row.result))) return null;
  if (row.result === "unclear") return row.span === null
    ? { result: "unclear", span: null } : null;
  const span = row.span;
  if (!span || typeof span !== "object" || Array.isArray(span)) return null;
  const offsets = span as Record<string, unknown>;
  if (Object.keys(offsets).sort().join(",") !== "endChar,startChar"
    || !Number.isSafeInteger(offsets.startChar) || !Number.isSafeInteger(offsets.endChar)
    || Number(offsets.startChar) < 0 || Number(offsets.endChar) <= Number(offsets.startChar)
    || Number(offsets.endChar) > Array.from(answerText).length
    || !Array.from(answerText).slice(Number(offsets.startChar), Number(offsets.endChar))
      .join("").trim()) return null;
  return { result: row.result as "supported" | "contradicted",
    span: { startChar: Number(offsets.startChar), endChar: Number(offsets.endChar) } };
}

/** Private model interpretation only. A denied, invalid or timed-out result is null,
 * which Platform treats as clarification. Semantic evidence review remains separate. */
export async function interpretScreeningAnswer(provider: LLMProvider,
  input: ScreeningInterpretationInput, config: ScreeningInterpretationConfig,
  modelUse?: ScreeningModelUsePort): Promise<ScreeningInterpretation | null> {
  if (!input || !config || !modelUse) return null;
  const source = frozen(input);
  const approvedConfig = Object.freeze({ providerModel: config.providerModel,
    promptVersion: config.promptVersion, systemPrompt: config.systemPrompt,
    timeoutMs: config.timeoutMs });
  const sameConfig = () => config.providerModel === approvedConfig.providerModel
    && config.promptVersion === approvedConfig.promptVersion
    && config.systemPrompt === approvedConfig.systemPrompt
    && config.timeoutMs === approvedConfig.timeoutMs;
  if (!uuid.test(source.studyId) || !uuid.test(source.answerId) || !uuid.test(source.ruleId)
    || !uuid.test(source.redactedSourceVersion)
    || !/^[0-9a-f]{64}$/i.test(source.redactionPolicyDigest)
    || !Number.isSafeInteger(source.ruleVersion) || source.ruleVersion < 1
    || !source.criterionText?.trim() || !source.question?.trim() || !source.answerText?.trim()
    || !approvedConfig.providerModel?.trim() || !approvedConfig.promptVersion?.trim()
    || !approvedConfig.systemPrompt?.trim()
    || !Number.isSafeInteger(approvedConfig.timeoutMs) || approvedConfig.timeoutMs < 1) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const attempt: ScreeningAuthorizationAttempt = Object.freeze({ purpose: "ai_screening",
      providerModel: approvedConfig.providerModel, promptVersion: approvedConfig.promptVersion,
      promptDigest: await digest(approvedConfig.systemPrompt), studyId: source.studyId,
      answerId: source.answerId, ruleId: source.ruleId, ruleVersion: source.ruleVersion,
      redactedSourceVersion: source.redactedSourceVersion,
      redactionPolicyDigest: source.redactionPolicyDigest,
      sourceDigest: await digest(JSON.stringify(source)) });
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), approvedConfig.timeoutMs);
    });
    const authorized = () => Promise.race([modelUse.authorize(attempt), timeout]);
    if (await authorized() !== true || !same(input, source) || !sameConfig()
      || await authorized() !== true || !same(input, source) || !sameConfig()) return null;
    const response = await Promise.race([provider.generate({ purpose: "ai_screening",
      promptVersion: approvedConfig.promptVersion, system: approvedConfig.systemPrompt,
      messages: [{ role: "user",
        content: JSON.stringify({ approvedCriterion: source.criterionText,
          question: source.question, fullRedactedAnswer: source.answerText }) }] }), timeout]);
    if (!response || response.model !== approvedConfig.providerModel
      || !same(input, source) || !sameConfig()) return null;
    const result = parse(response.output, source.answerText);
    if (!result || await authorized() !== true || !same(input, source)
      || !sameConfig()) return null;
    return result;
  } catch { return null; }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
