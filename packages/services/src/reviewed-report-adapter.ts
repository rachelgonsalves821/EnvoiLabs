import { PublishedThemeSetV2Schema, type PublishedThemeSetV2 } from "@envoi-labs/contracts";
import { publicationQuoteMap } from "./qualified-report.js";

export type ReviewedEvidenceDecision = {
  proposalId: string;
  candidate: Record<string, unknown>;
  privateRationale: string;
  modelName: string;
  modelVersion: string;
  promptVersion: string;
  actorId: string;
  causationId: string;
  findingPosition: number;
  action: "accept" | "edit" | "drop";
  approvedQuote: Record<string, unknown> | null;
  privateNote?: string;
  editedClaim?: string;
  editedQuoteText?: string;
};

type ReviewedPublicationDatabase = {
  rpc(name: "publish_gate3_reviewed_report", args: {
    supplied_report_id: string;
    supplied_summary: PublishedThemeSetV2;
    supplied_claims: Record<string, string>;
    supplied_quotes: ReturnType<typeof publicationQuoteMap>;
    supplied_policy: string;
    supplied_qualification: string;
    supplied_reviews: ReviewedEvidenceDecision[];
  }): PromiseLike<{ data: boolean | null; error: unknown }>;
};

// The restricted RPC locks the report and commits the publication receipt and
// private accept/edit/drop decisions together. Replaying the same causation IDs
// returns the existing result without appending decisions.
export async function publishReviewedReport(
  db: ReviewedPublicationDatabase,
  reportId: string,
  content: PublishedThemeSetV2,
  findingIds: string[],
  policy: { policyDigest: string; qualificationDigest: string },
  reviews: ReviewedEvidenceDecision[],
): Promise<boolean> {
  const parsed = PublishedThemeSetV2Schema.safeParse(content);
  if (!parsed.success || findingIds.length !== parsed.data.themes.length ||
    new Set(findingIds).size !== findingIds.length || reviews.length === 0) return false;
  const claims = Object.fromEntries(parsed.data.themes.map((theme, index) =>
    [findingIds[index]!, theme.claim]));
  const { data, error } = await db.rpc("publish_gate3_reviewed_report", {
    supplied_report_id: reportId,
    supplied_summary: parsed.data,
    supplied_claims: claims,
    supplied_quotes: publicationQuoteMap(parsed.data),
    supplied_policy: policy.policyDigest,
    supplied_qualification: policy.qualificationDigest,
    supplied_reviews: reviews,
  });
  if (error) throw error;
  return data === true;
}
