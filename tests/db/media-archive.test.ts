import assert from "node:assert/strict";
import test from "node:test";
import { commitImport } from "../../lib/import/commit.ts";
import { closePool } from "../../lib/db/privileged.ts";
import { drainArchiveQueue, enqueueRun } from "../../lib/media/archive.ts";
import type { ArchiveStore } from "../../lib/media/store.ts";
import { connect, resetTables, seedCategory, singleAdCanonical } from "./helpers.ts";

/**
 * The archival pipeline against the real database.
 *
 * An in-memory ArchiveStore and a stubbed fetch: the subject here is the state
 * machine, the idempotency and the snapshot linkage, none of which should need a
 * CDN or a bucket to prove.
 */

const skip = process.env.DATABASE_URL ? false : "DATABASE_URL not set";
const OLD_RUN = "2026-08-10T00:00:00.000Z";
const NEW_RUN = "2026-08-28T00:00:00.000Z";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(128, 7)]);

/** Records what was written where, so path determinism can be asserted. */
function memoryStore() {
  const objects = new Map<string, Buffer>();
  let puts = 0;
  const store: ArchiveStore = {
    async putPreview(path, bytes) { puts += 1; objects.set(path, bytes); },
    async getPresentationUrl(path) { return objects.has(path) ? `memory://${path}` : null; },
    async getPresentationUrls(paths) {
      return new Map(paths.filter((p) => objects.has(p)).map((p) => [p, `memory://${p}`]));
    },
  };
  return { store, objects, puts: () => puts };
}

/** Media with a real fbcdn-shaped host, so the host policy is exercised. */
const withImage = (suffix: string, oe?: number) => ({
  images: [{
    resized_image_url:
      `https://scontent.fphs2-1.fna.fbcdn.net/v/${suffix}.jpg${oe ? `?oe=${oe.toString(16)}` : ""}`,
    original_image_url: `https://scontent.fphs2-1.fna.fbcdn.net/v/${suffix}-orig.jpg`,
  }],
  videos: [], cards: [],
});

