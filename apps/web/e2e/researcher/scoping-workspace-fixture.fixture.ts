import { expect, test } from "@playwright/test";
import axe from "axe-core";

test("fills a fictional live brief from a chat turn and direct edit", async ({ page }) => {
  await page.goto("/gate3-scoping-fixture");
  const workspace = page.getByRole("region", { name: "Scope a study" });
  await expect(workspace.getByText("What decision will this study inform?")).toBeVisible();
  await workspace.getByRole("button", { name: "Improve checkout" }).click();
  await expect(workspace.getByLabel("Your answer")).toHaveValue("Improve checkout");
  await workspace.getByRole("button", { name: "Send answer" }).click();
  await expect(workspace.getByRole("textbox", { name: "Decision", exact: true }))
    .toHaveValue("Improve checkout");
  await expect(workspace.getByText("Brief updated: decision.")).toBeVisible();
  const title = workspace.getByLabel("Study title");
  await title.fill("Fictional checkout study");
  await title.blur();
  await expect(workspace.getByText("Brief updated: title.")).toBeVisible();
  await expect(workspace.getByLabel("Study title")).toHaveValue("Fictional checkout study");
});

test("clears the fictional brief and conversation after withdrawal", async ({ page }) => {
  await page.goto("/gate3-scoping-fixture");
  const workspace = page.getByRole("region", { name: "Scope a study" });
  await expect(workspace.getByText("What decision will this study inform?")).toBeVisible();
  await page.getByRole("button", { name: "Revoke fictional brief" }).click();
  await expect(workspace.getByText("The study conversation is currently unavailable.")).toBeVisible();
  await expect(workspace.getByText("What decision will this study inform?")).toHaveCount(0);
  await expect(workspace.getByLabel("Your answer")).toHaveCount(0);
});

test("keeps preferred criteria when editing exclusions and enforces ten completes", async ({ page }) => {
  await page.goto("/gate3-scoping-fixture");
  const workspace = page.getByRole("region", { name: "Scope a study" });
  const preferred = workspace.getByRole("textbox", { name: "Preferred behavior, one per line" });
  await expect(preferred).toBeVisible();
  await preferred.fill("Ordered delivery in the last 30 days");
  await preferred.blur();
  await expect(workspace.getByText("Brief updated: criteria.")).toBeVisible();
  const exclusions = workspace.getByRole("textbox", { name: "Exclusions, one per line" });
  await exclusions.fill("Works for the fictional shop");
  await exclusions.blur();
  await expect(workspace.getByRole("textbox", { name: "Preferred behavior, one per line" }))
    .toHaveValue("Ordered delivery in the last 30 days");
  const target = workspace.getByRole("spinbutton", { name: "Target completes" });
  await target.fill("9");
  await target.blur();
  await expect(workspace.getByText("Choose at least 10 completes.")).toBeVisible();
  await target.fill("10");
  await target.blur();
  await expect(workspace.getByText("Brief updated: targetCompletes.")).toBeVisible();
  await expect(workspace.getByRole("spinbutton", { name: "Target completes" })).toHaveValue("10");
});

test("reflows and has no serious whole-page axe findings in fictional states", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/gate3-scoping-fixture");
  await page.addScriptTag({ content: axe.source });
  const workspace = page.getByRole("region", { name: "Scope a study" });
  await expect(workspace.getByText("What decision will this study inform?")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.evaluate(() => { document.body.style.zoom = "2"; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const violations = await page.evaluate(async () => {
    const results = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    });
    return results.violations.filter((item) => item.impact === "serious"
      || item.impact === "critical").map((item) => item.id);
  });
  expect(violations).toEqual([]);
});
