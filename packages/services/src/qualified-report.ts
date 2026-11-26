import { AnalystThemeSetV2Schema, PublishedThemeSetV2Schema,
  VerifiedEvidenceQuoteV2Schema, type EvidenceQuoteCandidateV2,
  type PublishedThemeSetV2 } from "@envoi-labs/contracts";

type Policy = { policyDigest: string; qualificationDigest: string };
type QualifiedText = Policy & { text: string };
type PublishedQuote = PublishedThemeSetV2["themes"][number]["supportingQuotes"][number];
type QuoteIdentity = Pick<PublishedQuote, "studyId" | "transcriptId" | "sourceVersion" |
  "startChar" | "endChar" | "exactText">;
export type PublicationQuoteMap = Record<string, QuoteIdentity[]>;

export function publicationQuoteMap(content: PublishedThemeSetV2): PublicationQuoteMap {
  return Object.fromEntries(content.themes.map((theme, index) => [String(index + 1),
    [...theme.supportingQuotes, ...theme.contradictingQuotes].map((quote) => ({
      studyId: quote.studyId, transcriptId: quote.transcriptId,
      sourceVersion: quote.sourceVersion, startChar: quote.startChar,
      endChar: quote.endChar, exactText: quote.exactText,
    }))]));
}
type Publisher = {
  activePolicy(): Promise<Policy | null>;
  qualifyText(text: string, policy: Policy): Promise<QualifiedText | null>;
  verifyQuote(quote: EvidenceQuoteCandidateV2, policy: Policy): Promise<unknown>;
  // Persist in one transaction through the restricted qualified publication RPC.
  publish(reportId: string, content: PublishedThemeSetV2,
    quoteMap: PublicationQuoteMap, policy: Policy): Promise<boolean>;
};

export async function publishQualifiedThemeSet(
  ports: Publisher, reportId: string, raw: unknown,
): Promise<PublishedThemeSetV2 | null> {
  const analyst = AnalystThemeSetV2Schema.safeParse(raw);
  if (!analyst.success) return null;
  const policy = await ports.activePolicy();
  if (!policy) return null;

  const qualify = async (text: string) => {
    const result = await ports.qualifyText(text, policy);
    return result && result.policyDigest === policy.policyDigest &&
      result.qualificationDigest === policy.qualificationDigest &&
      result.text.trim() !== "" ? result.text : null;
  };
  const executiveAnswer = await qualify(analyst.data.executiveAnswer);
  if (!executiveAnswer) return null;
  const hypotheses: PublishedThemeSetV2["hypotheses"] = [];
  for (const entry of analyst.data.hypotheses) {
    const hypothesis = await qualify(entry.hypothesis);
    if (!hypothesis) return null;
    hypotheses.push({ hypothesis, result: entry.result });
  }

  const themes: PublishedThemeSetV2["themes"] = [];
  for (const theme of analyst.data.themes) {
    const claim = await qualify(theme.claim);
    if (!claim) return null;
    const supportingQuotes: PublishedThemeSetV2["themes"][number]["supportingQuotes"] = [];
    const contradictingQuotes: PublishedThemeSetV2["themes"][number]["contradictingQuotes"] = [];
    for (const [candidates, destination] of [
      [theme.supportingQuotes, supportingQuotes],
      [theme.contradictingQuotes, contradictingQuotes],
    ] as const) {
      for (const candidate of candidates) {
        const verified = VerifiedEvidenceQuoteV2Schema.safeParse(
          await ports.verifyQuote(candidate, policy));
        if (!verified.success || verified.data.studyId !== candidate.studyId ||
          verified.data.transcriptId !== candidate.transcriptId ||
          verified.data.sourceVersion !== candidate.sourceVersion ||
          verified.data.startChar !== candidate.startChar ||
          verified.data.endChar !== candidate.endChar ||
          verified.data.exactText !== candidate.exactText) return null;
        destination.push(verified.data);
      }
    }
    themes.push({ claim, count: theme.count, total: theme.total,
      confidence: theme.confidence, supportingQuotes, contradictingQuotes });
  }
  const content = PublishedThemeSetV2Schema.safeParse({ version: 2,
    executiveAnswer, hypotheses, themes });
  if (!content.success || !(await ports.publish(reportId, content.data,
    publicationQuoteMap(content.data), policy))) return null;
  return content.data;
}
