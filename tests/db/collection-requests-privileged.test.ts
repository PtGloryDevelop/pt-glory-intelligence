import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { connect } from "./helpers.ts";

/**
 * C04 — the server's own write path can run a collection request end to end.
 *
 * WHICH PATH: lib/db/privileged.ts opens a direct Postgres connection from
 * DATABASE_URL and states plainly that it bypasses RLS. That connection — the
 * same one this helper uses — is what commitImport, the media archive and the
 * scheduled scripts already write through, and it is what the Phase 15 worker
 * will use. It is NOT service_role: service_role is the PostgREST API role,
 * which the server never writes through, so it stays with no access at all.
 *
 * Everything here runs inside one transaction and rolls back, so the proof
 * leaves no rows behind.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";

test("the privileged server path owns the whole request lifecycle", { skip }, async (t) => {
  const client = await connect();
  await client.query("begin");
  // One hook, in order: the proof rolls back before the connection closes, so
  // nothing it wrote survives and nothing is left half-open.
  t.after(async () => {
    await client.query("rollback");
    await client.end();
  });

  const { rows: who } = await client.query<{
    current_user: string; bypassrls: boolean; owner: string;
  }>(
    `select current_user,
            (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls,
            (select tableowner from pg_tables
              where schemaname = 'public' and tablename = 'collection_requests') as owner`,
  );

  await t.test("the path is the DATABASE_URL role, and it is not service_role", () => {
    assert.notEqual(who[0].current_user, "service_role", "the write path is never the API role");
    assert.equal(who[0].bypassrls, true, "the write path bypasses RLS by design");
    assert.equal(who[0].owner, who[0].current_user, "and it owns the table it writes");
  });

  // Fixtures: a requester and a category, both inside the transaction.
  const { rows: user } = await client.query<{ id: string }>(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                             email_confirmed_at, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
             'authenticated', $1, '', now(), now(), now())
     returning id`,
    [`c04-worker-${randomUUID()}@example.test`],
  );
  const { rows: category } = await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id",
    [`C04 worker ${randomUUID().slice(0, 8)}`],
  );

  let requestId = "";
  const providerRunId = randomUUID();

  await t.test("admission inserts the request", async () => {
    const { rows } = await client.query<{ id: string; status: string }>(
      `insert into public.collection_requests
         (requested_by, request_key, params, category_id, source_url, cost_reserved_usd, next_check_at)
       values ($1, $2, $3::jsonb, $4, $5, $6, now())
       returning id, status`,
      [
        user[0].id, randomUUID(),
        JSON.stringify({ keyword: "วิตามิน", country: "TH", active_status: "active", max_records: 100 }),
        category[0].id, "https://www.facebook.com/ads/library/?q=test", "0.100000",
      ],
    );
    requestId = rows[0].id;
    assert.equal(rows[0].status, "queued");
  });

  await t.test("it reads the internal and provider columns it just wrote", async () => {
    const { rows } = await client.query<Record<string, unknown>>(
      `select provider, provider_run_id, provider_dataset_id, error_class, error_detail,
              cost_status, cost_reserved_usd, cost_next_check_at, lease_owner, lease_expires_at,
              next_check_at, attempt, start_attempted_at, result_item_count
         from public.collection_requests where id = $1`,
      [requestId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cost_status, "reserved");
    assert.equal(rows[0].cost_reserved_usd, "0.100000");
  });

  await t.test("it claims a lease and moves the request out of queued", async () => {
    const { rowCount } = await client.query(
      `update public.collection_requests
          set status = 'starting', lease_owner = $2, lease_expires_at = now() + interval '120 seconds',
              attempt = attempt + 1, start_attempted_at = now(), updated_at = now()
        where id = $1 and start_attempted_at is null`,
      [requestId, `worker-${randomUUID().slice(0, 8)}`],
    );
    assert.equal(rowCount, 1);
  });

  await t.test("it records the provider run and schedules cost reconciliation", async () => {
    const { rowCount } = await client.query(
      `update public.collection_requests
          set status = 'running', provider = 'apify', provider_actor = $2,
              provider_actor_build = '2.7.25', provider_run_id = $3, provider_dataset_id = $4,
              started_at = now(), next_check_at = now() + interval '30 seconds',
              cost_next_check_at = now() + interval '5 minutes', updated_at = now()
        where id = $1`,
      [requestId, "curious_coder/facebook-ads-library-scraper", providerRunId, randomUUID()],
    );
    assert.equal(rowCount, 1);
  });

  await t.test("it writes the settlement observations while the dataset settles", async () => {
    const { rowCount } = await client.query(
      `update public.collection_requests
          set status = 'settling', result_settle_started_at = now(),
              result_item_count = 133, result_modified_at = now() - interval '1 second',
              result_pagination_total = 133, result_observed_at = now(),
              result_charged_items = 133, provider_item_count = 133, updated_at = now()
        where id = $1`,
      [requestId],
    );
    assert.equal(rowCount, 1);
  });

  await t.test("it moves the cost through its own lifecycle", async () => {
    await client.query(
      `update public.collection_requests
          set cost_status = 'provisional', cost_provisional_usd = 0.0443,
              cost_first_read_at = now(), cost_next_check_at = now() + interval '5 minutes'
        where id = $1`,
      [requestId],
    );
    const { rowCount } = await client.query(
      `update public.collection_requests
          set cost_status = 'final', cost_final_usd = 0.0998, cost_finalized_at = now(),
              cost_next_check_at = null, ceiling_reached = false
        where id = $1`,
      [requestId],
    );
    assert.equal(rowCount, 1);
  });

  await t.test("it marks the request terminal with its canonical run", async () => {
    const { rows: run } = await client.query<{ id: string }>(
      `insert into public.collection_runs (
         source_product, collection_method, collector_schema_version, collected_at,
         computed_source_rows, computed_unique_ads, computed_unique_pages,
         computed_unresolved_count, status, reported_quality_summary)
       values ('PT Glory Collector', 'apify_actor_run', 'pt-glory-meta-ad-library-export.v1',
               now(), 133, 133, 37, 0, 'completed', $1::jsonb) returning id`,
      [JSON.stringify({ collection_request_id: requestId })],
    );
    const { rows } = await client.query<{ status: string; finished_at: string }>(
      `update public.collection_requests
          set status = 'succeeded', finished_at = now(), collection_run_id = $2,
              result = $3::jsonb, stop_reason = 'limit_reached',
              import_attempted_at = now(), media_enqueued_at = now(),
              lease_owner = null, lease_expires_at = null, next_check_at = null,
              updated_at = now()
        where id = $1
       returning status, finished_at`,
      [requestId, run[0].id, JSON.stringify({ ads: 133, pages: 37, quarantine: 0 })],
    );
    assert.equal(rows[0].status, "succeeded");
    assert.ok(rows[0].finished_at, "a terminal request carries a finish time");
  });

  await t.test("the API roles still cannot reach what the worker just wrote", async () => {
    for (const column of ["provider_run_id", "cost_final_usd", "lease_owner", "error_detail"]) {
      const { rows } = await client.query<{ auth: boolean; anon: boolean; service: boolean }>(
        `select has_column_privilege('authenticated', 'public.collection_requests', $1, 'SELECT') as auth,
                has_column_privilege('anon', 'public.collection_requests', $1, 'SELECT') as anon,
                has_column_privilege('service_role', 'public.collection_requests', $1, 'SELECT') as service`,
        [column],
      );
      assert.deepEqual(rows[0], { auth: false, anon: false, service: false }, column);
    }
    for (const role of ["authenticated", "anon", "service_role"]) {
      for (const command of ["INSERT", "UPDATE", "DELETE"]) {
        const { rows } = await client.query<{ x: boolean }>(
          "select has_table_privilege($1, 'public.collection_requests', $2) as x", [role, command],
        );
        assert.equal(rows[0].x, false, `${role} must not ${command}`);
      }
    }
  });
});
