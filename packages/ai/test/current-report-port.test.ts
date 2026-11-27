import { expect, it, vi } from "vitest";
import { currentQualifiedReportPort } from "../src/current-report-port.js";
import { ReportUiController } from "../src/report-ui.js";

const studyId = "a9700000-0000-4000-8000-000000000001";
const report = { reportId: "a9700000-0000-4000-8000-000000000002", studyId,
  summary: { version: 2, executiveAnswer: "A fictional order", themes: [], hypotheses: [] } };

it("adapts Gate 2's newest-qualified loader for display and a fresh export read", async () => {
  const client = { scope: "authenticated research request" };
  const loader = vi.fn().mockResolvedValueOnce(report).mockResolvedValueOnce(null);
  const controller = new ReportUiController(currentQualifiedReportPort(client, loader), studyId);
  expect(await controller.refresh()).toMatchObject({ kind: "ready", report });
  expect(await controller.requestExport()).toBeNull();
  expect(controller.getState()).toEqual({ kind: "withheld", canExport: false });
  expect(loader).toHaveBeenNthCalledWith(1, client, studyId);
  expect(loader).toHaveBeenNthCalledWith(2, client, studyId);
});
