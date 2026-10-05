import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { withTransaction } from "../db/privileged.ts";
import { fetchPreview } from "../media/fetch.ts";
import type { ArchiveStore } from "../media/store.ts";

/**
 * Our ad creatives in our own storage.
 *
 * Meta's thumbnail links expire within days and the sharp image needs the Facebook token that only
 * this machine holds, so a hosted copy of the site would show no pictures. After each import the
 * pictures are copied into the private bucket and the row's creative_url becomes our own path,
 * which the thumb route turns into a short-lived signed link.
 */

export const thumbPath = (account: string, ad: string) => `owned/${account}/${ad}`;
export const thumbUrl = (account: string, ad: string) => `/api/owned-ads/thumb/${account}/${ad}`;

type Row = { account_id: string; ad_id: string; url: string | null };

/** Sharp images for the biggest spenders, via the same local bridge the media API uses. */
async function sharpUrls(rows: Row[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let offset = 0; offset < rows.length; offset += 24) {
    const batch = rows.slice(offset, offset + 24).map(({ account_id, ad_id }) => ({ account_id, ad_id }));
    try {
      const { stdout } = await promisify(execFile)(process.execPath, ["--experimental-strip-types", resolve("scripts/resolve-owned-media.mjs"), JSON.stringify(batch)],
        { env: process.env, windowsHide: true, timeout: 110_000, maxBuffer: 1024 * 1024 });
      for (const media of JSON.parse(stdout) as { account_id: string; ad_id: string; url: string | null }[])
        if (media.url) found.set(`${media.account_id}:${media.ad_id}`, media.url);
    } catch { /* keep the thumbnail for this batch */ }
  }
  return found;
}

export async function archiveOwnedThumbs(store: ArchiveStore, { sharp = 200, concurrency = 8 } = {}) {
  // Everything not yet archived, including ads whose source row has no thumbnail at all.
  const { rows } = await withTransaction((client) => client.query<Row & { url: string | null }>(
    `select a.account_id, a.ad_id, a.data->>'creative_url' url
       from public.owned_library_ads a
      where a.sync_id = (select id from public.owned_library_syncs where status = 'completed' order by finished_at desc limit 1)
        and coalesce(a.data->>'creative_url', '') not like '/api/%'
      order by a.spend desc nulls last`,
  ));
  const stats = { archived: 0, failed: 0, sharp: 0, total: rows.length };

  async function store1(row: Row, source: string | null): Promise<boolean> {
    if (!source) return false;
    const fetched = await fetchPreview(source);
    if (!fetched.ok) return false;
    try {
      await store.putPreview(thumbPath(row.account_id, row.ad_id), fetched.bytes, fetched.mimeType);
      await withTransaction((client) => client.query(
        `update public.owned_library_ads set data = jsonb_set(data, '{creative_url}', to_jsonb($3::text))
          where account_id = $1 and ad_id = $2 and coalesce(data->>'creative_url', '') not like '/api/%'`,
        [row.account_id, row.ad_id, thumbUrl(row.account_id, row.ad_id)],
      ));
      return true;
    } catch { return false; }
  }
  async function pool<T>(items: T[], run: (item: T) => Promise<void>) {
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => { while (next < items.length) await run(items[next++]); }));
  }

  // Pass 1: sharp images for the biggest spenders, the stored thumbnail for everyone else.
  const better = await sharpUrls(rows.slice(0, sharp));
  stats.sharp += better.size;
  const retry: Row[] = [];
  await pool(rows, async (row) => {
    const sharpUrl = better.get(`${row.account_id}:${row.ad_id}`);
    if (await store1(row, sharpUrl ?? row.url) || (sharpUrl && await store1(row, row.url))) stats.archived++;
    else retry.push(row);
  });
  // Pass 2: no thumbnail in the source, or its link expired: ask Meta for the picture by ad id.
  const fresh = await sharpUrls(retry);
  stats.sharp += fresh.size;
  await pool(retry, async (row) => {
    if (await store1(row, fresh.get(`${row.account_id}:${row.ad_id}`) ?? null)) stats.archived++;
    else stats.failed++;
  });
  return stats;
}
