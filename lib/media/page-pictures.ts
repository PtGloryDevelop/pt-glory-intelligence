import type { PoolClient } from "pg";
import { withTransaction } from "../db/privileged.ts";
import { isAllowedMediaHost } from "../media.ts";
import { fetchPreview, isTerminal } from "./fetch.ts";
import type { ArchiveStore } from "./store.ts";

/**
 * Competitor page profile pictures.
 *
 * Kept outside the ad export contract on purpose: a page's picture is not an
 * observation of an ad, and the contract's allowlist stays exactly as it was.
 * The collector records the source URL; the archive drain copies the bytes.
 */

const MAX_ATTEMPTS = 3;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Pure: provider items → one picture URL per page (fbcdn only; the last item for a page wins). */
export function pagePicturesFromItems(items: readonly unknown[]): { pageId: string; url: string }[] {
  const found = new Map<string, string>();
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const snapshot = row.snapshot && typeof row.snapshot === "object" ? row.snapshot as Record<string, unknown> : {};
    const pageId = typeof row.page_id === "number" ? String(row.page_id) : row.page_id;
    const url = snapshot.page_profile_picture_url;
    if (typeof pageId !== "string" || !/^\d{1,32}$/.test(pageId) || typeof url !== "string") continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && isAllowedMediaHost(parsed.hostname)) found.set(pageId, url);
    } catch { /* not a URL */ }
  }
  return [...found].map(([pageId, url]) => ({ pageId, url }));
}

/**
 * Records source URLs for pages we already know. A picture archived in the last
 * 30 days is left alone; anything else goes (back) to pending with fresh attempts.
 */
export async function recordPagePictures(client: PoolClient, list: { pageId: string; url: string }[]): Promise<number> {
  if (list.length === 0) return 0;
  const result = await client.query(
    `insert into public.page_pictures (page_id, source_url)
     select x.page_id, x.url from unnest($1::text[], $2::text[]) as x(page_id, url)
       join public.pages p on p.page_id = x.page_id
     on conflict (page_id) do update set source_url = excluded.source_url, status = 'pending',
       attempts = 0, failure_reason = null, updated_at = now()
     where page_pictures.status <> 'archived' or page_pictures.updated_at < now() - interval '30 days'`,
    [list.map((item) => item.pageId), list.map((item) => item.url)],
  );
  return result.rowCount ?? 0;
}

/** Copies pending pictures into storage. One page failing never stops the rest. */
export async function archivePagePictures(store: ArchiveStore, limit = 50): Promise<{ archived: number; failed: number; retry: number }> {
  const pending = await withTransaction((client) => client.query<{ page_id: string; source_url: string; attempts: number }>(
    `select page_id, source_url, attempts from public.page_pictures where status = 'pending' order by updated_at limit $1`, [limit],
  ));
  const stats = { archived: 0, failed: 0, retry: 0 };
  for (const row of pending.rows) {
    const fetched = await fetchPreview(row.source_url);
    let reason: string;
    if (fetched.ok && EXT[fetched.mimeType]) {
      const path = `pages/${row.page_id}.${EXT[fetched.mimeType]}`;
      try {
        await store.putPreview(path, fetched.bytes, fetched.mimeType);
        await withTransaction((client) => client.query(
          `update public.page_pictures set status = 'archived', storage_path = $2, failure_reason = null, updated_at = now() where page_id = $1`,
          [row.page_id, path],
        ));
        stats.archived++;
        continue;
      } catch { reason = "storage_error"; }
    } else reason = fetched.ok ? "unsupported_type" : fetched.reason;
    const give_up = row.attempts + 1 >= MAX_ATTEMPTS || (!fetched.ok && isTerminal(fetched.reason));
    await withTransaction((client) => client.query(
      `update public.page_pictures set attempts = attempts + 1, status = $2, failure_reason = $3, updated_at = now() where page_id = $1`,
      [row.page_id, give_up ? "failed" : "pending", reason],
    ));
    if (give_up) stats.failed++; else stats.retry++;
  }
  return stats;
}

/**
 * Public picture endpoint for a Page (no token needed for public Pages). Returns
 * null for the default silhouette, so those pages keep their letter avatar.
 */
export async function graphPictureUrl(pageId: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!/^\d{1,32}$/.test(pageId)) return null;
  try {
    const response = await fetchImpl(`https://graph.facebook.com/v19.0/${pageId}/picture?type=large&redirect=false`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const body = await response.json() as { data?: { url?: unknown; is_silhouette?: unknown } };
    const url = body.data?.url;
    if (body.data?.is_silhouette !== false || typeof url !== "string") return null;
    return pagePicturesFromItems([{ page_id: pageId, snapshot: { page_profile_picture_url: url } }])[0]?.url ?? null;
  } catch { return null; }
}
