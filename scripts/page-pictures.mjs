/**
 * Backfills competitor page pictures: collections still held by the provider first, then the public
 * Page picture endpoint for pages still without one. Then archives them.
 * Reads provider datasets (no actor run, no collection cost). Datasets the provider has expired are skipped.
 *   node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/page-pictures.mjs
 */
import { closePool, withTransaction } from "../lib/db/privileged.ts";
import { providerFromSettings } from "../lib/collect/provider-factory.ts";
import { archivePagePictures, graphPictureUrl, pagePicturesFromItems, recordPagePictures } from "../lib/media/page-pictures.ts";
import { ensurePreviewBucket, supabaseArchiveStore } from "../lib/media/store-supabase.ts";

const provider = await providerFromSettings();
if (!provider) throw new Error("collector is not configured");
const { rows } = await withTransaction((client) => client.query(
  "select distinct provider_dataset_id as id from public.collection_requests where provider_dataset_id is not null",
));
for (const { id } of rows) {
  const items = [];
  for (;;) {
    const page = await provider.readDatasetItems(id, { offset: items.length, limit: 1000 });
    if (!page.ok) { console.log(id, "unreadable:", page.detail); break; }
    if (page.value.items.length === 0) break;
    items.push(...page.value.items);
  }
  const found = pagePicturesFromItems(items);
  const recorded = await withTransaction((client) => recordPagePictures(client, found));
  console.log(id, `${items.length} items · ${found.length} pages with a picture · ${recorded} recorded`);
}

const missing = await withTransaction((client) => client.query(
  "select page_id from public.pages where page_id not in (select page_id from public.page_pictures) order by last_seen_at desc",
));
let fromGraph = 0, silhouette = 0;
for (const { page_id } of missing.rows) {
  const url = await graphPictureUrl(page_id);
  if (url) fromGraph += await withTransaction((client) => recordPagePictures(client, [{ pageId: page_id, url }]));
  else silhouette++;
}
console.log(`public endpoint: ${fromGraph} recorded · ${silhouette} without a picture`);

await ensurePreviewBucket();
const store = supabaseArchiveStore();
for (let round = 0; round < 40; round++) {
  const stats = await archivePagePictures(store, 50);
  console.log("archive", JSON.stringify(stats));
  if (stats.archived + stats.failed + stats.retry === 0) break;
}
await closePool();
