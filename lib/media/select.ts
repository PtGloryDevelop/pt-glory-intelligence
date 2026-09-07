import { isHttpUrl, type Media } from "../media.ts";

/**
 * The one place that decides which source URL becomes an observation's durable
 * preview.
 *
 * Deliberately not "whatever file happened to resolve". C1 fixed the key-name
 * defect but left a semantic one behind: an ad's identity came from the asset
 * that turned up rather than from what the ad actually is. Here the format leads
 * and the asset follows — a VIDEO ad archives its poster and stays a VIDEO ad.
 *
 * Nothing recurses through the JSON looking for anything URL-shaped. Only the
 * named collector fields below are ever candidates, which is also the first line
 * of the SSRF defence: `link_url` and `link_description` are advertiser-supplied
 * destinations and can never reach the fetcher through this path.
 */

export type PreviewKind = "image" | "video" | "carousel";

export type PreviewCandidate = {
  outcome: "candidate";
  /** What the AD is. Independent of the file's own type. */
  kind: PreviewKind;
  sourceField: string;
  url: string;
  host: string;
  /** From the signed URL's `oe` parameter, when present. */
  expiresAt: Date | null;
};

export type PreviewSelection =
  | { outcome: "none" }
  | { outcome: "unusable"; entries: number }
  | PreviewCandidate;

/** Only these fields are ever read. The list is the contract. */
const IMAGE_FIELD = "resized_image_url";
const POSTER_FIELD = "video_preview_image_url";
const CARD_IMAGE_FIELDS = ["resized_image_url", "original_image_url"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function entryCount(media: Media): number {
  return (media?.images?.length ?? 0) + (media?.videos?.length ?? 0) + (media?.cards?.length ?? 0);
}

/**
 * Signed fbcdn URLs carry their own death date in `oe`, as hex unix seconds.
 * Parsed here so the queue can drain by urgency rather than by insertion order.
 * Absent or unparseable is not an error — it just sorts last.
 */
export function parseSourceExpiry(url: string): Date | null {
  try {
    const raw = new URL(url).searchParams.get("oe");
    if (!raw || !/^[0-9a-fA-F]{1,16}$/.test(raw)) return null;
    const seconds = parseInt(raw, 16);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const date = new Date(seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

function candidate(kind: PreviewKind, sourceField: string, url: string): PreviewCandidate | null {
  if (!isHttpUrl(url)) return null;
  let host: string;
  try { host = new URL(url).host; } catch { return null; }
  return { outcome: "candidate", kind, sourceField, url, host, expiresAt: parseSourceExpiry(url) };
}

/** First entry in source order whose named field holds a usable URL. */
function firstFrom(
  entries: unknown[] | undefined,
  fields: readonly string[],
  kind: PreviewKind,
): PreviewCandidate | null {
  for (const entry of entries ?? []) {
    const record = asRecord(entry);
    if (!record) continue;
    for (const field of fields) {
      const value = record[field];
      if (typeof value !== "string") continue;
      const picked = candidate(kind, field, value);
      if (picked) return picked;
    }
  }
  return null;
}

/**
 * Which still to archive for this observation, per the frozen Phase 1 policy.
 *
 *   VIDEO                 → video_preview_image_url
 *   IMAGE / MULTI_IMAGES  → resized_image_url
 *   CAROUSEL / DCO        → first usable still or poster, in source order
 *
 * A format whose policy source is missing falls back to the other kinds rather
 * than giving up — a VIDEO ad that somehow carries only images still deserves a
 * preview — but the reported `kind` stays the ad's own format either way.
 */
export function selectPreview(displayFormat: string | null, media: Media): PreviewSelection {
  const entries = entryCount(media);
  if (entries === 0) return { outcome: "none" };

  const format = (displayFormat ?? "").toUpperCase();
  const kind: PreviewKind =
    format === "VIDEO" ? "video"
    : format === "CAROUSEL" || format === "DCO" ? "carousel"
    : "image";

  const fromImages = () => firstFrom(media?.images, [IMAGE_FIELD], kind);
  const fromPosters = () => firstFrom(media?.videos, [POSTER_FIELD], kind);
  const fromCards = () => firstFrom(media?.cards, CARD_IMAGE_FIELDS, kind);

  // Order of preference per format, then the remaining sources as fallback.
  const order =
    kind === "video" ? [fromPosters, fromImages, fromCards]
    : kind === "carousel" ? [fromCards, fromImages, fromPosters]
    : [fromImages, fromPosters, fromCards];

  for (const source of order) {
    const picked = source();
    if (picked) return picked;
  }

  // Entries exist; the policy cannot turn any of them into a still. The
  // text-only carousel cards in the real exports land here — measured at 3.2% of
  // a fresh 631-ad collection. That is "unusable", never "none".
  return { outcome: "unusable", entries };
}
