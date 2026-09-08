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
      testIgnore: [
        /global\.setup\.ts/, /screenshots\.spec\.ts/, /audit\.spec\.ts/,
        // Needs FRESH_EXPORT and live network; it has its own project.
        /durable-media\.spec\.ts/,
        // Needs the seeded c2-explorer dataset with archived previews.
        /c2\.spec\.ts/,
      ],
    },
    {
      // Opt-in: visual capture writes files, it does not assert, so it stays out
      // of the default run. Use: npx playwright test --project=visual
      name: "visual",
      dependencies: ["setup"],
      testMatch: /screenshots\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Real archival proof against live signed URLs. Needs FRESH_EXPORT and
      // network access, so it is opt-in: npx playwright test --project=durable
      name: "durable",
      dependencies: ["setup"],
      testMatch: /durable-media.spec.ts/,
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // C2 explorer capture and geometry. Needs the seeded c2-explorer dataset
      // with archived previews, so it runs on its own rather than in the gate.
      name: "c2",
      testMatch: /c2.spec.ts/,
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // C3 dataset and import corrections. Imports its own fixtures, so it needs
      // the shared login sessions but nothing else.
      name: "c3",
      dependencies: ["setup"],
      testMatch: /c3.spec.ts/,
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // The V2/V3 audit capture matrix. Opt-in evidence gathering, not a gate.
      name: "audit",
      dependencies: ["setup"],
      testMatch: /audit\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
  ],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
