import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Playwright has no --env-file, and every secret this suite needs already lives
// in .env.local. Nothing from it is ever logged.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  testDir: "e2e",
  // The journey imports into a shared DEV database; parallel workers would
  // truncate each other's rows mid-test.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
      testIgnore: [/global\.setup\.ts/, /screenshots\.spec\.ts/],
    },
    {
      // Opt-in: visual capture writes files, it does not assert, so it stays out
      // of the default run. Use: npx playwright test --project=visual
      name: "visual",
      dependencies: ["setup"],
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
