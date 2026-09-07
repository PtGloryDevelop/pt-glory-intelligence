/**
 * Real end-to-end proof of the durable preview pipeline.
 *
 * Imports a fresh collector export, enqueues, drains against the real Supabase
 * bucket, and reports what it stored. Everything here touches production code
 * paths — no stubs, no fakes.
 *
 *   node --env-file-if-exists=.env.local --conditions=react-server \
 *        --experimental-strip-types scripts/archive-e2e.mjs <export.json> [limit]
 */
import { readFileSync } from "node:fs";
import { validate } from "../lib/collector/validate.ts";
import { normalize } from "../lib/collector/normalize.ts";
import { commitImport } from "../lib/import/commit.ts";
import { closePool, withTransaction } from "../lib/db/privileged.ts";
import { drainArchiveQueue, enqueueRun } from "../lib/media/archive.ts";
import { ensurePreviewBucket, supabaseArchiveStore } from "../lib/media/store-supabase.ts";

const [, , file, limitArg] = process.argv;
if (!file) { console.error("usage: archive-e2e.mjs <export.json> [limit]"); process.exit(1); }
const limit = Number(limitArg ?? 60);

const parsed = validate(JSON.parse(readFileSync(file, "utf8")));
if (!parsed.ok) { console.error("export rejected:", parsed.reason, parsed.detail); process.exit(1); }
const canonical = normalize(parsed.file);
console.log(`export ${canonical.run.collectedAt} · ${canonical.ads.length} ads`);

const category = await withTransaction(async (client) => {
  const { rows } = await client.query(
    `insert into public.categories (name) values ($1)
     on conflict (name) do update set name = excluded.name returning id`,
    ["durable-preview-e2e"],
  );
  return rows[0].id;
});

const started = Date.now();
const result = await commitImport({
  canonical, categoryId: category, datasetName: `c1.7-proof-${Date.now()}`, actorId: null,
});
console.log(`imported  dataset ${result.datasetId} · run ${result.collectionRunId} · ${Date.now() - started}ms`);

const { queued } = await enqueueRun(result.collectionRunId);
console.log(`enqueued  ${queued} candidates`);

await ensurePreviewBucket();
const stats = await drainArchiveQueue(supabaseArchiveStore(), {
  limit, collectionRunId: result.collectionRunId,
});
console.log("drain    ", JSON.stringify(stats));

const summary = await withTransaction(async (client) => {
  const byStatus = await client.query(
    `select m.archive_status, count(*)::int n
       from public.media_assets m
       join public.ad_observations o on o.id = m.ad_observation_id
      where o.collection_run_id = $1 group by 1 order by 1`,
    [result.collectionRunId],
  );
  const sizes = await client.query(
    `select m.byte_size::int b
       from public.media_assets m
       join public.ad_observations o on o.id = m.ad_observation_id
      where o.collection_run_id = $1 and m.archive_status = 'archived'
      order by m.byte_size`,
    [result.collectionRunId],
  );
  const reasons = await client.query(
    `select m.failure_reason, count(*)::int n
       from public.media_assets m
       join public.ad_observations o on o.id = m.ad_observation_id
      where o.collection_run_id = $1 and m.archive_status = 'failed' group by 1`,
    [result.collectionRunId],
  );
  return { byStatus: byStatus.rows, sizes: sizes.rows.map((r) => r.b), reasons: reasons.rows };
});

console.log("status   ", JSON.stringify(summary.byStatus));
if (summary.reasons.length) console.log("failures ", JSON.stringify(summary.reasons));
if (summary.sizes.length) {
  const at = (p) => summary.sizes[Math.min(summary.sizes.length - 1, Math.floor(summary.sizes.length * p))];
  const total = summary.sizes.reduce((a, b) => a + b, 0);
  console.log(
    `objects   n=${summary.sizes.length}` +
    ` median=${(at(0.5) / 1024).toFixed(0)}KB p90=${(at(0.9) / 1024).toFixed(0)}KB` +
    ` max=${(summary.sizes[summary.sizes.length - 1] / 1024).toFixed(0)}KB` +
    ` total=${(total / 1048576).toFixed(2)}MB`,
  );
}
console.log(`DATASET_ID=${result.datasetId}`);
await closePool();
