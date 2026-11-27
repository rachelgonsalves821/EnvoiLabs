import { expect, test } from "@playwright/test";
import axe from "axe-core";

const id = (n: number) => `a9700000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const list = (studyId: string, redactedText: string) => ({ studyId, respondents: [{
  number: 1, student: null, transcripts: [{ id: id(studyId === id(1) ? 3 : 9), redactedText }],
}] });

test("hides a previous study transcript before the next qualified read resolves", async ({ page }) => {
  let releaseSecond: (() => void) | undefined;
  const secondPending = new Promise<void>((resolve) => { releaseSecond = resolve; });
  await page.route("**/api/researcher/studies/*/transcripts?version=2", async (route) => {
    const second = route.request().url().includes(id(8));
    if (second) await secondPending;
    await route.fulfill({ status: 200, headers: { "cache-control": "private, no-store" },
      json: list(second ? id(8) : id(1), second ? "New fictional study text." : "Old fictional study text.") });
  });
  await page.goto("/gate3-report-fixture?transcript=1");
  const panel = page.getByRole("region", { name: "Redacted transcripts" });
  await expect(panel.getByText("Old fictional study text.")).toBeVisible();
  await page.getByRole("button", { name: "Switch fictional study" }).click();
  await expect(panel.getByText("Old fictional study text.")).toHaveCount(0);
  await expect(panel.getByRole("status")).toBeVisible();
  releaseSecond?.();
  await expect(panel.getByText("New fictional study text.")).toBeVisible();
});

test("withholds a transcript response without private no-store headers", async ({ page }) => {
  await page.route("**/api/researcher/studies/*/transcripts?version=2", (route) =>
    route.fulfill({ status: 200, json: list(id(1), "Must stay hidden.") }));
  await page.goto("/gate3-report-fixture?transcript=1");
  const panel = page.getByRole("region", { name: "Redacted transcripts" });
  await expect(panel.getByText("Must stay hidden.")).toHaveCount(0);
  await expect(panel.getByText("Redacted transcripts could not be loaded.")).toBeVisible();
});

test("withholds a legacy flat response from the current grouped endpoint", async ({ page }) => {
  await page.route("**/api/researcher/studies/*/transcripts?version=2", (route) =>
    route.fulfill({ status: 200, headers: { "cache-control": "private, no-store" },
      json: { studyId: id(1), transcripts: [{ id: id(3), redactedText: "Legacy text." }] } }));
  await page.goto("/gate3-report-fixture?transcript=1");
  const panel = page.getByRole("region", { name: "Redacted transcripts" });
  await expect(panel.getByText("Legacy text.")).toHaveCount(0);
  await expect(panel.getByText("Redacted transcripts could not be loaded.")).toBeVisible();
});

test("withholds a transcript response reached through an auth redirect", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "fixture-webkit",
    "Playwright WebKit route.fulfill cannot serve a synthetic 302 response");
  await page.route("**/api/researcher/studies/*/transcripts?version=2", (route) =>
    route.fulfill({ status: 302, headers: { location: "/gate3-report-fixture?transcript=1" } }));
  await page.goto("/gate3-report-fixture?transcript=1");
  const panel = page.getByRole("region", { name: "Redacted transcripts" });
  await expect(panel.getByText("Redacted transcripts could not be loaded.")).toBeVisible();
});

test("keeps fictional transcript ready and withheld states accessible", async ({ page }) => {
  let available = true;
  await page.route("**/api/researcher/studies/*/transcripts?version=2", (route) =>
    route.fulfill(available
      ? { status: 200, headers: { "cache-control": "private, no-store" },
        json: list(id(1), "A fictional redacted answer.") }
      : { status: 404 }));
  await page.goto("/gate3-report-fixture?transcript=1");
  const panel = page.getByRole("region", { name: "Redacted transcripts" });
  await expect(panel.getByText("A fictional redacted answer.")).toBeVisible();
  await page.addScriptTag({ content: axe.source });
  const violations = () => page.locator("html").evaluate(async (root) => {
    const browserAxe = (window as unknown as { axe: typeof axe }).axe;
    const result = await browserAxe.run(root, { runOnly: { type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return result.violations.filter((item) => item.impact === "serious"
      || item.impact === "critical").map((item) => item.id);
  });
  expect(await violations()).toEqual([]);
  available = false;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(panel.getByText("Redacted transcripts could not be loaded.")).toBeVisible();
  expect(await violations()).toEqual([]);
});
