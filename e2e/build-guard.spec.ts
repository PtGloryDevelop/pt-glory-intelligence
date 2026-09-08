import { expect, test } from "@playwright/test";
import { builtFingerprint, sourceFingerprint } from "../scripts/build-fingerprint.ts";

/**
 * Runs in every project, first, so a stale build fails here — loudly, in one
 * line — instead of surfacing as a screenful of invented visual regressions
 * somewhere in the middle of the suite.
 *
 * scripts/test-server.mjs already rebuilds when the source has moved, so this
 * failing means the server under test is not the one that script produced:
 * something else is holding the port, or the build was skipped.
 */
test("the server under test was built from the working tree", async () => {
  const current = await sourceFingerprint();
  expect(
    builtFingerprint(),
    "the running server was built from different source than the working tree; " +
    "stop any process on the Playwright port and re-run",
  ).toBe(current);
});
