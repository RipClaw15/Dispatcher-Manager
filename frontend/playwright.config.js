import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90000,
  expect: { timeout: 12000 },
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5173",
    channel: "msedge",
    headless: true,
    actionTimeout: 12000,
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Europe/Bucharest",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
