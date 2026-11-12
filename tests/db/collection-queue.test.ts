import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import type pg from "pg";
import { connect, createAuthUser } from "./helpers.ts";
import { admitCollection, type AdmissionInput } from "../../lib/collect/admission.ts";
import { advance } from "../../lib/collect/machine.ts";
import { createMockProvider, mockRun } from "../../lib/collect/mock.ts";
import { closePool } from "../../lib/db/privileged.ts";
import * as scheduledWork from "../../lib/collect/advance-scheduler.ts";
import { updateCollectorSettings } from "../../lib/collect/admin.ts";
import { ADMISSION_LOCK_NAMESPACE } from "../../lib/collect/queue.ts";

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const NOW = new Date("2026-11-12T00:00:00Z");
const SETTINGS: Record<string, unknown> = {
  "collector.enabled": true,
  "collector.monthly_budget_usd": 10,
  "collector.max_charge_per_run_usd": 0.5,
  "collector.billing_cycle_anchor": "2026-11-01",
  "collector.billing_cycle_length_months": 1,
  "collector.max_records_per_run": 500,
  "collector.max_concurrent": 5,
  "collector.actor_build": "2.7.25",
  "collector.countries": ["TH"],
  "collector.run_timeout_minutes": 10,
  "collector.lease_seconds": 120,
};

