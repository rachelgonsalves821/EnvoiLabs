/** Structural bridge to Platform PR #138's publishReviewedReport adapter. */
export interface QuoteIdentity {
  readonly studyId: string;
  readonly transcriptId: string;
  readonly sourceVersion: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly exactText: string;
}

export interface ReviewedDecision {
  readonly proposalId: string;
  readonly candidate: Record<string, unknown>;
  readonly privateRationale: string;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly actorId: string;
  readonly causationId: string;
  readonly findingPosition: number;
  readonly action: "accept" | "edit" | "drop";
  readonly approvedQuote: QuoteIdentity | null;
  readonly privateNote?: string;
  readonly editedClaim?: string;
  readonly editedQuoteText?: string;
}

export interface ReportSnapshot {
  readonly reportId: string;
  readonly studyId: string;
  readonly findings: readonly { readonly id: string; readonly position: number }[];
}

export interface PublicThemeSet {
  readonly themes: readonly {
    readonly claim: string;
    readonly supportingQuotes: readonly QuoteIdentity[];
    readonly contradictingQuotes: readonly QuoteIdentity[];
  }[];
}

export interface PolicyReceipt {
  readonly policyDigest: string;
  readonly qualificationDigest: string;
}

export interface ReviewedReportPorts<Content extends PublicThemeSet> {
  /** Must read the current authorized report/finding snapshot, not caller input. */
  readonly loadReport: (reportId: string) => Promise<ReportSnapshot | null>;
  /** Platform #138's restricted transactional service adapter. */
  readonly publishReviewedReport: (reportId: string, content: Content, findingIds: string[],
    policy: PolicyReceipt, reviews: ReviewedDecision[]) => Promise<boolean>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/i;
const quoteKeys = ["studyId", "transcriptId", "sourceVersion", "startChar", "endChar", "exactText"] as const;

function identity(value: unknown): QuoteIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!uuid.test(String(row.studyId)) || !uuid.test(String(row.transcriptId))
    || !uuid.test(String(row.sourceVersion)) || !Number.isSafeInteger(row.startChar)
    || !Number.isSafeInteger(row.endChar) || (row.startChar as number) < 0
    || (row.endChar as number) <= (row.startChar as number)
    || typeof row.exactText !== "string" || !row.exactText.trim()
    || Array.from(row.exactText).length !== (row.endChar as number) - (row.startChar as number))
    return null;
  return Object.fromEntries(quoteKeys.map((key) => [key, row[key]])) as unknown as QuoteIdentity;
}

function key(quote: QuoteIdentity): string {
  return JSON.stringify(quoteKeys.map((field) => quote[field]));
}

function exactIdentity(value: unknown): boolean {
  return !!identity(value) && !!value && typeof value === "object"
    && Object.keys(value).sort().join(",") === [...quoteKeys].sort().join(",");
}

function equalQuotes(left: readonly QuoteIdentity[], right: readonly QuoteIdentity[]): boolean {
  return left.length === right.length && left.map(key).sort().join("\n") === right.map(key).sort().join("\n");
}

/** Use as the `publish` callback of PR #132's publishQualifiedThemeSet. */
export async function publishReviewedFromQualified<Content extends PublicThemeSet>(
  ports: ReviewedReportPorts<Content>, reportId: string, content: Content,
  quoteMap: Record<string, QuoteIdentity[]>, policy: PolicyReceipt,
  reviews: readonly ReviewedDecision[],
): Promise<boolean> {
  const snapshot = await ports.loadReport(reportId);
  if (!snapshot || snapshot.reportId !== reportId || !uuid.test(snapshot.studyId)
    || !digest.test(policy.policyDigest) || !digest.test(policy.qualificationDigest)
    || snapshot.findings.length !== content.themes.length || reviews.length === 0) return false;
  const findings = [...snapshot.findings].sort((a, b) => a.position - b.position);
  if (findings.some((finding, index) => !uuid.test(finding.id) || finding.position !== index + 1)
    || new Set(findings.map((finding) => finding.id)).size !== findings.length
    || Object.keys(quoteMap).length !== findings.length
    || findings.some((finding) => !Array.isArray(quoteMap[String(finding.position)]))) return false;
  const approved = new Map<number, QuoteIdentity[]>();
  const proposalIds = new Set<string>();
  const causationIds = new Set<string>();
  for (const review of reviews) {
    if (!review || !review.candidate || typeof review.candidate !== "object"
      || !uuid.test(review.proposalId) || !uuid.test(review.causationId)
      || proposalIds.has(review.proposalId) || causationIds.has(review.causationId)
      || !Number.isSafeInteger(review.findingPosition)
      || review.findingPosition < 1 || review.findingPosition > findings.length
      || typeof review.privateRationale !== "string" || !review.privateRationale.trim()
      || review.candidate.rationale !== review.privateRationale
      || typeof review.modelName !== "string" || !review.modelName.trim()
      || typeof review.modelVersion !== "string" || !review.modelVersion.trim()
      || typeof review.promptVersion !== "string" || !review.promptVersion.trim()
      || typeof review.actorId !== "string" || !review.actorId.trim()
      || !["accept", "edit", "drop"].includes(review.action)) return false;
    proposalIds.add(review.proposalId);
    causationIds.add(review.causationId);
    if (review.action === "drop") {
      if (review.approvedQuote !== null || review.editedClaim || review.editedQuoteText) return false;
      continue;
    }
    const quote = identity(review.approvedQuote);
    const candidate = identity(review.candidate);
    if (!quote || !exactIdentity(review.approvedQuote)
      || quote.studyId !== snapshot.studyId || !candidate
      || candidate.studyId !== snapshot.studyId ||
      (review.action === "accept" && (review.editedClaim || review.editedQuoteText
        || key(quote) !== key(candidate)))) return false;
    if (review.action === "edit" && !(
      review.editedClaim === content.themes[review.findingPosition - 1]?.claim
      || review.editedQuoteText === quote.exactText)) return false;
    approved.set(review.findingPosition, [...(approved.get(review.findingPosition) ?? []), quote]);
  }
  for (const [index, theme] of content.themes.entries()) {
    const position = index + 1;
    const publicQuotes = [...theme.supportingQuotes, ...theme.contradictingQuotes];
    if (publicQuotes.some((quote) => !identity(quote) || quote.studyId !== snapshot.studyId
      || Object.keys(quote).some((field) => field !== "confidence"
        && !(quoteKeys as readonly string[]).includes(field)))
      || !(quoteMap[String(position)] ?? []).every(exactIdentity)
      || !equalQuotes(publicQuotes, quoteMap[String(position)] ?? [])
      || !equalQuotes(publicQuotes, approved.get(position) ?? [])) return false;
  }
  return ports.publishReviewedReport(reportId, content, findings.map((finding) => finding.id),
    policy, [...reviews]);
}
