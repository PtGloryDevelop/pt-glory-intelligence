import { MAX_BYTES, SCHEMA_VERSION, isForbiddenKey } from "../collector/contract.ts";
import { computeCounts } from "../collector/counts.ts";

/**
 * Apify dataset items → a PT Glory export (spec §6; architecture review §5, §7, §8).
 *
 * Pure: no I/O and no clock — the caller passes generatedAt. The output is the
 * text the unchanged analyzeImport → commitImport path reads; nothing here goes
 * around it.
 *
 * An allowlist, not a blocklist: every row is built from the contract keys
 * below, so a provider field — a forbidden metric or anything else — cannot
 * reach the validator by being overlooked. No discarded value leaves this
 * module; their key *names* do, in quality_summary, as diagnostics.
 */

export const COLLECTION_METHOD = "apify_actor_run";
export const SOURCE_PRODUCT = "PT Glory Collector";
export const COMPLETENESS_CLAIM =
  "Ads returned by an automated Ad Library search for this query, up to the requested limit; not every ad Meta holds for it.";

const IMAGE_KEYS = ["original_image_url", "resized_image_url"] as const;
const VIDEO_KEYS = ["video_hd_url", "video_sd_url", "video_preview_image_url"] as const;
const CARD_KEYS = [
  "title", "body", "caption", "cta_type", "cta_text", "link_url", "link_description",
  ...IMAGE_KEYS, ...VIDEO_KEYS,
] as const;

/** Provider keys the mapping reads. Anything else is discarded and counted by name. */
const READ_ITEM_KEYS: ReadonlySet<string> = new Set([
  "ad_archive_id", "page_id", "page_name", "collation_id", "collation_count", "is_active",
  "start_date", "end_date", "publisher_platform", "snapshot",
]);
const READ_SNAPSHOT_KEYS: ReadonlySet<string> = new Set([
  "page_like_count", "page_categories", "page_profile_uri", "display_format", "cta_type",
  "cta_text", "title", "body", "caption", "link_url", "link_description", "images", "videos", "cards",
]);

export type AdapterInput = {
  items: readonly unknown[];
  collectionRequestId: string;
  /** The collection request's scope. Country never comes from the provider's items. */
  scope: { country: string; query: string; activeStatus: "active" | "all" };
  sourceUrl: string;
  maxRecords: number;
  maxExportBytes: number;
  generatedAt: string;
  /** Evidence for source_exhausted (architecture review §7), supplied by the state machine. */
  stop: { runSucceeded: boolean; ceilingReached: boolean; guardStopped: boolean; exhaustionEvidence: boolean };
};

export type AdapterResult =
  | { ok: true; text: string }
  | { ok: false; reason: "export_too_large"; detail: string };

type Row = Record<string, unknown>;

export function adaptApifyItems(input: AdapterInput): AdapterResult {
  if (!Number.isInteger(input.maxRecords) || input.maxRecords < 1) {
    throw new Error(`maxRecords must be a positive integer: ${input.maxRecords}`);
  }
  const byteLimit = Math.min(input.maxExportBytes, MAX_BYTES);
  // limitPerSource is not a hard cap (C01-A: 50 requested, 59 returned), so the cap is applied here too.
  const kept = input.items.slice(0, input.maxRecords);

  const ads: Row[] = [];
  const unresolved: Row[] = [];
  const seen = new Set<string>();
  const discarded = new Set<string>();
  const forbidden = new Set<string>();
  const unresolvedReasons: Record<string, number> = {};
  let duplicatesRemoved = 0;
  let rowBytes = 0;

  // Two different things, kept apart: a name on the frozen FORBIDDEN_KEYS list,
  // and an ordinary provider field that is simply outside the canonical allowlist.
  const discard = (name: string) => {
    const leaf = name.slice(name.lastIndexOf(".") + 1);
    if (isForbiddenKey(leaf)) forbidden.add(leaf);
    else discarded.add(name);
  };

  for (const item of kept) {
    const row = mapRow(isRecord(item) ? item : {}, discard);
    const problem = unresolvedReason(row);
    if (!problem && seen.has(row.ad_archive_id as string)) {
      duplicatesRemoved += 1;
      continue;
    }

    // Stop before building an export the import boundary could not accept.
    rowBytes += Buffer.byteLength(JSON.stringify(row), "utf8") + 1;
    if (rowBytes > byteLimit) return tooLarge(byteLimit);

    if (problem) {
      unresolvedReasons[problem] = (unresolvedReasons[problem] ?? 0) + 1;
      unresolved.push(row);
    } else {
      seen.add(row.ad_archive_id as string);
      ads.push(row);
    }
  }

  const counts = computeCounts({ ads, unresolved_ads: unresolved });
  const text = JSON.stringify({
    schema_version: SCHEMA_VERSION,
    generated_at: input.generatedAt,
    source_rows: counts.sourceRows,
    unique_ads: counts.uniqueAds,
    unique_pages: counts.uniquePages,
    unresolved_count: counts.unresolvedCount,
    scope: {
      country: input.scope.country,
      query: input.scope.query,
      active_status: input.scope.activeStatus,
      ad_type: "all",
      media_type: "all",
    },
    source: {
      product: SOURCE_PRODUCT,
      collection_method: COLLECTION_METHOD,
      url: input.sourceUrl,
      completeness_claim: COMPLETENESS_CLAIM,
    },
    stop_reason: stopReason(input),
    // Diagnostics, names only: discarded_key_count counts ordinary provider
    // fields left outside the allowlist, forbidden_key_names lists the
    // FORBIDDEN_KEYS actually seen — so a newly shipped metric is visible. No
    // value from either group is ever carried.
    quality_summary: {
      collection_request_id: input.collectionRequestId,
      provider_item_count: input.items.length,
      duplicates_removed: duplicatesRemoved,
      unresolved_reasons: unresolvedReasons,
      discarded_key_count: discarded.size,
      forbidden_key_names: [...forbidden].sort(),
    },
    ads,
    unresolved_ads: unresolved,
  });
  if (Buffer.byteLength(text, "utf8") > byteLimit) return tooLarge(byteLimit);
  return { ok: true, text };
}

