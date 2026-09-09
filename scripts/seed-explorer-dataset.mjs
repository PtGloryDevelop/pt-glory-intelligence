/**
 * Seeds the dataset the Explorer and Drawer capture specs run against.
 *
 * Those specs need real archived previews, and the Playwright global setup
 * truncates the tables — so any regression run wipes the dataset out from under
 * them. This makes re-seeding one command instead of a script rewritten from
 * memory each time.
 *
 *   node --env-file-if-exists=.env.local --conditions=react-server \
 *     --experimental-strip-types scripts/seed-explorer-dataset.mjs <fresh-export.json> [ads]
 *
 * Needs an export whose signed URLs are still inside their ~105-hour window;
 * with an expired one the previews cannot be archived and the specs will be
 * looking at placeholders again.
 */
import { readFileSync } from "node:fs";
import { validate } from "../lib/collector/validate.ts";
import { normalize } from "../lib/collector/normalize.ts";
import { commitImport } from "../lib/import/commit.ts";
import { closePool, withTransaction } from "../lib/db/privileged.ts";
import { drainArchiveQueue, enqueueRun } from "../lib/media/archive.ts";
import { ensurePreviewBucket, supabaseArchiveStore } from "../lib/media/store-supabase.ts";
import { assertDestructiveAllowed } from "./destructive-guard.mjs";

/*
 * Additive rather than destructive — but this writes a synthetic capture
 * dataset, and synthetic data in a real research environment is indistinguishable
 * from a real import once it is in the list. Same guard, same refusal.
 */
assertDestructiveAllowed(process.env.DATABASE_URL, "seeding the synthetic explorer dataset");

const [, , file, sizeArg] = process.argv;
if (!file) {
  console.error("usage: seed-explorer-dataset.mjs <fresh-export.json> [ads]");
  process.exit(1);
}
const want = Number(sizeArg ?? 60);

const source = JSON.parse(readFileSync(file, "utf8"));

/*
 * A mix that mirrors the real format distribution rather than the first N ads,
 * so the grid and the drawer are exercised on video, image, multi-image and the
 * text-only carousels that produce the "unusable" media state.
 */
const pick = (format, n) => source.ads.filter((ad) => ad.display_format === format).slice(0, n);
const ads = [
  ...pick("VIDEO", Math.round(want * 0.37)),
  ...pick("IMAGE", Math.round(want * 0.35)),
  ...pick("MULTI_IMAGES", Math.round(want * 0.25)),
  ...pick("CAROUSEL", Math.max(2, Math.round(want * 0.02))),
  ...pick("DCO", 1),
];
if (ads.length === 0) {
  console.error("no ads matched — is this a collector export?");
  process.exit(1);
}

const pages = new Set(ads.map((ad) => ad.page_id).filter(Boolean));
const parsed = validate({
  ...source,
  source_rows: ads.length, unique_ads: ads.length,
  unique_pages: pages.size, unresolved_count: 0,
  ads, unresolved_ads: [],
});
if (!parsed.ok) {
  console.error("export rejected:", parsed.reason, parsed.detail);
  process.exit(1);
}

const categoryId = await withTransaction(async (client) => {
  const { rows } = await client.query(
    `insert into public.categories (name) values ($1)
     on conflict (name) do update set name = excluded.name returning id`,
    ["C2 Explorer"],
  );
  return rows[0].id;
});

const result = await commitImport({
  canonical: normalize(parsed.file), categoryId, datasetName: "c2-explorer", actorId: null,
});
const { queued } = await enqueueRun(result.collectionRunId);

await ensurePreviewBucket();
const stats = await drainArchiveQueue(supabaseArchiveStore(), {
  limit: 500, collectionRunId: result.collectionRunId,
});

console.log(`ads ${ads.length} · queued ${queued} · archived ${stats.archived} · failed ${stats.failed}`);
if (stats.failed > 0) {
  console.log("  some previews did not archive — check the export's remaining TTL");
}

const byFormat = await withTransaction((client) => client.query(
  `select o.display_format, m.archive_status, count(*)::int n
     from public.media_assets m
     join public.ad_observations o on o.id = m.ad_observation_id
    where o.collection_run_id = $1
    group by 1, 2 order by 1, 2`,
  [result.collectionRunId],
));
console.table(byFormat.rows);
console.log(`dataset ${result.datasetId}`);
await closePool();
