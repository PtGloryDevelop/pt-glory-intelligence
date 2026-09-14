import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { connect } from "./helpers.ts";

/**
 * C04 — the collection request ledger, asserted against the database.
 *
 * Every rule the state machine depends on is a constraint here, so these cases
 * try to break each one directly. If the machine is ever wrong, the database is
 * what refuses; a test that only exercised application code would prove nothing
 * about that.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

/** A signed-up user and a category, because the request references both. */
async function fixtures(client: pg.Client) {
  const email = `c04-${randomUUID()}@example.test`;
  const { rows: user } = await client.query<{ id: string }>(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', $1, '', now(), now(), now())
     returning id`,
    [email],
  );
  const { rows: category } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`C04 ${randomUUID().slice(0, 8)}`],
  );
  return { userId: user[0].id, categoryId: category[0].id };
}

type Row = Record<string, unknown>;

/** Inserts one request, letting the caller override any column. */
async function insertRequest(client: pg.Client, base: Row, overrides: Row = {}) {
  const row = { ...base, ...overrides };
  const columns = Object.keys(row);
  const values = columns.map((_, i) => `$${i + 1}`);
  return client.query(
    `insert into public.collection_requests (${columns.join(", ")})
     values (${values.join(", ")}) returning id`,
    Object.values(row),
  );
}

async function refused(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
    assert.fail(`expected a refusal matching ${pattern}`);
  } catch (error) {
    const message = (error as Error).message;
    if (/^expected a refusal/.test(message)) throw error;
    assert.match(message, pattern);
  }
}

test("collection_requests enforces its invariants in the schema", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());
  const { userId, categoryId } = await fixtures(client);
  const base = {
    requested_by: userId,
    request_key: randomUUID(),
    params: JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 100 }),
    category_id: categoryId,
  };
  const fresh = (overrides: Row = {}) => ({ ...base, request_key: randomUUID(), ...overrides });

  await t.test("a queued request is accepted with nothing else set", async () => {
    const { rows } = await insertRequest(client, fresh());
    assert.ok(rows.length === 1);
    const { rows: stored } = await client.query<{ status: string; cost_status: string; requires_admin: boolean }>(
      "select status, cost_status, requires_admin from public.collection_requests where id = $1",
      [(rows[0] as { id: string }).id],
    );
    assert.deepEqual(stored[0], { status: "queued", cost_status: "reserved", requires_admin: false });
  });

  await t.test("settling is a state, and an invented one is refused", async () => {
    const { rows } = await insertRequest(client, fresh({
      status: "settling", provider_run_id: randomUUID(), started_at: new Date().toISOString(),
    }));
    assert.equal(rows.length, 1);
    await refused(
      insertRequest(client, fresh({ status: "reconciling" })),
      /collection_requests_status_check/,
    );
  });

  await t.test("running, settling and importing each need an identified run", async () => {
    for (const status of ["running", "settling", "importing"]) {
      await refused(
        insertRequest(client, fresh({ status })),
        /collection_requests_run_identified/,
      );
    }
  });

  await t.test("a queued request cannot claim it already attempted a start", async () => {
    await refused(
      insertRequest(client, fresh({ start_attempted_at: new Date().toISOString() })),
      /collection_requests_queued_untouched/,
    );
  });

  await t.test("a terminal request carries a finish time", async () => {
    for (const status of ["succeeded", "failed"]) {
      await refused(insertRequest(client, fresh({ status })), /collection_requests_terminal_finished/);
    }
  });

  await t.test("cost reconciliation cannot be scheduled before a run is identified", async () => {
    await refused(
      insertRequest(client, fresh({ cost_next_check_at: new Date().toISOString() })),
      /collection_requests_cost_check_needs_run/,
    );
    const { rows } = await insertRequest(client, fresh({
      status: "running", provider_run_id: randomUUID(),
      started_at: new Date().toISOString(), cost_next_check_at: new Date().toISOString(),
    }));
    assert.equal(rows.length, 1, "with a run identified it is allowed");
  });

  await t.test("one provider run and one canonical run belong to one request", async () => {
    const runId = randomUUID();
    await insertRequest(client, fresh({ status: "running", provider_run_id: runId, started_at: new Date().toISOString() }));
    await refused(
      insertRequest(client, fresh({ status: "running", provider_run_id: runId, started_at: new Date().toISOString() })),
      /collection_requests_provider_run_unique/,
    );
  });

  await t.test("the same submission cannot be queued twice", async () => {
    const key = randomUUID();
    await insertRequest(client, { ...base, request_key: key });
    await refused(
      insertRequest(client, { ...base, request_key: key }),
      /collection_requests_request_key_unique/,
    );
  });

  await t.test("an error class outside the documented set is refused", async () => {
    for (const error_class of [
      "provider_start_unknown", "provider_result_unsettled",
      // 0038: a contradiction between persisted and reported identity.
      "provider_identity_conflict",
    ]) {
      const { rows } = await insertRequest(client, fresh({ error_class }));
      assert.equal(rows.length, 1, `${error_class} is a documented class`);
    }
    await refused(
      insertRequest(client, fresh({ error_class: "provider_start_unresolved" })),
      /collection_requests_error_class_check/,
    );
  });

  await t.test("a scrubbed error detail stays bounded", async () => {
    await refused(
      insertRequest(client, fresh({ error_detail: "x".repeat(2001) })),
      /collection_requests_error_detail_check/,
    );
  });
});

test("the reservation release is all three fields, with a real reason", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());
  const { userId, categoryId } = await fixtures(client);
  const unresolved = {
    requested_by: userId,
    params: JSON.stringify({ keyword: "x", country: "TH", active_status: "active", max_records: 10 }),
    category_id: categoryId,
    // The frozen unresolved case: failed, no identified run, cost never reported.
    status: "failed",
    finished_at: new Date().toISOString(),
    error_class: "provider_start_unknown",
    cost_status: "unreported",
  };
  const fresh = (overrides: Row = {}) => ({ ...unresolved, request_key: randomUUID(), ...overrides });
  const release = {
    reservation_released_at: new Date().toISOString(),
    reservation_released_by: userId,
    reservation_release_reason: "no run found in the provider console after review",
  };

  await t.test("a valid unresolved release is accepted", async () => {
    const { rows } = await insertRequest(client, fresh(release));
    assert.equal(rows.length, 1);
  });

  await t.test("two of the three fields is refused, in every combination", async () => {
    const keys = Object.keys(release) as (keyof typeof release)[];
    for (const missing of keys) {
      const partial: Row = { ...release };
      delete partial[missing];
      await refused(insertRequest(client, fresh(partial)), /collection_requests_reservation_release/);
    }
  });

  await t.test("a blank reason is not a reason", async () => {
    for (const reason of ["", "   ", "\t"]) {
      await refused(
        insertRequest(client, fresh({ ...release, reservation_release_reason: reason })),
        /collection_requests_reservation_release/,
      );
    }
  });

  await t.test("a release cannot name a provider run", async () => {
    await refused(
      insertRequest(client, fresh({ ...release, provider_run_id: randomUUID() })),
      /collection_requests_reservation_release/,
    );
  });

  await t.test("a release only applies while the cost stays unreported", async () => {
    for (const cost_status of ["reserved", "provisional", "final"]) {
      await refused(
        insertRequest(client, fresh({ ...release, cost_status })),
        /collection_requests_reservation_release/,
      );
    }
  });
});

test("a request commits its canonical run exactly once", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());
  const requestId = randomUUID();
  const run = (summary: string) => client.query(
    `insert into public.collection_runs (
       source_product, collection_method, collector_schema_version, collected_at,
       computed_source_rows, computed_unique_ads, computed_unique_pages,
       computed_unresolved_count, status, reported_quality_summary)
     values ('PT Glory Collector', 'apify_actor_run', 'pt-glory-meta-ad-library-export.v1',
             now(), 0, 0, 0, 0, 'completed', $1::jsonb) returning id`,
    [summary],
  );

  await t.test("apify_actor_run is a collection method the database accepts", async () => {
    const { rows } = await run(JSON.stringify({ collection_request_id: requestId }));
    assert.equal(rows.length, 1);
  });

  await t.test("a second commit of the same request is refused", async () => {
    await refused(
      run(JSON.stringify({ collection_request_id: requestId })),
      /collection_runs_request_once/,
    );
  });

  await t.test("runs without a request id are unaffected", async () => {
    const { rows: first } = await run(JSON.stringify({ warning_records: 0 }));
    const { rows: second } = await run(JSON.stringify({ warning_records: 0 }));
    assert.ok(first.length === 1 && second.length === 1);
  });

  await t.test("a method nobody documented is still refused", async () => {
    await refused(
      client.query(
        `insert into public.collection_runs (
           source_product, collection_method, collector_schema_version, collected_at,
           computed_source_rows, computed_unique_ads, computed_unique_pages,
           computed_unresolved_count, status)
         values ('x', 'screenshot_ocr', 'v1', now(), 0, 0, 0, 0, 'completed')`,
      ),
      /collection_runs_collection_method_check/,
    );
  });
});

test("a requester reads only their own request, and only the user-safe columns", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());
  const mine = await fixtures(client);
  const theirs = await fixtures(client);
  const params = JSON.stringify({ keyword: "x", country: "TH", active_status: "active", max_records: 10 });

  const { rows: inserted } = await insertRequest(client, {
    requested_by: mine.userId, request_key: randomUUID(), params, category_id: mine.categoryId,
    provider: "apify", provider_actor: "curious_coder/facebook-ads-library-scraper",
    provider_run_id: randomUUID(), cost_reserved_usd: "0.1",
  });
  const mineId = (inserted[0] as { id: string }).id;
  await insertRequest(client, {
    requested_by: theirs.userId, request_key: randomUUID(), params, category_id: theirs.categoryId,
  });

  /** Runs a query as `authenticated` with a given auth.uid(), the way PostgREST does. */
  async function asUser<T extends Row>(userId: string | null, sql: string): Promise<T[]> {
    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims', $1, true)",
        [userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : JSON.stringify({ role: "authenticated" })]);
      const { rows } = await client.query<T>(sql);
      return rows;
    } finally {
      await client.query("rollback");
    }
  }

  await t.test("RLS hands back only the requester's own rows", async () => {
    const rows = await asUser<{ id: string }>(mine.userId, "select id from public.collection_request_status");
    assert.deepEqual(rows.map((r) => r.id), [mineId]);
    const others = await asUser<{ id: string }>(theirs.userId,
      `select id from public.collection_request_status where id = '${mineId}'`);
    assert.deepEqual(others, []);
  });

  await t.test("provider and cost columns are not selectable at all", async () => {
    for (const column of [
      "provider", "provider_actor", "provider_run_id", "provider_dataset_id",
      "error_detail", "cost_reserved_usd", "cost_next_check_at", "lease_owner",
      "reservation_release_reason", "result_charged_items",
    ]) {
      await assert.rejects(
        asUser(mine.userId, `select ${column} from public.collection_requests`),
        /permission denied/i,
        `${column} must not be readable`,
      );
    }
  });

  await t.test("the user-safe columns are readable through the table as well as the view", async () => {
    const rows = await asUser<{ status: string; requires_admin: boolean }>(
      mine.userId, "select status, requires_admin from public.collection_requests");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "queued");
  });

  await t.test("nobody can write a request through the API role", async () => {
    for (const statement of [
      `insert into public.collection_requests (requested_by, request_key, params, category_id)
         values ('${mine.userId}', '${randomUUID()}', '{}'::jsonb, '${mine.categoryId}')`,
      `update public.collection_requests set status = 'succeeded' where id = '${mineId}'`,
      `delete from public.collection_requests where id = '${mineId}'`,
    ]) {
      await assert.rejects(asUser(mine.userId, statement), /permission denied|violates row-level security/i);
    }
  });

  await t.test("an unauthenticated caller sees nothing", async () => {
    await client.query("begin");
    try {
      await client.query("set local role anon");
      await assert.rejects(
        client.query("select id from public.collection_request_status"),
        /permission denied/i,
      );
    } finally {
      await client.query("rollback");
    }
  });
});

test("every collector setting is present and configurable", { skip }, async (t) => {
  const client = await connect();
  t.after(() => client.end());

  const { rows } = await client.query<{ key: string; value: unknown }>(
    "select key, value from public.app_settings where key like 'collector.%' order by key",
  );
  const settings = new Map(rows.map((r) => [r.key, r.value]));

  await t.test("the values the design fixes are set", () => {
    assert.equal(settings.get("collector.max_concurrent"), 1);
    assert.equal(settings.get("collector.lease_seconds"), 120);
    assert.equal(settings.get("collector.enabled"), false);
    assert.deepEqual(settings.get("collector.countries"), ["TH"]);
    assert.equal(settings.get("collector.actor"), "curious_coder/facebook-ads-library-scraper");
  });

  await t.test("every price, budget and window starts unset", () => {
    for (const key of [
      "collector.monthly_budget_usd", "collector.max_charge_per_run_usd",
      "collector.estimated_usd_per_1000_ads", "collector.billing_cycle_anchor",
      "collector.billing_cycle_length_months", "collector.max_records_per_run",
      "collector.max_export_bytes", "collector.run_timeout_minutes",
      "collector.reconcile_window_minutes", "collector.reconcile_page_size",
      "collector.cost_settle_minutes", "collector.cost_final_window_hours",
      "collector.result_settle_seconds", "collector.result_settle_window_minutes",
      "collector.tick_batch", "collector.actor_build",
    ]) {
      assert.ok(settings.has(key), `${key} must exist`);
      assert.equal(settings.get(key), null, `${key} must start unset`);
    }
  });
});
