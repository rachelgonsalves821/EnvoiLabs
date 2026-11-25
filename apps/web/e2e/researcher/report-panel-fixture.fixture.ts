import { expect, test } from "@playwright/test";
import { text } from "node:stream/consumers";
import axe from "axe-core";

async function seriousAxeViolations(root: import("@playwright/test").Locator) {
  return root.evaluate(async (element) => {
    const browserAxe = (window as unknown as { axe: typeof axe }).axe;
    const results = await browserAxe.run(element, { runOnly: { type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return results.violations.filter((violation) => violation.impact === "serious"
      || violation.impact === "critical").map((violation) => ({
      id: violation.id, impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    }));
  });
}

test("keeps export focus and removes a revoked fictional report", async ({ page }) => {
  const downloads: string[] = [];
  page.on("download", (item) => downloads.push(item.suggestedFilename()));
  await page.goto("/gate3-report-fixture");
  const panel = page.getByRole("region", { name: "Research report" });
  const exportButton = panel.getByRole("button", { name: "Download themes and quotes CSV" });
  await expect(exportButton).toBeVisible();
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-pause]")?.click());
  await exportButton.focus();
  await page.keyboard.press("Enter");
  const pending = panel.getByRole("button", { name: "Checking report…" });
  await expect(pending).toBeFocused();
  await expect(pending).toHaveAttribute("aria-disabled", "true");
  await expect(panel.getByText("A receipt helps.")).toHaveCount(0);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-revoke]")?.click());
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-resume]")?.click());
  const retry = panel.getByRole("button", { name: "Check again" });
  await expect(retry).toBeFocused();
  await expect(panel.getByText("The report is currently unavailable.")).toBeVisible();
  expect(downloads).toEqual([]);
});

test("keeps the fictional report readable at mobile width and 200% zoom", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/gate3-report-fixture");
  const panel = page.getByRole("region", { name: "Research report" });
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  const action = panel.getByRole("button", { name: "Download themes and quotes CSV" });
  expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(360);
});

test("requires review and another current read before exporting a replaced report", async ({ page }) => {
  const downloads: string[] = [];
  page.on("download", (item) => downloads.push(item.suggestedFilename()));
  await page.goto("/gate3-report-fixture");
  const panel = page.getByRole("region", { name: "Research report" });
  const action = panel.getByRole("button", { name: "Download themes and quotes CSV" });
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-replace]")?.click());
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(panel.getByText("A newer fictional report favors a current receipt.")).toBeVisible();
  await expect(panel.getByText("The current receipt helps.")).toBeVisible();
  await expect(panel.getByText("A receipt helps.")).toHaveCount(0);
  await expect(panel.getByText("The report changed. Review the current version before downloading.")).toBeVisible();
  await expect(action).toBeFocused();
  expect(downloads).toEqual([]);
  const downloadPromise = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const csv = await text(stream!);
  expect(csv).toContain("The current receipt helps.");
  expect(csv).not.toContain('"A receipt helps."');
  expect(downloads).toHaveLength(1);
});

test("has no serious or critical whole-page axe findings through fictional report states", async ({ page }) => {
  await page.goto("/gate3-report-fixture");
  await page.addScriptTag({ content: axe.source });
  const panel = page.getByRole("region", { name: "Research report" });
  const pageRoot = page.locator("html");
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  expect(await seriousAxeViolations(pageRoot)).toEqual([]);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-replace]")?.click());
  await panel.getByRole("button", { name: "Download themes and quotes CSV" }).click();
  await expect(panel.getByText("The report changed. Review the current version before downloading.")).toBeVisible();
  expect(await seriousAxeViolations(pageRoot)).toEqual([]);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-pause]")?.click());
  await panel.getByRole("button", { name: "Download themes and quotes CSV" }).click();
  await expect(panel.getByRole("button", { name: "Checking report…" })).toBeVisible();
  expect(await seriousAxeViolations(pageRoot)).toEqual([]);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-revoke]")?.click());
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-resume]")?.click());
  await expect(panel.getByText("The report is currently unavailable.")).toBeVisible();
  expect(await seriousAxeViolations(pageRoot)).toEqual([]);
});