test("the shared collection queue reserves only atomic paid starts", { skip }, async (t) => {
  const client = await connect();
  const saved = (await client.query("select key, value from public.app_settings where key like 'collector.%'")).rows;
  const users: string[] = [];
  for (let i = 0; i < 8; i += 1) users.push(await createAuthUser(client, `queue-${i}-${randomUUID()}@example.test`));
  const categoryId = (await client.query<{ id: string }>(
    "insert into public.categories (name) values ($1) returning id", [`Queue ${randomUUID()}`],
  )).rows[0].id;
  t.after(async () => {
    await client.query("delete from public.collection_requests");
    await client.query("delete from public.app_settings where key like 'collector.%'");
    for (const row of saved) await client.query("insert into public.app_settings (key,value) values ($1,$2::jsonb)", [row.key, JSON.stringify(row.value)]);
    await client.end();
    await closePool();
  });
  const reset = async (overrides: Record<string, unknown> = {}) => {
    await client.query("delete from public.collection_requests");
    for (const [key, value] of Object.entries({ ...SETTINGS, ...overrides })) {
      await client.query("insert into public.app_settings (key,value) values ($1,$2::jsonb) on conflict(key) do update set value=excluded.value", [key, JSON.stringify(value)]);
    }
  };
  const input = (user = users[0]): AdmissionInput => ({
    requestedBy: user, requestKey: randomUUID(), keyword: "วิตามิน", country: "TH",
    activeStatus: "active", maxRecords: 300, categoryId, datasetName: "Queue proof",
  });
  const enqueue = async (count: number) => {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const result = await admitCollection(input(users[i % users.length]), { now: NOW });
      assert.ok(result.ok, `request ${i} is admitted`);
      ids.push(result.requestId);
      // Explicit order makes FIFO proof independent of wall-clock resolution.
      await client.query("update public.collection_requests set created_at=$2 where id=$1", [result.requestId, new Date(NOW.getTime() + i * 1000)]);
    }
    return ids;
  };
  const mock = () => createMockProvider({ start: (request) => ({ outcome: "started", run: mockRun({
    runId: `RUN-${request.runTag}`, datasetId: `DS-${request.runTag}`, status: "RUNNING",
    startedAt: NOW.toISOString(), finishedAt: null,
  }) }) }, { PT_GLORY_ENV: "test" });
  const state = async (id: string) => (await client.query<{
    status: string; cost_reserved_usd: string | null; start_attempted_at: string | null;
  }>("select status,cost_reserved_usd,start_attempted_at from public.collection_requests where id=$1", [id])).rows[0];
  const dispatch = async (ids: string[], provider: ReturnType<typeof mock>) => {
    // Multiple rounds let races that find a predecessor still queued retry.
    for (let round = 0; round < ids.length; round += 1) {
      await Promise.all(ids.map((id, i) => advance(id, { provider, now: NOW, worker: `queue-${round}-${i}` })));
      await client.query("update public.collection_requests set next_check_at=null where status='queued'");
    }
  };

  await t.test("eight users are accepted with no money held, and duplicate keys remain one row", async () => {
    await reset({ "collector.max_concurrent": 1, "collector.monthly_budget_usd": 0.01 });
    const submissions = users.map((user) => input(user));
    const answers = await Promise.all(submissions.map((submission) => admitCollection(submission, { now: NOW })));
    assert.ok(answers.every((answer) => answer.ok));
    for (const answer of answers) if (answer.ok) assert.equal(answer.reservedUsd, null);
    const retries = await Promise.all(Array.from({ length: 5 }, () => admitCollection(submissions[0], { now: NOW })));
    assert.ok(retries.every((answer) => answer.ok && answer.reused && answers[0].ok && answer.requestId === answers[0].requestId));
    const rows = (await client.query("select status,cost_reserved_usd,start_attempted_at from public.collection_requests")).rows;
    assert.equal(rows.length, 8);
    assert.ok(rows.every((row) => row.status === "queued" && row.cost_reserved_usd === null && row.start_attempted_at === null));
  });

  await t.test("racing workers cannot exceed five starts; releasing a slot starts the oldest waiter", async () => {
    await reset({ "collector.max_concurrent": 50 });
    const ids = await enqueue(8);
    const provider = mock();
    await dispatch(ids, provider);
    assert.equal(provider.startCount, 5, "provider account limit clamps a larger app setting");
    for (const id of ids.slice(0, 5)) assert.equal((await state(id)).status, "running");
    for (const id of ids.slice(5)) assert.deepEqual(await state(id), { status: "queued", cost_reserved_usd: null, start_attempted_at: null });
    await client.query("update public.collection_requests set status='failed',finished_at=now(),cost_status='final',cost_final_usd=0 where id=$1", [ids[0]]);
    await advance(ids[7], { provider, now: NOW });
    assert.equal(provider.startCount, 5, "a later waiter cannot jump the older one");
    await advance(ids[5], { provider, now: NOW });
    assert.equal(provider.startCount, 6);
    assert.equal((await state(ids[5])).status, "running");
    assert.equal((await state(ids[6])).status, "queued");
  });

  await t.test("the configured smaller slot count is also enforced", async () => {
    await reset({ "collector.max_concurrent": 2 });
    const ids = await enqueue(4);
    const provider = mock();
    await dispatch(ids, provider);
    assert.equal(provider.startCount, 2);
  });

  await t.test("concurrent budget reservations use exact remaining funds and leave depletion queued", async () => {
    await reset({ "collector.monthly_budget_usd": 0.750001 });
    const ids = await enqueue(6);
    const provider = mock();
    await dispatch(ids, provider);
    assert.equal(provider.startCount, 2);
    assert.equal((await state(ids[0])).cost_reserved_usd, "0.500000");
    assert.equal((await state(ids[1])).cost_reserved_usd, "0.250001");
    const held = (await client.query("select sum(cost_reserved_usd)::text as total from public.collection_requests")).rows[0].total;
    assert.equal(held, "0.750001");
    for (const id of ids.slice(2)) assert.deepEqual(await state(id), { status: "queued", cost_reserved_usd: null, start_attempted_at: null });
  });

  await t.test("poll-only calls never reserve or start a queued request", async () => {
    await reset();
    const [id] = await enqueue(1);
    const provider = mock();
    await Promise.all(Array.from({ length: 10 }, () => advance(id, { provider, allowStart: false, now: NOW })));
    assert.equal(provider.startCount, 0);
    assert.deepEqual(await state(id), { status: "queued", cost_reserved_usd: null, start_attempted_at: null });
  });

  await t.test("uncertain and admin-held active states each occupy a slot", async () => {
    await reset();
    const ids = await enqueue(6);
    for (const [i, status] of ["starting", "provider_start_uncertain", "running", "settling", "importing"].entries()) {
      await client.query("update public.collection_requests set status=$2,requires_admin=true,start_attempted_at=now(),cost_reserved_usd=0.5,provider_run_id=$3,provider_dataset_id=$4 where id=$1", [ids[i], status, `HELD-${i}`, `HELD-DS-${i}`]);
    }
    const provider = mock();
    await advance(ids[5], { provider, now: NOW });
    assert.equal(provider.startCount, 0);
    assert.equal((await state(ids[5])).status, "queued");
    assert.equal((await state(ids[5])).cost_reserved_usd, null);
  });

  await t.test("existing positive holds exclude themselves from available funds and only shrink", async () => {
    await reset({ "collector.monthly_budget_usd": 0.2, "collector.max_charge_per_run_usd": 0.15 });
    const [id] = await enqueue(1);
    await client.query("update public.collection_requests set cost_reserved_usd=0.2 where id=$1", [id]);
    const provider = mock();
    await advance(id, { provider, now: NOW });
    assert.equal(provider.startCount, 1);
    assert.equal((await state(id)).cost_reserved_usd, "0.150000");
  });

  await t.test("historical unknown costs hold across billing windows until an authorized release", async () => {
    await reset({ "collector.monthly_budget_usd": 0.5 });
    const ids = await enqueue(2);
    await client.query(`update public.collection_requests set status='failed',finished_at='2026-10-01',
      cost_status='unreported',cost_reserved_usd=0.5,error_class='provider_start_unknown',
      start_attempted_at='2026-10-01',started_at='2026-10-01' where id=$1`, [ids[0]]);
    const provider = mock();
    await advance(ids[1], { provider, now: NOW });
    assert.equal(provider.startCount, 0, "unknown historical spend remains held");
    assert.equal((await state(ids[1])).cost_reserved_usd, null);
    await client.query(`update public.collection_requests set reservation_released_at=now(),
      reservation_released_by=$2,reservation_release_reason='fixture review found no run' where id=$1`, [ids[0], users[0]]);
    await client.query("update public.collection_requests set next_check_at=null where id=$1", [ids[1]]);
    await advance(ids[1], { provider, now: NOW });
    assert.equal(provider.startCount, 1);
    assert.equal((await state(ids[1])).cost_reserved_usd, "0.500000");
  });

  await t.test("final costs consume their real start billing window only", async () => {
    for (const [startedAt, expectedStarts] of [["2026-11-02T00:00:00Z", 0], ["2026-10-02T00:00:00Z", 1]] as const) {
      await reset({ "collector.monthly_budget_usd": 0.5 });
      const ids = await enqueue(2);
      await client.query("update public.collection_requests set status='succeeded',finished_at=now(),cost_status='final',cost_final_usd=0.5,started_at=$2 where id=$1", [ids[0], startedAt]);
      const provider = mock();
      await advance(ids[1], { provider, now: NOW });
      assert.equal(provider.startCount, expectedStarts, startedAt);
      assert.equal((await state(ids[1])).cost_reserved_usd, expectedStarts ? "0.500000" : null);
    }
  });

  await t.test("disabled or incomplete settings after admission leave the queue unstarted", async () => {
    for (const [key, value] of [["collector.enabled", false], ["collector.monthly_budget_usd", null], ["collector.run_timeout_minutes", null]] as const) {
      await reset();
      const [id] = await enqueue(1);
      await client.query("update public.app_settings set value=$2::jsonb where key=$1", [key, JSON.stringify(value)]);
      const provider = mock();
      await advance(id, { provider, now: NOW });
      assert.equal(provider.startCount, 0, key);
      assert.deepEqual(await state(id), { status: "queued", cost_reserved_usd: null, start_attempted_at: null }, key);
    }
  });

  await t.test("simultaneous dispatch of one request makes one provider start", async () => {
    await reset();
    const [id] = await enqueue(1);
    const provider = mock();
    await Promise.all(Array.from({ length: 12 }, (_, i) => advance(id, { provider, now: NOW, worker: `duplicate-${i}` })));
    assert.equal(provider.startCount, 1);
    assert.equal((await state(id)).cost_reserved_usd, "0.500000");
  });

  await t.test("admin policy changes wait on the dispatch lock and disabling prevents the next start", async () => {
    await reset();
    const [id] = await enqueue(1);
    const blocker = await connect();
    let patch: ReturnType<typeof updateCollectorSettings> | null = null;
    try {
      await blocker.query("begin");
      await blocker.query("select pg_advisory_xact_lock(hashtext($1)::bigint)", [ADMISSION_LOCK_NAMESPACE]);
      const pid = (await blocker.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0].pid;
      let finished = false;
      patch = updateCollectorSettings({ userId: users[0], role: "admin" }, { enabled: false });
      void patch.then(() => { finished = true; });
      let waiting = false;
      // Observe the server's lock wait directly. Each round-trip yields to the
      // settings transaction; no time-based sleep decides whether it passed.
      for (let probe = 0; probe < 200 && !finished; probe += 1) {
        const blocked = await client.query("select 1 from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))", [pid]);
        if (blocked.rows.length) { waiting = true; break; }
      }
      assert.equal(waiting, true, "settings mutation waits for the same transaction lock as dispatch");
      assert.equal(finished, false);
      assert.equal((await client.query("select value from public.app_settings where key='collector.enabled'")).rows[0].value, true);
      await blocker.query("commit");
      assert.ok((await patch).ok);
    } finally {
      await blocker.query("rollback");
      if (patch) await patch;
      await blocker.end();
    }
    const provider = mock();
    await advance(id, { provider, now: NOW });
    assert.equal(provider.startCount, 0);
    assert.deepEqual(await state(id), { status: "queued", cost_reserved_usd: null, start_attempted_at: null });
  });

  await t.test("real scheduler SQL gives active work, waiting starts and due costs turns across minute ticks", async () => {
    await reset({ "collector.actor": "fixture/collector", "collector.tick_batch": 5 });
    const ids = await enqueue(4);
    await client.query(`update public.collection_requests set status='running',provider_run_id=$2,
      start_attempted_at=now(),started_at=now(),cost_reserved_usd=0.5,
      next_check_at=now()-interval '70 seconds' where id=$1`, [ids[0], `RUN-${ids[0]}`]);
    await client.query(`update public.collection_requests set status='failed',finished_at=now(),
      provider_run_id=$2,cost_reserved_usd=0.5,cost_status='unreported',
      cost_next_check_at=now()-interval '65 seconds' where id=$1`, [ids[1], `COST-${ids[1]}`]);
    // All rows are due at comparable real instants, rather than using the fixed
    // admission clock (which is hours before PostgreSQL's wall clock).
    await client.query("update public.collection_requests set created_at=now()-interval '60 seconds' where id=any($1::uuid[])", [ids.slice(2)]);
    const selected: { id: string; kind: string }[] = [];
    let deferred: (() => Promise<void>) | null = null;
    const starts = mock();
    const provider = {
      ...starts,
      readRun: async (runId: string) => ({ ok: true as const, value: mockRun({
        runId, status: "RUNNING", startedAt: null, datasetId: null, buildNumber: null,
      }) }),
    };
    const require = createRequire(import.meta.url);
    const ts = require("typescript") as typeof import("typescript");
    const source = ts.transpileModule(readFileSync("app/api/collections/advance/route.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports: Record<string, unknown> = {};
    runInNewContext(source, {
      exports, console: { info() {}, error() {} },
      require: (name: string) => {
        if (name === "next/server") return {
          after: (callback: () => Promise<void>) => { deferred = callback; },
          NextResponse: { json: (body: unknown, options: { status: number }) => ({ body, status: options.status }) },
        };
        if (name === "@/lib/collect/provider-factory") return { providerFromSettings: async () => provider };
        if (name === "@/lib/collect/advance-scheduler") return scheduledWork;
        if (name === "@/lib/collect/machine-auth") return { authenticateCollectionAdvance: () => "ok" };
        if (name === "@/lib/collect/provider") return { scrubProviderMessage: String };
        if (name === "@/lib/db/privileged") return {
          withTransaction: async (work: (db: pg.Client) => Promise<unknown>) => {
            await client.query("begin");
            try { const result = await work(client); await client.query("commit"); return result; }
            catch (error) { await client.query("rollback"); throw error; }
          },
        };
        if (name === "@/lib/collect/machine") return {
          advance: async (id: string) => {
            selected.push({ id, kind: "advance" });
            return advance(id, { provider, now: NOW });
          },
        };
        if (name === "@/lib/collect/cost") return {
          reconcileCost: async (id: string) => {
            selected.push({ id, kind: "cost" });
            await client.query("update public.collection_requests set cost_next_check_at=null where id=$1", [id]);
            return { action: "fixture_cost_observed" };
          },
        };
        throw new Error(`Unexpected scheduler import: ${name}`);
      },
    });
    const post = exports.POST as (request: { headers: { get: () => string } }) => Promise<{ status: number }>;
    for (let tick = 0; tick < 8; tick += 1) {
      deferred = null;
      assert.equal((await post({ headers: { get: () => "Bearer fixture" } })).status, 202);
      const callback = deferred as (() => Promise<void>) | null;
      if (callback) await callback();
      // Advance the due clocks by one cron interval, without sleeping or
      // changing the database/server clock.
      await client.query(`update public.collection_requests set
        created_at=created_at-interval '60 seconds',
        next_check_at=next_check_at-interval '60 seconds',
        cost_next_check_at=cost_next_check_at-interval '60 seconds'`);
    }
    assert.ok(selected.some((item) => item.id === ids[0] && item.kind === "advance"), "the running request is polled");
    assert.ok(selected.some((item) => item.id === ids[1] && item.kind === "cost"), "cost reconciliation cannot starve behind repeated active polling");
    for (const id of ids.slice(2)) assert.equal((await state(id)).status, "running", "waiting starts receive the available slots");
    assert.equal(starts.startCount, 2);

    // Both paths on one live row can be due. The older cost obligation gets
    // its turn before the newer poll, rather than losing forever to status.
    await client.query("delete from public.collection_requests where id<>$1", [ids[0]]);
    await client.query(`update public.collection_requests set cost_status='reserved',
      cost_next_check_at=now()-interval '90 seconds',next_check_at=now()-interval '10 seconds' where id=$1`, [ids[0]]);
    selected.length = 0;
    deferred = null;
    await post({ headers: { get: () => "Bearer fixture" } });
    const costCallback = deferred as (() => Promise<void>) | null;
    assert.ok(costCallback);
    await costCallback();
    assert.deepEqual(selected, [{ id: ids[0], kind: "cost" }]);
  });
});
