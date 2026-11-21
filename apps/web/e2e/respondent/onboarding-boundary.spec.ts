import { expect, test } from "@playwright/test";

test("respondent onboarding keeps the profile and choices behind account authentication", async ({ page }) => {
  await page.goto("/r/onboarding");
  await expect(page).toHaveURL(/\/r\/signup$/);
  await expect(page.getByRole("heading", { name: "Sign in with email" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find studies that fit" })).toHaveCount(0);
});
