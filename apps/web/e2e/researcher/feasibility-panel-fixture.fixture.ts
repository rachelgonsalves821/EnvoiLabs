import { expect, test } from "@playwright/test";
import axe from "axe-core";

const studyId = "a9700000-0000-4000-8000-000000000001";
const current = { studyId, eligibleProfileCount: 25,
  history: { offered: 40, accepted: 20, completed: 15 },
  projectedCompletes: 15, fillHours: null, basis: "observed_rates",
  asOf: "2026-11-24T12:00:00Z" };

test("clears a prior outlook while rechecking and withholds it on revocation", async ({ page }) => {
  let available = true;
  let release: (() => void) | undefined;
  let pause = false;
  let requests = 0;
  await page.route("**/api/researcher/studies/*/feasibility", async (route) => {
    requests++;
    if (pause) await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill(available ? { headers: { "cache-control": "private, no-store" },
      json: current } : { status: 404 });
  });
  await page.goto("/gate3-feasibility-fixture");
  await expect(page.getByText("about 15 people")).toBeVisible();
  expect(await page.getByText(/finish time/i).count()).toBe(1);
  const initial = requests;
  pause = true;
  const retry = page.getByRole("button", { name: "Check matching outlook again" });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Checking the current matching outlook…");
  await expect(page.getByRole("button", { name: "Checking matching outlook…" })).toBeFocused();
  await expect(page.getByText("about 15 people")).toHaveCount(0);
  await expect.poll(() => requests).toBe(initial + 1);
  available = false;
  release?.();
  await expect(page.getByRole("status")).toHaveText("Matching outlook is currently unavailable.");
  await expect(retry).toBeFocused();
  await expect(page.getByText("about 15 people")).toHaveCount(0);
});

test("requires a fresh private no-store response before showing an outlook", async ({ page }) => {
  let cacheControl = "public, max-age=60";
  await page.route("**/api/researcher/studies/*/feasibility", (route) => route.fulfill({
    headers: { "cache-control": cacheControl }, json: current,
  }));
  await page.goto("/gate3-feasibility-fixture");
  await expect(page.getByRole("status")).toHaveText("Matching outlook is currently unavailable.");
  await expect(page.getByText("about 15 people")).toHaveCount(0);
  cacheControl = "private, no-store";
  await page.getByRole("button", { name: "Check matching outlook again" }).click();
  await expect(page.getByText("about 15 people")).toBeVisible();
  await expect(page.getByText(/finish within/i)).toHaveCount(0);
});

test("has no serious or critical whole-page axe findings and reflows at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.route("**/api/researcher/studies/*/feasibility", (route) => route.fulfill({
    headers: { "cache-control": "private, no-store" }, json: current,
  }));
  await page.goto("/gate3-feasibility-fixture");
  await page.addScriptTag({ content: axe.source });
  await expect(page.getByText("about 15 people")).toBeVisible();
  expect((await page.getByRole("button", { name: "Check matching outlook again" })
    .boundingBox())?.height).toBeGreaterThanOrEqual(44);
  expect(await seriousAxeViolations(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

async function seriousAxeViolations(page: import("@playwright/test").Page) {
  return page.locator("html").evaluate(async (root) => {
    const results = await (window as unknown as { axe: typeof axe }).axe.run(root, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return results.violations.filter((item) => item.impact === "serious"
      || item.impact === "critical").map((item) => ({ id: item.id,
      targets: item.nodes.map((node) => node.target) }));
  });
}
