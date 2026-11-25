/** The port must read through the current qualified report predicate and researcher RLS. */
export interface QualifiedReportReadPort {
  readCurrent(studyId: string): Promise<unknown | null>;
}

export interface PublicReportQuote {
  readonly studyId: string;
  readonly transcriptId: string;
  readonly sourceVersion: string;
  readonly startChar: number;
  readonly endChar: number;
  readonly exactText: string;
  readonly confidence: number;
}

export interface PublicReportTheme {
  readonly claim: string;
  readonly count: number;
  readonly total: number;
  readonly confidence: "high" | "medium" | "low";
  readonly supportingQuotes: readonly PublicReportQuote[];
  readonly contradictingQuotes: readonly PublicReportQuote[];
}

export interface PublicReportSummary {
  readonly version: 2;
  readonly executiveAnswer: string;
  readonly themes: readonly PublicReportTheme[];
  readonly hypotheses: readonly { readonly hypothesis: string;
    readonly result: "supported" | "weakened" | "untested" }[];
}

export interface PublicReportSnapshot {
  readonly reportId: string;
  readonly studyId: string;
  readonly summary: PublicReportSummary;
}

export type ReportDisplay = { readonly kind: "ready"; readonly report: PublicReportSnapshot;
  readonly exportAvailable: true } | { readonly kind: "withheld"; readonly exportAvailable: false };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = (value: Record<string, unknown>, expected: readonly string[]) =>
  Object.keys(value).sort().join(",") === [...expected].sort().join(",");
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const nonblank = (value: unknown): value is string => typeof value === "string" && !!value.trim();

function quote(value: unknown, studyId: string): value is PublicReportQuote {
  if (!record(value) || !fields(value, ["studyId", "transcriptId", "sourceVersion",
    "startChar", "endChar", "exactText", "confidence"])) return false;
  return value.studyId === studyId && uuid.test(String(value.transcriptId))
    && uuid.test(String(value.sourceVersion)) && Number.isSafeInteger(value.startChar)
    && Number.isSafeInteger(value.endChar) && (value.startChar as number) >= 0
    && (value.endChar as number) > (value.startChar as number)
    && nonblank(value.exactText)
    && Array.from(value.exactText).length === (value.endChar as number) - (value.startChar as number)
    && typeof value.confidence === "number"
    && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1;
}

function theme(value: unknown, studyId: string): value is PublicReportTheme {
  if (!record(value) || !fields(value, ["claim", "count", "total", "confidence",
    "supportingQuotes", "contradictingQuotes"])) return false;
  return nonblank(value.claim) && Number.isSafeInteger(value.count)
    && Number.isSafeInteger(value.total) && (value.count as number) > 0
    && (value.total as number) >= (value.count as number)
    && ["high", "medium", "low"].includes(String(value.confidence))
    && Array.isArray(value.supportingQuotes) && value.supportingQuotes.length >= 1
    && value.supportingQuotes.length <= 10 && value.supportingQuotes.every((item) => quote(item, studyId))
    && Array.isArray(value.contradictingQuotes)
    && value.contradictingQuotes.every((item) => quote(item, studyId));
}

function snapshot(value: unknown, studyId: string): value is PublicReportSnapshot {
  if (!record(value) || !fields(value, ["reportId", "studyId", "summary"])
    || !uuid.test(String(value.reportId)) || value.studyId !== studyId
    || !record(value.summary)) return false;
  const summary = value.summary;
  return fields(summary, ["version", "executiveAnswer", "themes", "hypotheses"])
    && summary.version === 2 && nonblank(summary.executiveAnswer)
    && Array.isArray(summary.themes) && summary.themes.every((item) => theme(item, studyId))
    && Array.isArray(summary.hypotheses) && summary.hypotheses.every((item) =>
      record(item) && fields(item, ["hypothesis", "result"])
      && nonblank(item.hypothesis) && ["supported", "weakened", "untested"].includes(String(item.result)));
}

/** Do not retain aliases from a mutable service or test adapter after validation. */
function copySnapshot(source: PublicReportSnapshot): PublicReportSnapshot {
  const copyQuotes = (quotes: readonly PublicReportQuote[]) => Object.freeze(quotes.map((item) =>
    Object.freeze({ studyId: item.studyId, transcriptId: item.transcriptId,
      sourceVersion: item.sourceVersion, startChar: item.startChar, endChar: item.endChar,
      exactText: item.exactText, confidence: item.confidence })));
  return Object.freeze({ reportId: source.reportId, studyId: source.studyId,
    summary: Object.freeze({ version: 2 as const,
      executiveAnswer: source.summary.executiveAnswer,
      themes: Object.freeze(source.summary.themes.map((item) => Object.freeze({
        claim: item.claim, count: item.count, total: item.total, confidence: item.confidence,
        supportingQuotes: copyQuotes(item.supportingQuotes),
        contradictingQuotes: copyQuotes(item.contradictingQuotes),
      }))),
      hypotheses: Object.freeze(source.summary.hypotheses.map((item) =>
        Object.freeze({ hypothesis: item.hypothesis, result: item.result }))),
    }),
  });
}

/** Clear an old report on every failed or withheld refresh; never reuse a prior view. */
export async function readReportDisplay(port: QualifiedReportReadPort, studyId: string): Promise<ReportDisplay> {
  if (!uuid.test(studyId)) return { kind: "withheld", exportAvailable: false };
  try {
    const current = await port.readCurrent(studyId);
    return snapshot(current, studyId)
      ? { kind: "ready", report: copySnapshot(current), exportAvailable: true }
      : { kind: "withheld", exportAvailable: false };
  } catch {
    return { kind: "withheld", exportAvailable: false };
  }
}

/** Export is a new authorized read, never a serialization of cached UI state. */
export async function exportCurrentReport(port: QualifiedReportReadPort, studyId: string): Promise<string | null> {
  const display = await readReportDisplay(port, studyId);
  return display.kind === "ready" ? JSON.stringify(display.report) : null;
}
