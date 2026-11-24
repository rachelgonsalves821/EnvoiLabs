/** Pure Gate 3 evidence gate. Callers must supply only current researcher-visible projections. */
export interface RedactedSource {
  readonly studyId: string;
  readonly transcriptId: string;
  readonly version: string;
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
  readonly quote: string;
  readonly rationale: string;
  readonly confidence: number;
}

export type EvidenceDecision =
  | { readonly action: "accept"; readonly evidence: ProposedEvidence }
  | { readonly action: "drop"; readonly transcriptId: string; readonly reason: string };

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
    else if (!source.version || source.version !== evidence.sourceVersion) reason = "source version changed";
    else if (!Number.isSafeInteger(evidence.startChar) || !Number.isSafeInteger(evidence.endChar)
      || evidence.startChar < 0 || evidence.endChar <= evidence.startChar
      || evidence.endChar > Array.from(source.redactedText).length) reason = "invalid span";
    else if (!evidence.quote.trim()
      || Array.from(source.redactedText).slice(evidence.startChar, evidence.endChar).join("") !== evidence.quote)
      reason = "quote differs from redacted source";
    else if (!evidence.rationale.trim() || !Number.isFinite(evidence.confidence)
      || evidence.confidence < 0 || evidence.confidence > 1) reason = "invalid provenance";
    return reason
      ? { action: "drop", transcriptId: evidence.transcriptId, reason }
      : { action: "accept", evidence };
  });
}

export interface ProposedFinding {
  readonly claim: string;
  readonly supporting: readonly ProposedEvidence[];
  readonly contradicting: readonly ProposedEvidence[];
}

/** Re-run at every report or export read, so a changed projection revokes stale quotes. */
export function prepareFindings(
  studyId: string,
  findings: readonly ProposedFinding[],
  sources: readonly RedactedSource[],
): { findings: ProposedFinding[]; audit: EvidenceDecision[] } {
  const audit: EvidenceDecision[] = [];
  const visible = findings.flatMap((finding) => {
    const supporting = verifyEvidence(studyId, finding.supporting, sources);
    const contradicting = verifyEvidence(studyId, finding.contradicting, sources);
    audit.push(...supporting, ...contradicting);
    const acceptedSupporting = supporting.flatMap((decision) => decision.action === "accept" ? [decision.evidence] : []);
    if (acceptedSupporting.length === 0) return [];
    return [{ claim: finding.claim, supporting: acceptedSupporting,
      contradicting: contradicting.flatMap((decision) => decision.action === "accept" ? [decision.evidence] : []) }];
  });
  return { findings: visible, audit };
}
