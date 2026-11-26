import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "../../apps/web/e2e",
  use: { baseURL: "http://127.0.0.1:3100", trace: "off" },
  projects: [{ name: "desktop-chromium", use: devices["Desktop Chrome"] }],
});
