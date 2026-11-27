import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../../apps/web/e2e",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "desktop-chromium", use: devices["Desktop Chrome"] }],
});
