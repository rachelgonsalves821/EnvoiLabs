import { expect, test, type Locator } from "@playwright/test";
import axe from "axe-core";

async function seriousAxeViolations(root: Locator) {
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

test("whole researcher sign-in and confirmation pages have no serious or critical axe findings", async ({ page }) => {
  await page.route("**/api/researcher/auth/start", (route) =>
    route.fulfill({ json: { ok: true } }));
  await page.goto("/app/sign-in?error=expired");
  await page.addScriptTag({ content: axe.source });
  const main = page.getByRole("main");
  const document = page.locator("html");
  await expect(main.getByRole("alert")).toBeVisible();
  expect(await seriousAxeViolations(document)).toEqual([]);
  await main.getByLabel("Email address").fill("fictional-researcher@example.test");
  await main.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(main.getByRole("status")).toContainText("Check your email");
  expect(await seriousAxeViolations(document)).toEqual([]);
});

test("whole researcher MFA setup and challenge pages have no serious or critical axe findings", async ({ page }) => {
  await page.route("**/api/researcher/auth/mfa", async (route) => {
    const { action } = route.request().postDataJSON();
    if (action === "status") return route.fulfill({ json: { state: "enroll" } });
    if (action === "enroll") return route.fulfill({ json: {
      factorId: "fictional-factor", secret: "JBSWY3DPEHPK3PXP",
    } });
    if (action === "challenge") return route.fulfill({ json: { challengeId: "fictional-challenge" } });
    if (action === "verify") return route.fulfill({ status: 400 });
    throw new Error("Unexpected fictional MFA action");
  });
  await page.goto("/app/mfa");
  await page.addScriptTag({ content: axe.source });
  const main = page.getByRole("main");
  const document = page.locator("html");
  await expect(main.getByRole("button", { name: "Show setup key" })).toBeVisible();
  expect(await seriousAxeViolations(document)).toEqual([]);
  await main.getByRole("button", { name: "Show setup key" }).click();
  await expect(main.getByText("JBSWY3DPEHPK3PXP")).toBeVisible();
  expect(await seriousAxeViolations(document)).toEqual([]);
  await main.getByLabel("Authenticator code").fill("000000");
  await main.getByRole("button", { name: "Verify and continue" }).click();
  await expect(main.getByRole("alert")).toBeVisible();
  expect(await seriousAxeViolations(document)).toEqual([]);
});
