import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "./helpers.ts";

/**
 * Migration 0034, asserted against the database rather than against the file.
 *
 * `tests/migrations.test.ts` already parses the migration text and proves the
 * arithmetic holds there. That is the right check for the SQL somebody is about
 * to commit, and the wrong one for the function that is actually installed: a
 * later `create or replace`, a hand-edit in the SQL editor, or a migration
 * applied out of order would all leave the file correct and the database wrong.
 *
 * The failure this protects against is not a slow drain. It is the loss of the
 * only delivery evidence the system has. When a tick exceeds
 * `timeout_milliseconds`, pg_net records `Timeout of 120000 ms reached` instead
 * of an HTTP status, and `net._http_response` can no longer tell a healthy run
 * from a dead one — which is exactly the C1.8 failure, where cron reported
 * success while nothing was delivered.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

/** Measured against the pilot deployment: fetch, transcode, write to storage. */
const SECONDS_PER_ASSET = 1.6;

test("the installed drain finishes inside the pg_net timeout", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());

  const { rows } = await client.query<{ definition: string }>(
    "select pg_get_functiondef(p.oid) as definition\n" +
    "  from pg_proc p join pg_namespace n on n.oid = p.pronamespace\n" +
    " where n.nspname = 'public' and p.proname = 'run_media_archive_drain'",
  );

  assert.equal(rows.length, 1, "exactly one run_media_archive_drain must exist");
  const definition = rows[0].definition;

  const limit = Number(/'limit',\s*(\d+)/.exec(definition)?.[1]);
  const timeoutMs = Number(/timeout_milliseconds\s*:=\s*(\d+)/.exec(definition)?.[1]);
  assert.ok(
    Number.isFinite(limit) && Number.isFinite(timeoutMs),
    "the installed function must state both a batch limit and a pg_net timeout",
  );

  const needed = limit * SECONDS_PER_ASSET;
  const budget = timeoutMs / 1000;
  assert.ok(
    needed < budget,
    `a batch of ${limit} needs ~${needed}s but pg_net waits ${budget}s — ` +
    "the tick would record a timeout instead of an HTTP status",
  );

  // Sized so a full tick still finishes with room to spare, not merely inside
  // the window by a second.
  assert.ok(
    needed <= budget * 0.8,
    `a batch of ${limit} uses ${Math.round((needed / budget) * 100)}% of the pg_net window`,
  );
});

test("the drain stays machine-only", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());

  for (const role of ["public", "anon", "authenticated"]) {
    const { rows } = await client.query<{ can: boolean }>(
      "select has_function_privilege($1, 'public.run_media_archive_drain()', 'execute') as can",
      [role],
    );
    assert.equal(rows[0].can, false, `${role} must not be able to run the drain`);
  }
});
