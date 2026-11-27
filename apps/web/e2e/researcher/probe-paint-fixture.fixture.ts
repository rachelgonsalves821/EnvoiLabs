import { expect, test } from "@playwright/test";

test("records a fictional probe only after two browser frames", async ({ page }) => {
  await page.goto("/gate3-probe-fixture");
  await page.getByRole("button", { name: "Paint probe" }).click();
  await expect(page.locator("[data-outcome]")).toHaveAttribute("data-outcome", "rendered");
  await expect(page.locator("[data-probe-text]")).toHaveText("What shaped your choice?");
  await expect(page.locator("[data-shown-calls]")).toHaveAttribute("data-shown-calls", "1");
  const latency = Number(await page.locator("[data-latency]").getAttribute("data-latency"));
  expect(latency).toBeGreaterThanOrEqual(100);
  expect(latency).toBeLessThan(6000);
});

test("retracts a fictional probe when frames never arrive", async ({ page }) => {
  await page.goto("/gate3-probe-fixture");
  await page.getByRole("button", { name: "Suspend frames" }).click();
  await expect(page.locator("[data-outcome]")).toHaveAttribute("data-outcome", "timeout");
  await expect(page.locator("[data-probe-text]")).toHaveCount(0);
  await expect(page.locator("[data-shown-calls]")).toHaveAttribute("data-shown-calls", "0");
});

test("retracts a fictional probe after the answer turn changes", async ({ page }) => {
  await page.goto("/gate3-probe-fixture");
  await page.getByRole("button", { name: "Change turn" }).click();
  await expect(page.locator("[data-outcome]")).toHaveAttribute("data-outcome", "superseded");
  await expect(page.locator("[data-probe-text]")).toHaveCount(0);
  await expect(page.locator("[data-shown-calls]")).toHaveAttribute("data-shown-calls", "0");
});
