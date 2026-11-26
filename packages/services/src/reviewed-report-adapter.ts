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
    supplied_positions: Record<string, number>;
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
  const positions = Object.fromEntries(findingIds.map((id, index) => [id, index + 1]));
  const { data, error } = await db.rpc("publish_gate3_reviewed_report", {
    supplied_report_id: reportId,
    supplied_summary: parsed.data,
    supplied_claims: claims,
    supplied_quotes: publicationQuoteMap(parsed.data),
    supplied_policy: policy.policyDigest,
    supplied_qualification: policy.qualificationDigest,
    supplied_reviews: reviews,
    supplied_positions: positions,
  });
  if (error) throw error;
  return data === true;
}

type WithheldDatabase = {
  rpc(name: "record_gate3_withheld_proposal", args: {
    supplied_study_id: string;
    supplied_report_id: string | null;
    supplied_proposal_id: string;
    supplied_candidate: Record<string, unknown>;
    supplied_model_name: string;
    supplied_model_version: string;
    supplied_prompt_version: string;
    supplied_rationale: string;
    supplied_actor: string;
    supplied_causation_id: string;
    supplied_reason: string;
  }): PromiseLike<{ data: boolean | null; error: unknown }>;
};

export type WithheldProposal = {
  studyId: string; reportId: string | null; proposalId: string;
  candidate: Record<string, unknown>; modelName: string; modelVersion: string;
  promptVersion: string; privateRationale: string; actorId: string;
  causationId: string; reason: string;
};

export async function recordWithheldProposal(
  db: WithheldDatabase, proposal: WithheldProposal,
): Promise<boolean> {
  const { data, error } = await db.rpc("record_gate3_withheld_proposal", {
    supplied_study_id: proposal.studyId, supplied_report_id: proposal.reportId,
    supplied_proposal_id: proposal.proposalId, supplied_candidate: proposal.candidate,
    supplied_model_name: proposal.modelName, supplied_model_version: proposal.modelVersion,
    supplied_prompt_version: proposal.promptVersion,
    supplied_rationale: proposal.privateRationale, supplied_actor: proposal.actorId,
    supplied_causation_id: proposal.causationId, supplied_reason: proposal.reason,
  });
  if (error) throw error;
  return data === true;
}

type QualifiedReportReader = {
  rpc(name: "read_gate3_qualified_report", args: {
    supplied_study_id: string; supplied_report_id: string;
  }): PromiseLike<{ data: unknown; error: unknown }>;
};

// Use the request's authenticated client for every report or export read. The
// database rechecks the current source, receipt, consent and tenant in one
// statement snapshot, so a prior successful read cannot authorize a later one.
export async function loadQualifiedReport(
  db: QualifiedReportReader, studyId: string, reportId: string,
): Promise<unknown | null> {
  const { data, error } = await db.rpc("read_gate3_qualified_report", {
    supplied_study_id: studyId, supplied_report_id: reportId,
  });
  if (error) throw error;
  if (!data || typeof data !== "object") return null;
  const report = (data as { report?: unknown }).report;
  if (!report || typeof report !== "object") return null;
  const scoped = report as { id?: unknown; studyId?: unknown; summary?: unknown };
  return scoped.id === reportId && scoped.studyId === studyId &&
    PublishedThemeSetV2Schema.safeParse(scoped.summary).success ? data : null;
}

type CurrentQualifiedReportReader = {
  rpc(name: "read_gate3_current_qualified_report", args: {
    supplied_study_id: string;
  }): PromiseLike<{ data: unknown; error: unknown }>;
};

// Each display and export request must call this port afresh. The database
// selects the latest version first, so a withheld newest report yields null.
export async function loadCurrentQualifiedReport(
  db: CurrentQualifiedReportReader, studyId: string,
): Promise<{ reportId: string; studyId: string; summary: PublishedThemeSetV2 } | null> {
  const { data, error } = await db.rpc("read_gate3_current_qualified_report", {
    supplied_study_id: studyId,
  });
  if (error) throw error;
  if (!data || typeof data !== "object") return null;
  const report = (data as { report?: unknown }).report;
  if (!report || typeof report !== "object") return null;
  const scoped = report as { id?: unknown; studyId?: unknown; summary?: unknown };
  const summary = PublishedThemeSetV2Schema.safeParse(scoped.summary);
  return typeof scoped.id === "string" && scoped.studyId === studyId && summary.success
    ? { reportId: scoped.id, studyId, summary: summary.data } : null;
}