function mapRow(item: Row, discard: (name: string) => void): Row {
  for (const key of Object.keys(item)) if (!READ_ITEM_KEYS.has(key)) discard(key);
  const snap = isRecord(item.snapshot) ? item.snapshot : {};
  for (const key of Object.keys(snap)) if (!READ_SNAPSHOT_KEYS.has(key)) discard(`snapshot.${key}`);

  const isActive = typeof item.is_active === "boolean" ? item.is_active : null;
  const start = epochToIso(item.start_date);
  const end = epochToIso(item.end_date);
  const media = (name: string, keys: readonly string[]) =>
    pickEach(snap[name], keys, (key) => discard(`snapshot.${name}[].${key}`));

  return {
    ad_archive_id: id(item.ad_archive_id),
    page_id: id(item.page_id),
    page_name: text(item.page_name),
    page_like_count: finite(snap.page_like_count),
    page_categories: texts(snap.page_categories),
    page_profile_uri: link(snap.page_profile_uri),
    collation_id: id(item.collation_id),
    collation_count: Number.isInteger(item.collation_count) ? item.collation_count : null,
    is_active: isActive,
    start_date: start,
    start_date_raw: start,
    // Apify fills end_date on active ads too. An active ad has no confirmed stop,
    // so its end date survives only as raw provenance — and never the collection time.
    end_date: isActive === false ? end : null,
    network_end_date_raw: end,
    display_format: text(snap.display_format),
    publisher_platform: texts(item.publisher_platform),
    cta_type: text(snap.cta_type),
    cta_text: text(snap.cta_text),
    title: text(snap.title),
    body_text: isRecord(snap.body) ? text(snap.body.text) : null,
    caption: text(snap.caption),
    link_url: link(snap.link_url),
    link_description: text(snap.link_description),
    images: media("images", IMAGE_KEYS),
    videos: media("videos", VIDEO_KEYS),
    cards: media("cards", CARD_KEYS),
  };
}

/** Spec §6.3: rows the validator would reject go to unresolved_ads, never weaken it. */
function unresolvedReason(row: Row): string | null {
  if (row.ad_archive_id === null) return "missing_ad_archive_id";
  if (row.page_id === null) return "missing_page_id";
  if (row.start_date === null) return "invalid_start_date";
  return null;
}

/**
 * limit_reached when the provider returned at least the requested maximum.
 * source_exhausted only when all five conditions of architecture review §7 hold;
 * the provider's `total` can contradict exhaustion but never proves it. Anything
 * else is unknown (null) — SUCCEEDED alone proves nothing (C01-B).
 */
function stopReason({ items, maxRecords, stop }: AdapterInput): "limit_reached" | "source_exhausted" | null {
  if (items.length >= maxRecords) return "limit_reached";
  const contradicted = items.some((item) =>
    isRecord(item) && typeof item.total === "number" && items.length < item.total);
  const exhausted = stop.runSucceeded && !stop.ceilingReached && !stop.guardStopped
    && stop.exhaustionEvidence && !contradicted;
  return exhausted ? "source_exhausted" : null;
}

/** Epoch seconds → ISO 8601 UTC. A value outside the seconds range (milliseconds, say) is not guessed at. */
function epochToIso(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value >= 1e10) return null;
  return new Date(value * 1000).toISOString();
}

function pickEach(value: unknown, keys: readonly string[], discard: (key: string) => void): Row[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((entry) => {
    for (const key of Object.keys(entry)) if (!keys.includes(key)) discard(key);
    return Object.fromEntries(keys.map((key) =>
      [key, /(_url|_uri)$/u.test(key) ? link(entry[key]) : text(entry[key])]));
  });
}

function tooLarge(limit: number): AdapterResult {
  return { ok: false, reason: "export_too_large", detail: `export would exceed ${limit} bytes` };
}

function id(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The collector's own text rule, measured from its output: every text field in
 * 1,000 network-capture rows (the two Pilot exports) is whitespace-collapsed and
 * trimmed, and NFKC is not applied — 460 of 500 body_text values keep
 * NFKC-sensitive characters. Apify returns the same copy with its line breaks
 * intact, so the same rule is applied here; otherwise one unchanged ad would read
 * as new copy depending on which collector saw it.
 */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/gu, " ").trim();
  return collapsed === "" ? null : collapsed;
}

/** URLs keep their exact characters; only surrounding space is dropped. */
function link(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
