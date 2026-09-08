import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { drainArchiveQueue, enqueueRun } from "../../lib/media/archive.ts";
import { archiveHealth } from "../../lib/media/health.ts";
import type { ArchiveStore } from "../../lib/media/store.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * Scheduled-execution behaviour: what has to be true for an unattended drain to
 * make progress without a person watching it.
 *
 * The clock is not simulated. Each "scheduled run" here is a call to the same
 * `drainArchiveQueue` the cron job invokes over HTTP — the schedule decides when
 * that happens, and pg_cron is verified separately against the live catalog.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const RUN_AT = "2026-08-10T00:00:00.000Z";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);
const HOST = "https://scontent.fphs2-1.fna.fbcdn.net/v";

function memoryStore() {
  const objects = new Map<string, Buffer>();
  const store: ArchiveStore = {
    async putPreview(path, bytes) { objects.set(path, bytes); },
    async getPresentationUrl(path) { return objects.has(path) ? `memory://${path}` : null; },
    async getPresentationUrls(paths) {
      return new Map(paths.filter((p) => objects.has(p)).map((p) => [p, `memory://${p}`]));
    },
  };
  return { store, objects };
}

/** Media whose signed URL carries an `oe` expiry, in hours from now. */
const mediaExpiringIn = (name: string, hours: number) => ({
  images: [{
    resized_image_url:
      `${HOST}/${name}.jpg?oe=${Math.floor((Date.now() + hours * 3600_000) / 1000).toString(16)}`,
  }],
  videos: [], cards: [],
});

/** Imports one ad and queues its preview. Returns the collection run. */
async function seedAd(
  client: Awaited<ReturnType<typeof connect>>,
  categoryId: string,
  options: { id: string; hours: number },
) {
  const canonical = singleAdCanonical({
    collectedAt: RUN_AT, displayFormat: "IMAGE",
    adArchiveId: options.id, pageId: `p${options.id}`,
  });
  canonical.adObservations[0].media = mediaExpiringIn(options.id, options.hours) as never;
  const result = await commitImport({
    canonical, categoryId, datasetName: `sched-${options.id}`, actorId: null,
  });
  await enqueueRun(result.collectionRunId);
  void client;
  return result;
}

