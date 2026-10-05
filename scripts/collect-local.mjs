// Local stand-in for the cron tick (no COLLECTION_ADVANCE_TOKEN locally): advances due collection requests
// until none is left, then archives ad media and page pictures.
//   node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/collect-local.mjs
import { closePool, withTransaction } from "../lib/db/privileged.ts";
import { providerFromSettings } from "../lib/collect/provider-factory.ts";
import { advance } from "../lib/collect/machine.ts";
import { reconcileCost } from "../lib/collect/cost.ts";
import { drainArchiveQueue } from "../lib/media/archive.ts";
import { archivePagePictures } from "../lib/media/page-pictures.ts";
import { ensurePreviewBucket, supabaseArchiveStore } from "../lib/media/store-supabase.ts";

const provider = await providerFromSettings();
const deadline = Date.now() + 25 * 60_000;
while (Date.now() < deadline) {
  const { rows } = await withTransaction((c) => c.query(`select id, status, cost_status,
      (status in ('queued','starting','provider_start_uncertain','running','settling','importing') and requires_admin=false
        or (status='succeeded' and media_enqueued_at is null)) as live,
      (next_check_at is null or next_check_at <= now()) and (lease_expires_at is null or lease_expires_at < now()) as due,
      provider_run_id is not null and cost_status in ('reserved','provisional','unreported') and cost_next_check_at <= now() as cost_due
    from public.collection_requests order by created_at`));
  const live = rows.filter((r) => r.live);
  for (const r of rows) {
    if (r.live && r.due) { try { const o = await advance(r.id, { provider }); console.log(new Date().toISOString().slice(11, 19), r.id.slice(0, 8), r.status, "->", o?.action ?? o); } catch (e) { console.log("advance error", e.message); } }
    else if (r.cost_due) { try { const o = await reconcileCost(r.id, { provider }); console.log("cost", r.id.slice(0, 8), o?.action ?? o); } catch (e) { console.log("cost error", e.message); } }
  }
  if (!live.length) break;
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
await ensurePreviewBucket();
const store = supabaseArchiveStore();
console.log("media", JSON.stringify(await drainArchiveQueue(store, { limit: 1000 })));
console.log("pictures", JSON.stringify(await archivePagePictures(store, 500)));
const done = await withTransaction((c) => c.query("select dataset_name, status, provider_item_count, result, cost_status, coalesce(cost_final_usd, cost_provisional_usd)::text usd from public.collection_requests order by created_at"));
console.log(JSON.stringify(done.rows));
await closePool();
