"use client";

type Ad = { account_id: string; ad_id: string };
export type OwnedMediaItem = Ad & { url: string | null };

const PER_REQUEST = 4;
const IN_FLIGHT = 3;

/**
 * Sharp pictures from /api/owned-ads/media: four ads per request, as the route resolves them, with three
 * requests in flight instead of one after another. The wait is Meta's rather than the database's, so
 * overlapping the requests shortens it without asking for more; the same ads are requested either way.
 * Batches leave in screen order, so the top cards fill first. `found` is null when that request failed.
 */
export async function loadOwnedMedia(ads: Ad[], signal: AbortSignal, onBatch: (items: Ad[], found: OwnedMediaItem[] | null) => void) {
  const batches: Ad[][] = [];
  for (let offset = 0; offset < ads.length; offset += PER_REQUEST) batches.push(ads.slice(offset, offset + PER_REQUEST));
  const next = async (): Promise<void> => {
    const items = batches.shift();
    if (!items || signal.aborted) return;
    try {
      const response = await fetch("/api/owned-ads/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }), signal });
      if (!response.ok) throw new Error();
      const body = await response.json() as { items: OwnedMediaItem[] };
      if (!signal.aborted) onBatch(items, body.items);
    } catch {
      if (!signal.aborted) onBatch(items, null);
    }
    return next();
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, next));
}
