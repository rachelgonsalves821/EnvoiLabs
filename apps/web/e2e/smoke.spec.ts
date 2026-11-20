import { expect, test } from "@playwright/test";

test("the app renders its home screen", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.ok()).toBe(true);
  await expect(page.getByRole("heading", { name: "Envoi Labs", exact: true })).toBeVisible();
});
