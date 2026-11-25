import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3107";

export default defineConfig({
  testDir: "./apps/web/e2e/researcher",
  testMatch: "report-panel-fixture.spec.ts",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "fixture-chromium", use: devices["Desktop Chrome"] },
    { name: "fixture-webkit", use: devices["iPhone 13"] },
  ],
  webServer: {
    command: "pnpm --filter @envoi-labs/web exec next dev --hostname 127.0.0.1 --port 3107",
    env: { ENVOI_GATE3_REPORT_FIXTURE: "1" },
    url: `${baseURL}/gate3-report-fixture`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
