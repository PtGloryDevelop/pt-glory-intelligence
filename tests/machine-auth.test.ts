import assert from "node:assert/strict";
import test from "node:test";
import { authenticateMachine } from "../lib/media/machine-auth.ts";

/**
 * The scheduler's credentials. Separate from the user session model on purpose:
 * a cron job is not a person, and reusing an analyst cookie would mean either
 * the scheduler holds someone's session or the endpoint accepts anonymous
 * callers.
 */

const SECRET = "0123456789abcdef0123456789abcdef";

test("an unset or too-short secret never means 'allow'", () => {
  const previous = process.env.MEDIA_ARCHIVE_TOKEN;
  try {
    delete process.env.MEDIA_ARCHIVE_TOKEN;
    assert.equal(authenticateMachine(`Bearer ${SECRET}`), "not_configured");
    assert.equal(authenticateMachine(null), "not_configured");

    // A short secret is treated as no secret rather than as a weak one.
    process.env.MEDIA_ARCHIVE_TOKEN = "short";
    assert.equal(authenticateMachine("Bearer short"), "not_configured");
  } finally {
    if (previous === undefined) delete process.env.MEDIA_ARCHIVE_TOKEN;
    else process.env.MEDIA_ARCHIVE_TOKEN = previous;
  }
});

test("only the exact bearer token authenticates", () => {
  const previous = process.env.MEDIA_ARCHIVE_TOKEN;
  process.env.MEDIA_ARCHIVE_TOKEN = SECRET;
  try {
    assert.equal(authenticateMachine(`Bearer ${SECRET}`), "ok");
    assert.equal(authenticateMachine(`Bearer  ${SECRET} `), "ok", "surrounding space is tolerated");

    for (const bad of [
      null, "", "Bearer", "Bearer ", `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`,
      SECRET, `Basic ${SECRET}`, `bearer ${SECRET}`, "Bearer 0000000000000000",
      // A correct prefix must not pass: that is what a timing oracle would build.
      `Bearer ${SECRET.slice(0, 16)}`,
    ]) {
      assert.equal(authenticateMachine(bad), "unauthorized", JSON.stringify(bad));
    }
  } finally {
    if (previous === undefined) delete process.env.MEDIA_ARCHIVE_TOKEN;
    else process.env.MEDIA_ARCHIVE_TOKEN = previous;
  }
});

test("the secret is not a NEXT_PUBLIC variable", () => {
  // Next inlines anything prefixed NEXT_PUBLIC_ into the client bundle. The name
  // itself is the control here, so it is worth asserting.
  assert.ok(!("NEXT_PUBLIC_MEDIA_ARCHIVE_TOKEN" in process.env));
});
