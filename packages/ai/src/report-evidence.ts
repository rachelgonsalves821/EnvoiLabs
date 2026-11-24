/** Pure Gate 3 evidence gate. Callers must supply only current researcher-visible projections. */
export interface RedactedSource {
  readonly studyId: string;
  readonly transcriptId: string;
  readonly sourceVersion: string;
  readonly redactedText: string;
  readonly published: boolean;
  readonly withdrawn: boolean;
}

export interface ProposedEvidence {
  readonly studyId: string;
  readonly transcriptId: string;
  readonly sourceVersion: string;
  /** Unicode character offsets, matching PostgreSQL substring positions (zero based). */
  readonly startChar: number;
  readonly endChar: number;
  readonly exactText: string;
  readonly rationale: string;
  readonly confidence: number;
}

/** Contains only text copied from a qualified redacted source. Model rationale stays private. */
export type VerifiedEvidence = Omit<ProposedEvidence, "rationale">;

export type EvidenceDecision =
  | { readonly action: "accept"; readonly evidence: VerifiedEvidence }
  | { readonly action: "drop"; readonly transcriptId: string; readonly reason: string };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function verifyEvidence(
  studyId: string,
  proposed: readonly ProposedEvidence[],
  sources: readonly RedactedSource[],
): EvidenceDecision[] {
  const byId = new Map<string, RedactedSource>();
  const duplicates = new Set<string>();
  for (const source of sources.filter((item) => item.studyId === studyId)) {
    if (byId.has(source.transcriptId)) duplicates.add(source.transcriptId);
    byId.set(source.transcriptId, source);
  }
  return proposed.map((evidence): EvidenceDecision => {
    let reason: string | null = null;
    const source = byId.get(evidence.transcriptId);
    if (evidence.studyId !== studyId || !source || duplicates.has(evidence.transcriptId))
      reason = "study or source mismatch";
    else if (!source.published || source.withdrawn || !source.redactedText) reason = "source unavailable";
    else if (!uuid.test(source.sourceVersion) || source.sourceVersion !== evidence.sourceVersion)
      reason = "source version changed";
    else if (!Number.isSafeInteger(evidence.startChar) || !Number.isSafeInteger(evidence.endChar)
      || evidence.startChar < 0 || evidence.endChar <= evidence.startChar
      || evidence.endChar > Array.from(source.redactedText).length) reason = "invalid span";
    else if (typeof evidence.exactText !== "string" || !evidence.exactText.trim()
      || Array.from(source.redactedText).slice(evidence.startChar, evidence.endChar).join("") !== evidence.exactText)
      reason = "quote differs from redacted source";
    else if (typeof evidence.rationale !== "string" || !evidence.rationale.trim() || !Number.isFinite(evidence.confidence)
      || evidence.confidence < 0 || evidence.confidence > 1) reason = "invalid provenance";
    if (reason) return { action: "drop", transcriptId: evidence.transcriptId, reason };
    const verified: VerifiedEvidence = {
      studyId: evidence.studyId, transcriptId: evidence.transcriptId,
      sourceVersion: evidence.sourceVersion, startChar: evidence.startChar,
      endChar: evidence.endChar, exactText: evidence.exactText, confidence: evidence.confidence,
    };
    return { action: "accept", evidence: verified };
  });
}

export interface ProposedFinding {
  readonly claim: string;
  readonly supporting: readonly ProposedEvidence[];
  readonly contradicting: readonly ProposedEvidence[];
}

export interface PublishedFinding {
  readonly claim: string;
  readonly supporting: readonly VerifiedEvidence[];
  readonly contradicting: readonly VerifiedEvidence[];
}

/** Re-run at every report or export read, so a changed projection revokes stale quotes. */
export function prepareFindings(
  studyId: string,
  findings: readonly ProposedFinding[],
  sources: readonly RedactedSource[],
  /** Must use the currently qualified publication policy; null withholds the finding. */
  publishClaim?: (modelClaim: string) => string | null,
): { findings: PublishedFinding[]; audit: EvidenceDecision[] } {
  const audit: EvidenceDecision[] = [];
  const visible = findings.flatMap((finding) => {
    const supporting = verifyEvidence(studyId, finding.supporting, sources);
    const contradicting = verifyEvidence(studyId, finding.contradicting, sources);
    audit.push(...supporting, ...contradicting);
    const acceptedSupporting = supporting.flatMap((decision) => decision.action === "accept" ? [decision.evidence] : []);
    if (acceptedSupporting.length === 0) return [];
    const claim = publishClaim?.(finding.claim)?.trim();
    if (!claim) return [];
    return [{ claim, supporting: acceptedSupporting,
      contradicting: contradicting.flatMap((decision) => decision.action === "accept" ? [decision.evidence] : []) }];
  });
  return { findings: visible, audit };
}
