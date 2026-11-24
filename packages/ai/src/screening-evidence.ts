import type { LLMProvider } from "./index.js";

export interface ScreeningEvidenceInput {
  /** Frozen, researcher-approved criterion wording for this exact rule version. */
  readonly criterionText: string;
  readonly question: string;
  readonly answerText: string;
  readonly result: "supported" | "contradicted";
  /** Zero-based Unicode code point offsets in the original answer. */
  readonly span: { readonly startChar: number; readonly endChar: number };
}

interface Judgment {
  readonly relation: "supported" | "contradicted" | "ambiguous";
  readonly evidenceText: string;
  readonly respondentOwnExperience: boolean;
  readonly criterionAndTimeframeMatch: boolean;
  readonly explicitNotInferred: boolean;
}

const system = `You independently check a respondent's answer against the frozen approved screening criterion. Return only a JSON object with keys relation (supported, contradicted, or ambiguous), evidenceText, respondentOwnExperience, criterionAndTimeframeMatch, explicitNotInferred. Read the FULL answer, including negation and qualifications outside the proposed excerpt. A supported or contradicted relation requires an explicit statement about this respondent, the exact criterion and its timeframe. Third-party statements, uncertainty, plans, missing information, partial matches and conflicting statements are ambiguous. Contradicted means explicit evidence against the criterion, not merely absence of support. Copy evidenceText exactly from the proposed excerpt. Do not infer eligibility or decide invite state.`;

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

/** Advisory Agent 3 port: false forces Platform's review/clarification path. */
export async function evidenceSupports(provider: LLMProvider, input: ScreeningEvidenceInput): Promise<boolean> {
  const { criterionText, question, answerText, result, span } = input;
  if (!criterionText?.trim() || !question?.trim() || !answerText?.trim()
    || (result !== "supported" && result !== "contradicted")
    || !Number.isSafeInteger(span?.startChar) || !Number.isSafeInteger(span?.endChar)
    || span.startChar < 0 || span.endChar <= span.startChar) return false;
  const chars = Array.from(answerText);
  if (span.endChar > chars.length) return false;
  const excerpt = chars.slice(span.startChar, span.endChar).join("");
  if (!excerpt.trim()) return false;
  try {
    const { output } = await provider.generate({
      purpose: "screening-evidence",
      promptVersion: "1",
      system,
      messages: [{ role: "user", content: JSON.stringify({
        approvedCriterion: criterionText, question, fullAnswer: answerText,
        proposedExcerpt: excerpt,
      }) }],
    });
    const parsed: unknown = typeof output === "string" ? JSON.parse(output) : output;
    return isJudgment(parsed) && parsed.relation === result && parsed.evidenceText === excerpt
      && parsed.respondentOwnExperience && parsed.criterionAndTimeframeMatch
      && parsed.explicitNotInferred;
  } catch {
    return false;
  }
}
