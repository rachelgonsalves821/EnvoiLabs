import { readReportDisplay, type PublicReportSnapshot,
  type QualifiedReportReadPort } from "./report-reader.js";
import { serializeReportCsv } from "./report-csv.js";

export type ReportUiState =
  | { readonly kind: "loading" | "withheld"; readonly canExport: false }
  | { readonly kind: "ready"; readonly canExport: boolean;
      readonly report: PublicReportSnapshot };

/** Researcher-facing state flow; caller supplies a fresh authorized read port. */
export class ReportUiController {
  private state: ReportUiState = { kind: "loading", canExport: false };
  private generation = 0;
  private readonly listeners = new Set<(state: ReportUiState) => void>();

  constructor(private readonly port: QualifiedReportReadPort,
    private readonly studyId: string) {}

  getState(): ReportUiState { return this.state; }

  subscribe(listener: (state: ReportUiState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => { this.listeners.delete(listener); };
  }

  private setState(state: ReportUiState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Clears old claims while rechecking; an older response cannot restore them. */
  async refresh(): Promise<ReportUiState> {
    const request = ++this.generation;
    this.setState({ kind: "loading", canExport: false });
    const result = await readReportDisplay(this.port, this.studyId);
    if (request !== this.generation) return this.state;
    this.setState(result.kind === "ready"
      ? { kind: "ready", canExport: true, report: result.report }
      : { kind: "withheld", canExport: false });
    return this.state;
  }

  /** Shared gate for any export format; never hand a stale or unseen report to a renderer. */
  async requestReviewedSnapshot(): Promise<PublicReportSnapshot | null> {
    if (this.state.kind !== "ready" || !this.state.canExport) return null;
    const visible = this.state.report;
    const request = ++this.generation;
    this.setState({ kind: "loading", canExport: false });
    const display = await readReportDisplay(this.port, this.studyId);
    if (request !== this.generation) return null;
    if (display.kind !== "ready") {
      this.setState({ kind: "withheld", canExport: false });
      return null;
    }
    const fresh = display.report;
    this.setState({ kind: "ready", report: fresh, canExport: true });
    return fresh.reportId === visible.reportId
      && JSON.stringify(fresh) === JSON.stringify(visible) ? fresh : null;
  }

  /** CSV and later PDF share the same fresh authorization and review check. */
  async requestExport(): Promise<string | null> {
    const report = await this.requestReviewedSnapshot();
    return report ? serializeReportCsv(report) : null;
  }
}
