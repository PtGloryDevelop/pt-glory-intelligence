/**
 * The one place that reads collector media JSON and turns it into something a
 * component can render.
 *
 * Source keys are the collector's, not ours. An earlier version of this file
 * looked for `url` / `previewUrl` / `thumbnailUrl`, which the export has never
 * contained — so every ad in the product reported "no media saved" while all 500
 * observations carried media. The fix is not a longer fallback chain scattered
 * across AdCard, the drawer and any future table cell: it is this module being
 * the only thing that knows what an image or a video looks like on disk.
 *
 * The uploaded export is untrusted input that ends up in `src`, so every URL is
 * scheme-checked here. A `javascript:` or `data:` value would be a URL the page
 * executes rather than an asset it loads.
 *
 * This reads whatever observation it is handed. Snapshot pinning happens in SQL
 * (`dataset_ads_page` / `ad_detail` join on the dataset's own collection_run_id),
 * so a historical dataset can only ever pass in its own run's media.
 */

/** Raw shape as stored in `ad_observations.media`. Every field is optional. */
export type Media = { images?: unknown[]; videos?: unknown[]; cards?: unknown[] } | null;

/** Domain boundary shared by archive fetching and responsive image delivery. */
export function isAllowedMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "fbcdn.net" || host.endsWith(".fbcdn.net");
}

export function canOptimizeAdImage(src: string): boolean {
  try {
    const url = new URL(src);
    return url.protocol === "https:" && !url.port && !url.username && !url.password
      && !url.searchParams.has("access_token") && !/\.(mp4|webm|mov)$/i.test(url.pathname)
      && isAllowedMediaHost(url.hostname);
  } catch { return false; }
}

export type ImageMedia = { kind: "image"; src: string };
export type VideoMedia = { kind: "video"; src: string; poster: string | null };
export type PresentableMedia = ImageMedia | VideoMedia;

/**
 * Three states the UI must keep distinct.
 *
 * `none` and `unusable` are different facts about the data and must never be
 * collapsed: saying "nothing was captured" about an ad whose creative we did
 * capture is a claim the stored rows contradict.
 */
export type MediaPresentation =
  | { state: "none" }
  | { state: "unusable"; entries: number }
  | { state: "ready"; primary: PresentableMedia; all: PresentableMedia[] };

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** First safe http(s) string among the given keys, in the order given. */
function pickUrl(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    if (isHttpUrl(record[key])) return record[key] as string;
  }
  return null;
}

/*
 * Deterministic priority, documented so nobody has to guess later.
 *
 * Images: the resized asset first — the collector's own preview rendition, which
 * is what a card wants. `image_crops` is skipped: it holds crop geometry, not a
 * dependable URL.
 *
 * Videos: highest fidelity the export actually stored, with the collector's
 * preview frame as the poster. A card can render the poster alone; the drawer
 * can attach a real player to `src`.
 */
const IMAGE_KEYS = ["resized_image_url", "original_image_url"] as const;
const VIDEO_KEYS = ["video_hd_url", "video_sd_url"] as const;
const POSTER_KEYS = ["video_preview_image_url"] as const;
const CARD_IMAGE_KEYS = ["resized_image_url", "original_image_url"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readImage(entry: unknown): PresentableMedia | null {
  const record = asRecord(entry);
  if (!record) return null;
  const src = pickUrl(record, IMAGE_KEYS);
  return src ? { kind: "image", src } : null;
}

function readVideo(entry: unknown): PresentableMedia | null {
  const record = asRecord(entry);
  if (!record) return null;
  const src = pickUrl(record, VIDEO_KEYS);
  const poster = pickUrl(record, POSTER_KEYS);
  if (src) return { kind: "video", src, poster };
  // A video whose playback URL is gone but whose preview frame survived is still
  // a creative worth showing.
  return poster ? { kind: "image", src: poster } : null;
}

/** Carousel cards carry either their own still or the same video fields. */
function readCard(entry: unknown): PresentableMedia | null {
  const record = asRecord(entry);
  if (!record) return null;
  const image = pickUrl(record, CARD_IMAGE_KEYS);
  if (image) return { kind: "image", src: image };
  return readVideo(entry);
}

/**
 * How many entries the snapshot holds, whether or not any of them is usable.
 * The difference between "no media" and "media we cannot show" depends on this.
 */
function countEntries(media: Media): number {
  return (media?.images?.length ?? 0) + (media?.videos?.length ?? 0) + (media?.cards?.length ?? 0);
}

/**
 * Everything renderable in this observation, images first so a card preview
 * prefers a still over a video frame.
 */
export function presentableMedia(media: Media): PresentableMedia[] {
  return [
    ...(media?.images ?? []).map(readImage),
    ...(media?.videos ?? []).map(readVideo),
    ...(media?.cards ?? []).map(readCard),
  ].filter((item): item is PresentableMedia => item !== null);
}

/** What a component should render, and which of the three states it is in. */
export function mediaPresentation(media: Media): MediaPresentation {
  const entries = countEntries(media);
  if (entries === 0) return { state: "none" };

  const all = presentableMedia(media);
  if (all.length === 0) return { state: "unusable", entries };

  return { state: "ready", primary: all[0], all };
}
