import type { QualifiedReportReadPort } from "./report-reader.js";

/** Structural match for Gate 2's loadCurrentQualifiedReport(db, studyId). */
export type CurrentQualifiedLoader<Database> = (db: Database, studyId: string) => Promise<unknown | null>;

/** Pass an authenticated request-scoped client; never a service-role client. */
export function currentQualifiedReportPort<Database>(
  db: Database, loadCurrentQualifiedReport: CurrentQualifiedLoader<Database>,
): QualifiedReportReadPort {
  return { readCurrent: (studyId) => loadCurrentQualifiedReport(db, studyId) };
}
