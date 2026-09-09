import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Playwright has no --env-file, and every secret this suite needs already lives
// in .env.local. Nothing from it is ever logged.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Its own port, so `npm run dev` on 3000 keeps working while the suite runs,
// and so the suite can insist on owning the server it tests.
const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3177);

/** Every project runs the stale-build guard before its own tests. */
const GUARD = /build-guard\.spec\.ts/;

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
    baseURL: `http://127.0.0.1:${PORT}`,
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
        // Need the seeded c2-explorer dataset with archived previews.
        /c2\.spec\.ts/, /v4\.spec\.ts/, /v5\.spec\.ts/,
        // Imports its own fixture and needs the seeded sessions; own project.
        /p2-pages\.spec\.ts/, /p2-timeline\.spec\.ts/, /p2-category\.spec\.ts/, /p2-compare\.spec\.ts/,
        /p2-trends\.spec\.ts/, /p2-watchlist\.spec\.ts/, /p2-brand-mapping\.spec\.ts/,
      ],
    },
    {
      // Opt-in: visual capture writes files, it does not assert, so it stays out
      // of the default run. Use: npx playwright test --project=visual
      name: "visual",
      dependencies: ["setup"],
      testMatch: [GUARD, /screenshots\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Real archival proof against live signed URLs. Needs FRESH_EXPORT and
      // network access, so it is opt-in: npx playwright test --project=durable
      name: "durable",
      dependencies: ["setup"],
      testMatch: [GUARD, /durable-media\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // C2 explorer capture and geometry. Needs the seeded c2-explorer dataset
      // with archived previews, so it runs on its own rather than in the gate.
      name: "c2",
      testMatch: [GUARD, /c2\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // C3 dataset and import corrections. Imports its own fixtures, so it needs
      // the shared login sessions but nothing else.
      name: "c3",
      dependencies: ["setup"],
      testMatch: [GUARD, /c3\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // V4 drawer. Needs the seeded c2-explorer dataset with archived previews.
      name: "v4",
      testMatch: [GUARD, /v4\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // V5 final consistency sweep and the release screenshot set. Same seeded
      // dataset, because the captures must show real archived media.
      name: "v5",
      testMatch: [GUARD, /v5\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // P2.1 Page Intelligence. Imports its own fixture through the real flow,
      // so it needs the shared login sessions and nothing else.
      name: "p2",
      dependencies: ["setup"],
      testMatch: [
        GUARD, /p2-pages\.spec\.ts/, /p2-timeline\.spec\.ts/,
        /p2-category\.spec\.ts/, /p2-compare\.spec\.ts/, /p2-trends\.spec\.ts/,
        /p2-watchlist\.spec\.ts/, /p2-brand-mapping\.spec\.ts/,
      ],
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      // The V2/V3 audit capture matrix. Opt-in evidence gathering, not a gate.
      name: "audit",
      dependencies: ["setup"],
      testMatch: [GUARD, /audit\.spec\.ts/],
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
  ],
  webServer: {
    // Rebuilds when the source hash has moved and refuses a borrowed server.
    command: "node --experimental-strip-types scripts/test-server.mjs",
    url: `http://127.0.0.1:${PORT}`,
    // Never attach to a server this run did not start: that is exactly how a
    // stale build gets tested.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "pipe",
  },
});
