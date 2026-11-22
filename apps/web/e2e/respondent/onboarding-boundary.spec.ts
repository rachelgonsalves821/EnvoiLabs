import { expect, test } from "@playwright/test";

test("respondent onboarding keeps the profile and choices behind account authentication", async ({ page }) => {
  await page.goto("/r/onboarding");
  await expect(page).toHaveURL(/\/r\/signup$/);
  await expect(page.getByRole("heading", { name: "Sign in with email" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find studies that fit" })).toHaveCount(0);
});

test("an interview route requires the respondent to sign in first", async ({ page }) => {
  await page.goto("/r/interviews/11111111-1111-4111-8111-111111111111");
  await expect(page).toHaveURL(/\/r\/signup$/);
  await expect(page.getByRole("heading", { name: "Sign in with email" })).toBeVisible();
});