test("preview archival", { skip }, async (t) => {
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

  await t.test("enqueue records one row per observation with truthful state", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);
    const canonical = singleAdCanonical({ collectedAt: OLD_RUN, displayFormat: "IMAGE" });
    canonical.adObservations[0].media = withImage("a") as never;
    const { collectionRunId } = await commitImport({
      canonical, categoryId, datasetName: "enqueue", actorId: null,
    });

    const { queued } = await enqueueRun(collectionRunId);
    assert.equal(queued, 1);

    const { rows } = await client.query(
      `select archive_status, source_field, source_host, asset_role, source_media_kind
         from public.media_assets`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].archive_status, "pending");
    assert.equal(rows[0].source_field, "resized_image_url");
    assert.equal(rows[0].source_host, "scontent.fphs2-1.fna.fbcdn.net");
    assert.equal(rows[0].asset_role, "preview");
    assert.equal(rows[0].source_media_kind, "image");
  });

  await t.test("none and unusable stay distinct, and neither is queued", async () => {
    await resetTables(client);
    const categoryId = await seedCategory(client);

    const empty = singleAdCanonical({ collectedAt: OLD_RUN, adArchiveId: "111", pageId: "p1" });
    empty.adObservations[0].media = { images: [], videos: [], cards: [] } as never;
    const first = await commitImport({
      canonical: empty, categoryId, datasetName: "none", actorId: null,
    });
    await enqueueRun(first.collectionRunId);

    const textOnly = singleAdCanonical({
      collectedAt: NEW_RUN, adArchiveId: "222", pageId: "p2", displayFormat: "CAROUSEL",
    });
    textOnly.adObservations[0].media = {
      images: [], videos: [],
      cards: [{ title: "text only", video_hd_url: null, video_sd_url: null }],
    } as never;
    const second = await commitImport({
      canonical: textOnly, categoryId, datasetName: "unusable", actorId: null,
    });
    await enqueueRun(second.collectionRunId);

    const { rows } = await client.query(
      "select archive_status, count(*)::int n from public.media_assets group by 1 order by 1",
    );
    const byStatus = Object.fromEntries(rows.map((r) => [r.archive_status, r.n]));
    // A text-only carousel is "media we cannot use", never "no media".
    assert.deepEqual(byStatus, { none: 1, unusable: 1 });
  });

  await t.test("a drain archives, stores the bytes and records the digest", async () => {
    await resetTables(client);
    serveJpeg();
    const categoryId = await seedCategory(client);
    const canonical = singleAdCanonical({ collectedAt: OLD_RUN, displayFormat: "IMAGE" });
    canonical.adObservations[0].media = withImage("b") as never;
    const { collectionRunId } = await commitImport({
      canonical, categoryId, datasetName: "drain", actorId: null,
    });
    await enqueueRun(collectionRunId);

    const { store, objects } = memoryStore();
    const stats = await drainArchiveQueue(store, { collectionRunId });

    assert.equal(stats.archived, 1);
    assert.equal(stats.failed, 0);
    assert.equal(stats.bytesStored, JPEG.length);

    const { rows } = await client.query(
      "select archive_status, storage_path, mime_type, byte_size, sha256 from public.media_assets",
    );
    assert.equal(rows[0].archive_status, "archived");
    assert.equal(rows[0].mime_type, "image/jpeg");
    assert.equal(Number(rows[0].byte_size), JPEG.length);
    assert.match(rows[0].sha256, /^[0-9a-f]{64}$/);
    // Observation-scoped and run-scoped. Never keyed by ad_archive_id.
    assert.match(rows[0].storage_path, new RegExp(`^previews/${collectionRunId}/\\d+/preview\\.jpg$`));
    assert.ok(objects.has(rows[0].storage_path));
  });

  await t.test("re-running the drain is a no-op rather than a duplicate", async () => {
    const { store, puts } = memoryStore();
    const before = await client.query("select count(*)::int n from public.media_assets");
    const stats = await drainArchiveQueue(store);
    const after = await client.query("select count(*)::int n from public.media_assets");

    assert.equal(stats.queued, 0, "an archived row is not claimed again");
    assert.equal(puts(), 0, "and nothing is uploaded a second time");
    assert.equal(after.rows[0].n, before.rows[0].n, "no duplicate rows");
  });

  await t.test("enqueueing the same run again does not reset an archived row", async () => {
    const { rows: runs } = await client.query("select id from public.collection_runs limit 1");
    await enqueueRun(runs[0].id);
    const { rows } = await client.query("select archive_status from public.media_assets");
    assert.equal(rows[0].archive_status, "archived");
  });

  await t.test("a dead source is terminal and never costs a request", async () => {
    await resetTables(client);
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      return new Response(null, { status: 403 });
    }) as unknown as typeof fetch;

    const categoryId = await seedCategory(client);
    const canonical = singleAdCanonical({ collectedAt: OLD_RUN, displayFormat: "IMAGE" });
    canonical.adObservations[0].media = withImage("c", Math.floor(Date.now() / 1000) - 3600) as never;
    const { collectionRunId } = await commitImport({
      canonical, categoryId, datasetName: "expired", actorId: null,
    });
    await enqueueRun(collectionRunId);

    const { store } = memoryStore();
    const stats = await drainArchiveQueue(store, { collectionRunId });

    assert.equal(stats.failed, 1);
    assert.equal(stats.expiredBeforeArchive, 1);
    assert.equal(requests, 0, "an expired source is refused before the network");

    const { rows } = await client.query(
      "select archive_status, failure_reason from public.media_assets",
    );
    assert.equal(rows[0].archive_status, "failed");
    assert.equal(rows[0].failure_reason, "source_expired");
  });

  await t.test("a newer run gets its own archive; the older one is untouched", async () => {
    await resetTables(client);
    serveJpeg();
    const categoryId = await seedCategory(client);

    const old = singleAdCanonical({ collectedAt: OLD_RUN, displayFormat: "IMAGE" });
    old.adObservations[0].media = withImage("old") as never;
    const oldRun = await commitImport({
      canonical: old, categoryId, datasetName: "old", actorId: null,
    });
    await enqueueRun(oldRun.collectionRunId);

    const { store } = memoryStore();
    await drainArchiveQueue(store, { collectionRunId: oldRun.collectionRunId });

    const fresh = singleAdCanonical({ collectedAt: NEW_RUN, displayFormat: "IMAGE" });
    fresh.adObservations[0].media = withImage("new") as never;
    const newRun = await commitImport({
      canonical: fresh, categoryId, datasetName: "new", actorId: null,
    });
    await enqueueRun(newRun.collectionRunId);
    await drainArchiveQueue(store, { collectionRunId: newRun.collectionRunId });

    const { rows } = await client.query(
      `select o.collection_run_id, m.storage_path
         from public.media_assets m
         join public.ad_observations o on o.id = m.ad_observation_id
        order by o.observed_at`,
    );
    assert.equal(rows.length, 2, "one archive per observation, not per ad");
    assert.notEqual(rows[0].storage_path, rows[1].storage_path);
    assert.ok(rows[0].storage_path.includes(oldRun.collectionRunId));
    assert.ok(rows[1].storage_path.includes(newRun.collectionRunId));
  });

  await t.test("each dataset read projects its own run's archive", async () => {
    const { rows: datasets } = await client.query(
      "select id, name from public.datasets order by created_at",
    );
    const oldDataset = datasets.find((d) => d.name === "old");
    const newDataset = datasets.find((d) => d.name === "new");

    const oldRead = await client.query(
      "select archive_path, archive_status from public.dataset_ads_page($1)", [oldDataset.id],
    );
    const newRead = await client.query(
      "select archive_path, archive_status from public.dataset_ads_page($1)", [newDataset.id],
    );

    assert.equal(oldRead.rows[0].archive_status, "archived");
    assert.equal(newRead.rows[0].archive_status, "archived");
    // I1 through the media layer: the older dataset keeps its own creative.
    assert.notEqual(oldRead.rows[0].archive_path, newRead.rows[0].archive_path);
  });

  await t.test("a storage failure leaves the row retryable, not archived", async () => {
    await resetTables(client);
    serveJpeg();
    const categoryId = await seedCategory(client);
    const canonical = singleAdCanonical({ collectedAt: OLD_RUN, displayFormat: "IMAGE" });
    canonical.adObservations[0].media = withImage("d") as never;
    const { collectionRunId } = await commitImport({
      canonical, categoryId, datasetName: "storage-fail", actorId: null,
    });
    await enqueueRun(collectionRunId);

    const failing: ArchiveStore = {
      async putPreview() { throw new Error("bucket unavailable"); },
      async getPresentationUrl() { return null; },
      async getPresentationUrls() { return new Map(); },
    };
    const stats = await drainArchiveQueue(failing, { collectionRunId });
    assert.equal(stats.failed, 1);
    assert.equal(stats.retryableRemaining, 1);

    const { rows } = await client.query(
      "select archive_status, failure_reason, attempt_count from public.media_assets",
    );
    assert.equal(rows[0].archive_status, "failed");
    assert.equal(rows[0].failure_reason, "storage_upload_failed");
    assert.equal(rows[0].attempt_count, 1);

    // ...and a later run with working storage recovers it.
    const { store } = memoryStore();
    const retry = await drainArchiveQueue(store, { collectionRunId });
    assert.equal(retry.archived, 1);
  });
});
