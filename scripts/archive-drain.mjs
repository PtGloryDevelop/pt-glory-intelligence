/** Drains the remaining preview queue and reports stored-byte statistics. */
import { closePool, withTransaction } from "../lib/db/privileged.ts";
import { drainArchiveQueue } from "../lib/media/archive.ts";
import { ensurePreviewBucket, supabaseArchiveStore } from "../lib/media/store-supabase.ts";

const runId = process.argv[2];
const limit = Number(process.argv[3] ?? 500);
await ensurePreviewBucket();
const stats = await drainArchiveQueue(supabaseArchiveStore(), {
  limit, collectionRunId: runId || undefined,
});
console.log(JSON.stringify(stats));

const summary = await withTransaction(async (client) => {
  const status = await client.query(
    `select m.archive_status, count(*)::int n from public.media_assets m
       join public.ad_observations o on o.id = m.ad_observation_id
      where ($1::uuid is null or o.collection_run_id = $1) group by 1 order by 1`,
    [runId || null],
  );
  const sizes = await client.query(
    `select m.byte_size::int b from public.media_assets m
       join public.ad_observations o on o.id = m.ad_observation_id
      where ($1::uuid is null or o.collection_run_id = $1)
        and m.archive_status = 'archived' order by m.byte_size`,
    [runId || null],
  );
  const reasons = await client.query(
    `select m.failure_reason, count(*)::int n from public.media_assets m
       join public.ad_observations o on o.id = m.ad_observation_id
      where ($1::uuid is null or o.collection_run_id = $1)
        and m.archive_status = 'failed' group by 1`,
    [runId || null],
  );
  return { status: status.rows, sizes: sizes.rows.map((r) => r.b), reasons: reasons.rows };
});

console.log("status  ", JSON.stringify(summary.status));
if (summary.reasons.length) console.log("failures", JSON.stringify(summary.reasons));
const s = summary.sizes;
if (s.length) {
  const at = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  const total = s.reduce((a, b) => a + b, 0);
  console.log(
    `objects  n=${s.length} median=${(at(0.5) / 1024).toFixed(0)}KB` +
    ` p90=${(at(0.9) / 1024).toFixed(0)}KB max=${(s[s.length - 1] / 1024).toFixed(0)}KB` +
    ` total=${(total / 1048576).toFixed(2)}MB mean=${(total / s.length / 1024).toFixed(0)}KB`,
  );
}
await closePool();