test("rechecks fictional private no-store endpoint on display, export and retry", async ({ page }) => {
  const studyId = "a9700000-0000-4000-8000-000000000001";
  const report = { reportId: "a9700000-0000-4000-8000-000000000002", studyId,
    summary: { version: 2, executiveAnswer: "A fictional current answer",
      themes: [{ claim: "Receipts help", count: 1, total: 1, confidence: "high",
        supportingQuotes: [{ studyId, transcriptId: "a9700000-0000-4000-8000-000000000003",
          sourceVersion: "a9700000-0000-4000-8000-000000000004", startChar: 0,
          endChar: 16, exactText: "A receipt helps.", confidence: 0.9 }],
        contradictingQuotes: [] }], hypotheses: [] } };
  let responseKind: "ready" | "missing" | "uncached" = "ready";
  let requests = 0;
  const downloads: string[] = [];
  page.on("download", (item) => downloads.push(item.suggestedFilename()));
  await page.route("**/api/researcher/studies/*/report", async (route) => {
    requests++;
    const kind = responseKind;
    await route.fulfill({ status: kind === "missing" ? 404 : 200,
      headers: kind === "ready" ? { "cache-control": "private, no-store" } : {},
      ...(kind === "missing" ? {} : { json: report }),
    });
  });
  await page.goto("/gate3-report-fixture?endpoint=1");
  const panel = page.getByRole("region", { name: "Research report" });
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  const initialRequests = requests;
  responseKind = "missing";
  await panel.getByRole("button", { name: "Download themes and quotes CSV" }).click();
  await expect(panel.getByText("The report is currently unavailable.")).toBeVisible();
  await expect(panel.getByText("A receipt helps.")).toHaveCount(0);
  expect(downloads).toEqual([]);
  expect(requests).toBe(initialRequests + 1);
  responseKind = "uncached";
  await panel.getByRole("button", { name: "Check again" }).click();
  await expect(panel.getByText("The report is currently unavailable.")).toBeVisible();
  await expect.poll(() => requests).toBe(initialRequests + 2);
  responseKind = "ready";
  await panel.getByRole("button", { name: "Check again" }).click();
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  expect(requests).toBe(initialRequests + 3);
});

test("withholds export when a same-ID fictional report receives a re-redacted quote", async ({ page }) => {
  const studyId = "a9700000-0000-4000-8000-000000000001";
  const reportId = "a9700000-0000-4000-8000-000000000002";
  let currentQuote = "An old receipt.";
  let currentVersion = "a9700000-0000-4000-8000-000000000004";
  const downloads: string[] = [];
  page.on("download", (item) => downloads.push(item.suggestedFilename()));
  await page.route("**/api/researcher/studies/*/report", async (route) => {
    await route.fulfill({ status: 200, headers: { "cache-control": "private, no-store" },
      json: { reportId, studyId, summary: { version: 2,
        executiveAnswer: "A fictional receipt answer", hypotheses: [],
        themes: [{ claim: "Receipts help", count: 1, total: 1, confidence: "medium",
          supportingQuotes: [{ studyId,
            transcriptId: "a9700000-0000-4000-8000-000000000003",
            sourceVersion: currentVersion, startChar: 0,
            endChar: Array.from(currentQuote).length, exactText: currentQuote,
            confidence: 0.9 }], contradictingQuotes: [] }] } } });
  });
  await page.goto("/gate3-report-fixture?endpoint=1");
  const panel = page.getByRole("region", { name: "Research report" });
  await expect(panel.getByText("An old receipt.")).toBeVisible();
  currentQuote = "A current receipt.";
  currentVersion = "a9700000-0000-4000-8000-000000000005";
  await panel.getByRole("button", { name: "Download themes and quotes CSV" }).click();
  await expect(panel.getByText("A current receipt.")).toBeVisible();
  await expect(panel.getByText("An old receipt.")).toHaveCount(0);
  await expect(panel.getByText("The report changed. Review the current version before downloading."))
    .toBeVisible();
  expect(downloads).toEqual([]);
});

test("rechecks the qualified endpoint when the fictional report page returns to the foreground", async ({ page }) => {
  const studyId = "a9700000-0000-4000-8000-000000000001";
  let available = true;
  let reads = 0;
  await page.route("**/api/researcher/studies/*/report", async (route) => {
    reads++;
    await route.fulfill(available
      ? { status: 200, headers: { "cache-control": "private, no-store" },
        json: { reportId: "a9700000-0000-4000-8000-000000000002", studyId,
          summary: { version: 2, executiveAnswer: "Fictional foreground answer",
            themes: [], hypotheses: [] } } }
      : { status: 404 });
  });
  await page.goto("/gate3-report-fixture?endpoint=1");
  const panel = page.getByRole("region", { name: "Research report" });
  await expect(panel.getByText("Fictional foreground answer")).toBeVisible();
  const initialReads = reads;
  available = false;
  // Simulate the foreground notification; this fixture does not prove that
  // the hosted browser has actually hidden and restored the document.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(panel.getByText("Fictional foreground answer")).toHaveCount(0);
  await expect(panel.getByText("The report is currently unavailable.")).toBeVisible();
  expect(reads).toBe(initialReads + 1);
});

test("hides the old study immediately and discards its in-flight export after a route switch", async ({ page }) => {
  const downloads: string[] = [];
  page.on("download", (item) => downloads.push(item.suggestedFilename()));
  await page.goto("/gate3-report-fixture");
  const panel = page.getByRole("region", { name: "Research report" });
  await expect(panel.getByText("A receipt helps.")).toBeVisible();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-pause]")?.click());
  await panel.getByRole("button", { name: "Download themes and quotes CSV" }).click();
  await expect(panel.getByRole("button", { name: "Checking report…" })).toBeVisible();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-switch]")?.click());
  await expect(panel.getByText("A receipt helps.")).toHaveCount(0);
  await expect(panel.getByText("Short instructions help.")).toBeVisible();
  await page.evaluate(() => document.querySelector<HTMLButtonElement>("[data-fixture-resume]")?.click());
  await expect(panel.getByText("A receipt helps.")).toHaveCount(0);
  expect(downloads).toEqual([]);
});
