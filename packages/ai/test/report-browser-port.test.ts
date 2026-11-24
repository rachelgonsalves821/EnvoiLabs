import { expect, it, vi } from "vitest";
import { reportBrowserPort } from "../src/report-browser-port.js";
import { ReportUiController } from "../src/report-ui.js";
import { currentQualifiedReportPort } from "../src/current-report-port.js";

const studyId = "a9700000-0000-4000-8000-000000000001";
const report = { reportId: "a9700000-0000-4000-8000-000000000002", studyId,
  summary: { version: 2, executiveAnswer: "A fictional answer", themes: [], hypotheses: [] } };

it("uses a fresh same-origin report request for display and export", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200,
    json: async () => report });
  const controller = new ReportUiController(reportBrowserPort(fetcher), studyId);
  expect((await controller.refresh()).kind).toBe("ready");
  expect(await controller.requestExport()).toContain('"report_label"');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenCalledWith(`/api/researcher/studies/${studyId}/report`,
    expect.objectContaining({ cache: "no-store", credentials: "same-origin",
      signal: expect.any(AbortSignal) }));
});

it("withholds a previously visible report when a fresh request returns 404 or fails", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, status: 200,
    json: async () => report }).mockResolvedValueOnce({ ok: false, status: 404 });
  const controller = new ReportUiController(reportBrowserPort(fetcher), studyId);
  await controller.refresh();
  expect(await controller.requestExport()).toBeNull();
  expect(controller.getState()).toEqual({ kind: "withheld", canExport: false });
  fetcher.mockRejectedValue(new Error("network"));
  expect(await controller.refresh()).toEqual({ kind: "withheld", canExport: false });
});

it("denies export when the synthetic qualified endpoint withholds the newest report", async () => {
  const db = { requester: "fictional-researcher" };
  const loader = vi.fn().mockResolvedValueOnce(report).mockResolvedValueOnce(null);
  const endpoint = vi.fn(async (url: string, options?: RequestInit) => {
    expect(url).toBe(`/api/researcher/studies/${studyId}/report`);
    expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin" });
    const current = await currentQualifiedReportPort(db, loader).readCurrent(studyId);
    return current
      ? new Response(JSON.stringify(current), { status: 200,
        headers: { "cache-control": "no-store", "content-type": "application/json" } })
      : new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  });
  const controller = new ReportUiController(reportBrowserPort(endpoint as typeof fetch), studyId);
  expect((await controller.refresh()).kind).toBe("ready");
  expect(await controller.requestExport()).toBeNull();
  expect(controller.getState()).toEqual({ kind: "withheld", canExport: false });
  expect(loader).toHaveBeenNthCalledWith(1, db, studyId);
  expect(loader).toHaveBeenNthCalledWith(2, db, studyId);
  expect(endpoint).toHaveBeenCalledTimes(2);
});
