import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "./helpers.ts";

/** C12: the installed scheduler is bounded, machine-only and inert when unset. */
const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("the collection advance function and cron job are installed", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());

  const { rows: functions } = await client.query<{ definition: string }>(
    `select pg_get_functiondef(p.oid) as definition
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'run_collection_advance'`,
  );
  assert.equal(functions.length, 1, "exactly one advance function must exist");
  assert.match(functions[0].definition, /security definer/i);
  assert.match(functions[0].definition, /collection_advance_url/);
  assert.match(functions[0].definition, /collection_advance_token/);
  assert.match(functions[0].definition, /net\.http_post/);
  assert.match(functions[0].definition, /no work due/);

  for (const role of ["public", "anon", "authenticated"]) {
    const { rows } = await client.query<{ can: boolean }>(
      "select has_function_privilege($1, 'public.run_collection_advance()', 'execute') as can",
      [role],
    );
    assert.equal(rows[0].can, false, `${role} must not be able to run the scheduler`);
  }

  const { rows: jobs } = await client.query<{ schedule: string; active: boolean }>(
    "select schedule, active from cron.job where jobname = 'collection-advance'",
  );
  assert.equal(jobs.length, 1, "the advance cron job must be installed");
  assert.equal(jobs[0].schedule, "* * * * *");
  assert.equal(jobs[0].active, true);
});

test("an unset tick batch makes the installed function a no-op", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());
  const { rows } = await client.query<{ value: unknown }>(
    "select value from public.app_settings where key = 'collector.tick_batch'",
  );
  const previous = rows[0]?.value ?? null;
  try {
    await client.query(
      `insert into public.app_settings (key, value) values ('collector.tick_batch', 'null'::jsonb)
       on conflict (key) do update set value = excluded.value`,
    );
    await client.query("select public.run_collection_advance()");
  } finally {
    await client.query(
      `insert into public.app_settings (key, value) values ('collector.tick_batch', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify(previous)],
    );
  }
  assert.ok(true, "the no-op completed without enqueueing an HTTP request");
});