test("scheduled archival", { skip }, async (t) => {
  const client = await connect();
  const realFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = realFetch;
    await resetTables(client);
    await client.end();
    await closePool();
  });

  const serveJpeg = () => {
    globalThis.fetch = (async () => new Response(new Uint8Array(JPEG), {
      status: 200, headers: { "content-type": "image/jpeg" },
    })) as unknown as typeof fetch;
  };

  await t.test("pending work survives with no client anywhere near it", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await seedAd(client, categoryId, { id: "9001", hours: 50 });

    // Nothing has run a drain. The row is committed, not held in a promise.
    const { rows } = await client.query(
      "select archive_status, attempt_count from public.media_assets",
    );
    assert.equal(rows[0].archive_status, "pending");
    assert.equal(rows[0].attempt_count, 0);

    const health = await archiveHealth();
    assert.equal(health.pending, 1);
    assert.equal(health.lastAttemptAt, null, "nothing has attempted it yet");
  });

  await t.test("an unattended run drains it, and a second run is a no-op", async () => {
    serveJpeg();
    const { store } = memoryStore();

    const first = await drainArchiveQueue(store, { leaseSeconds: 0 });
    assert.equal(first.archived, 1);

    // Idempotent: an archived row is not claimed again on the next tick.
    const second = await drainArchiveQueue(store, { leaseSeconds: 0 });
    assert.equal(second.queued, 0);
    assert.equal(second.archived, 0);

    const health = await archiveHealth();
    assert.equal(health.pending, 0);
    assert.equal(health.archived, 1);
  });

  await t.test("nearest expiry is processed first, whatever the insert order", async () => {
    await resetTables(client);
    serveJpeg();
    const categoryId = await seedCategory(client);

    // Inserted long-lived first, so insertion order and expiry order disagree.
    await seedAd(client, categoryId, { id: "9100", hours: 100 });
    await seedAd(client, categoryId, { id: "9028", hours: 28 });
    await seedAd(client, categoryId, { id: "9060", hours: 60 });

    const { store } = memoryStore();
    await drainArchiveQueue(store, { limit: 1, leaseSeconds: 0 });

    const { rows } = await client.query(
      `select a.ad_archive_id, m.archive_status
         from public.media_assets m
         join public.ad_observations o on o.id = m.ad_observation_id
         join public.ads a on a.id = o.ad_ref
        where m.archive_status = 'archived'`,
    );
    assert.equal(rows.length, 1);
    // The 28-hour source is the one that will die first, so it goes first.
    assert.equal(rows[0].ad_archive_id, "9028");
  });

  await t.test("a queue larger than the batch converges over successive runs", async () => {
    const { store } = memoryStore();
    let runs = 0;
    for (;;) {
      const stats = await drainArchiveQueue(store, { limit: 1, leaseSeconds: 0 });
      runs += 1;
      if (stats.queued === 0 || runs > 10) break;
    }
    const health = await archiveHealth();
    assert.equal(health.pending, 0, "repeated bounded runs finish the queue");
    assert.equal(health.archived, 3);
  });

  await t.test("a terminal failure is never retried, however often the job runs", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    // Already expired at source: terminal, and refused before any request.
    await seedAd(client, categoryId, { id: "9200", hours: -1 });

    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response(null, { status: 403 });
    }) as unknown as typeof fetch;

    const { store } = memoryStore();
    const first = await drainArchiveQueue(store, { leaseSeconds: 0 });
    assert.equal(first.failed, 1);

    // Four more scheduled ticks. A terminal row must not be picked up again.
    for (let i = 0; i < 4; i += 1) {
      const stats = await drainArchiveQueue(store, { leaseSeconds: 0 });
      assert.equal(stats.queued, 0, `tick ${i + 2} must not re-claim a terminal row`);
    }
    assert.equal(requests, 0, "and it never costs a request");

    const { rows } = await client.query(
      "select attempt_count, failure_retryable, failure_reason from public.media_assets",
    );
    assert.equal(rows[0].attempt_count, 1);
    assert.equal(rows[0].failure_retryable, false);
    assert.equal(rows[0].failure_reason, "source_expired");

    const health = await archiveHealth();
    assert.equal(health.failedTerminal, 1);
    assert.equal(health.failedRetryable, 0);
  });

  await t.test("a retryable failure progresses on a later run", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await seedAd(client, categoryId, { id: "9300", hours: 50 });

    // A transient upstream problem: retryable by classification.
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const { store } = memoryStore();

    const failedRun = await drainArchiveQueue(store, { leaseSeconds: 0 });
    assert.equal(failedRun.failed, 1);
    assert.equal(failedRun.retryableRemaining, 1);
    let health = await archiveHealth();
    assert.equal(health.failedRetryable, 1);

    // The next scheduled run picks it up again — no import replay needed.
    serveJpeg();
    const recovered = await drainArchiveQueue(store, { leaseSeconds: 0 });
    assert.equal(recovered.queued, 1, "a retryable row is claimed again");
    assert.equal(recovered.archived, 1);

    health = await archiveHealth();
    assert.equal(health.archived, 1);
    assert.equal(health.failedRetryable, 0);
  });

  await t.test("retryable failures stop after the attempt ceiling", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await seedAd(client, categoryId, { id: "9400", hours: 50 });
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;

    const { store } = memoryStore();
    for (let i = 0; i < 5; i += 1) await drainArchiveQueue(store, { leaseSeconds: 0 });

    const { rows } = await client.query("select attempt_count from public.media_assets");
    // MAX_ATTEMPTS is 3: a permanently sick source cannot spin forever.
    assert.equal(rows[0].attempt_count, 3);
    const health = await archiveHealth();
    assert.equal(health.failedTerminal, 1, "exhausted retries read as terminal");
  });

  await t.test("overlapping runs divide the work instead of duplicating it", async () => {
    await resetTables(client);
    serveJpeg();
    const categoryId = await seedCategory(client);
    for (const id of ["9501", "9502", "9503", "9504"]) {
      await seedAd(client, categoryId, { id, hours: 40 });
    }

    // Two drains at once, which is what a slow run overlapping the next tick
    // looks like. SKIP LOCKED is what keeps them from fighting.
    const a = memoryStore();
    const b = memoryStore();
    const [first, second] = await Promise.all([
      drainArchiveQueue(a.store, { limit: 4 }),
      drainArchiveQueue(b.store, { limit: 4 }),
    ]);

    assert.equal(first.queued + second.queued, 4, "each row is claimed exactly once");
    assert.equal(first.archived + second.archived, 4);

    const { rows } = await client.query(
      "select count(*)::int n from public.media_assets where archive_status = 'archived'",
    );
    assert.equal(rows[0].n, 4);
    const paths = new Set([...a.objects.keys(), ...b.objects.keys()]);
    assert.equal(paths.size, 4, "no path was written by both runs");
  });

  await t.test("health reports what an operator needs to see", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    await seedAd(client, categoryId, { id: "9601", hours: 5 });   // urgent
    await seedAd(client, categoryId, { id: "9602", hours: 100 }); // not urgent

    const health = await archiveHealth();
    assert.equal(health.pending, 2);
    assert.equal(health.expiringWithin24h, 1, "only the urgent one counts");
    assert.ok(health.earliestExpiry, "the deadline is visible");
    assert.ok((health.oldestPendingAgeMinutes ?? -1) >= 0);
  });

  await t.test("an import still succeeds when archival cannot run at all", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    // The archival path is dead in every direction.
    globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;

    const canonical = singleAdCanonical({ collectedAt: RUN_AT, displayFormat: "IMAGE" });
    canonical.adObservations[0].media = mediaExpiringIn("9700", 50) as never;
    const result = await commitImport({
      canonical, categoryId, datasetName: "import-survives", actorId: null,
    });
    await enqueueRun(result.collectionRunId);

    const failing: ArchiveStore = {
      async putPreview() { throw new Error("storage down"); },
      async getPresentationUrl() { return null; },
      async getPresentationUrls() { return new Map(); },
    };
    await drainArchiveQueue(failing, { leaseSeconds: 0 });

    // The dataset is committed and readable regardless.
    const { rows } = await client.query(
      "select count(*)::int n from public.dataset_ads where dataset_id = $1", [result.datasetId],
    );
    assert.equal(rows[0].n, 1, "the dataset is intact");
    const health = await archiveHealth();
    assert.equal(health.archived, 0);
    assert.ok(health.failedRetryable + health.pending >= 1, "the work is still queued");
  });
});
