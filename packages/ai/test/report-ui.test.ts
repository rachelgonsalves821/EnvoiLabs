import { describe, expect, it, vi } from "vitest";
import { ReportUiController } from "../src/report-ui.js";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const studyId = id(1);
const quote = { studyId, transcriptId: id(3), sourceVersion: id(4), startChar: 0,
  endChar: 7, exactText: "ordered", confidence: 0.9 };
const current = { reportId: id(2), studyId, summary: { version: 2, executiveAnswer: "One order",
  themes: [{ claim: "A diner ordered soup", count: 1, total: 1, confidence: "medium",
    supportingQuotes: [quote], contradictingQuotes: [] }], hypotheses: [] } };

describe("researcher report display and export flow", () => {
  it("shows a current fictional report and exports only after a second qualified read", async () => {
    const port = { readCurrent: vi.fn().mockResolvedValue(current) };
    const controller = new ReportUiController(port, studyId);
    const states: string[] = [];
    const unsubscribe = controller.subscribe((state) => states.push(state.kind));
    expect(await controller.refresh()).toMatchObject({ kind: "ready", canExport: true,
      report: current });
    expect(await controller.requestExport()).toContain('"A diner ordered soup"');
    expect(port.readCurrent).toHaveBeenCalledTimes(2);
    expect(states).toEqual(["loading", "loading", "ready", "loading", "ready"]);
    unsubscribe();
  });

  it("clears a previously visible report when the current predicate withholds it", async () => {
    const port = { readCurrent: vi.fn().mockResolvedValueOnce(current).mockResolvedValue(null) };
    const controller = new ReportUiController(port, studyId);
    await controller.refresh();
    expect(await controller.requestExport()).toBeNull();
    expect(controller.getState()).toEqual({ kind: "withheld", canExport: false });
    expect(JSON.stringify(controller.getState())).not.toContain("ordered");
    expect(await controller.requestExport()).toBeNull();
    expect(port.readCurrent).toHaveBeenCalledTimes(2);
  });

  it("removes old claims while a delayed export authorization read is pending", async () => {
    let resolveExport: (value: unknown) => void = () => undefined;
    const port = { readCurrent: vi.fn()
      .mockResolvedValueOnce(current)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveExport = resolve; })) };
    const controller = new ReportUiController(port, studyId);
    await controller.refresh();
    const pending = controller.requestExport();
    expect(controller.getState()).toEqual({ kind: "loading", canExport: false });
    expect(JSON.stringify(controller.getState())).not.toContain("ordered");
    resolveExport(null);
    expect(await pending).toBeNull();
    expect(controller.getState()).toEqual({ kind: "withheld", canExport: false });
  });

  it("ignores an old ready response after a newer withheld refresh", async () => {
    let resolveOld: (value: unknown) => void = () => undefined;
    const port = { readCurrent: vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(null) };
    const controller = new ReportUiController(port, studyId);
    const old = controller.refresh();
    expect(await controller.refresh()).toEqual({ kind: "withheld", canExport: false });
    resolveOld(current);
    await old;
    expect(controller.getState()).toEqual({ kind: "withheld", canExport: false });
  });

  it("requires review before exporting a newly published version", async () => {
    const next = { ...current, reportId: id(5), summary: { ...current.summary,
      executiveAnswer: "A newer qualified answer" } };
    const port = { readCurrent: vi.fn().mockResolvedValueOnce(current).mockResolvedValue(next) };
    const controller = new ReportUiController(port, studyId);
    await controller.refresh();
    expect(await controller.requestExport()).toBeNull();
    expect(controller.getState()).toMatchObject({ kind: "ready", report: next });
    expect(await controller.requestExport()).toContain('"A diner ordered soup"');
  });

  it("never offers export for malformed or failed current reads", async () => {
    const port = { readCurrent: vi.fn().mockResolvedValue({ ...current, privateRationale: "secret" }) };
    const controller = new ReportUiController(port, studyId);
    expect(await controller.refresh()).toEqual({ kind: "withheld", canExport: false });
    expect(await controller.requestExport()).toBeNull();
    port.readCurrent.mockRejectedValue(new Error("access revoked"));
    expect(await controller.refresh()).toEqual({ kind: "withheld", canExport: false });
  });
});
