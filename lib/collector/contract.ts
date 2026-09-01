/**
 * The collector export contract, written down so drift is visible.
 *
 * Key sets are exhaustive on purpose. An unfamiliar field means the collector
 * changed and we do not yet know what it means, so the import fails closed
 * instead of quietly dropping it — the collector already shipped a contract
 * change once without bumping schema_version, so the version string cannot be
 * trusted to signal it.
 */

export const SCHEMA_VERSION = "pt-glory-meta-ad-library-export.v1";

/** Guards a single-request import; anything larger belongs to a Phase 2 job. */
export const MAX_RECORDS = 5_000;
export const MAX_BYTES = 25 * 1024 * 1024;

export const FILE_KEYS = [
  "schema_version", "generated_at", "source_rows", "unique_ads", "unique_pages",
  "unresolved_count", "scope", "source", "stop_reason", "quality_summary",
  "ads", "unresolved_ads",
] as const;

export const REQUIRED_FILE_KEYS = [
  "schema_version", "generated_at", "source", "ads", "unresolved_ads",
] as const;

export const SCOPE_KEYS = ["country", "query", "active_status", "ad_type", "media_type"] as const;
export const SOURCE_KEYS = ["product", "collection_method", "url", "completeness_claim"] as const;

/**
 * Ad-row keys observed in the approved network-capture export.
 *
 * Other collection methods have their own payloads; until one is measured and
 * added here it fails closed, which is the intended behaviour.
 */
export const AD_KEYS = [
  "_pt_glory", "ad_archive_id", "body_text", "caption", "cards", "collation_count",
  "collation_id", "cta_text", "cta_type", "display_format", "end_date", "end_date_raw",
  "images", "is_active", "link_description", "link_url", "meta_page_id",
  "network_end_date_raw", "page_aliases", "page_categories", "page_id",
  "page_like_count", "page_name", "page_profile_numeric_id", "page_profile_uri",
  "publisher_platform", "raw_evidence", "record_key", "start_date", "start_date_raw",
  "title", "videos",
] as const;

/**
 * Required on rows that carry an ad_archive_id, because those become ads and
 * cannot exist without a page or a start date.
 *
 * ad_archive_id itself is deliberately absent from this list: a row without one
 * is quarantined as missing_ad_archive_id while the rest of the file commits,
 * so its absence is an import outcome rather than a broken file.
 */
export const REQUIRED_AD_KEYS = ["page_id", "start_date"] as const;

/**
 * Names that must never reach canonical data, whatever a future collector
 * decides to emit. Checked by the validator and again by the normalizer.
 */
export const FORBIDDEN_KEYS = [
  "spend", "currency", "reach", "reach_estimate", "impressions",
  "impressions_with_index", "likes", "engagement", "reactions", "comments",
  "shares", "ctr", "cpc", "cpa", "roas", "sales", "conversion", "conversions",
  "market_share", "total_active_time",
] as const;

export type AdKey = (typeof AD_KEYS)[number];

const AD_KEY_SET: ReadonlySet<string> = new Set(AD_KEYS);
const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_KEYS);

export function isKnownAdKey(key: string): boolean {
  return AD_KEY_SET.has(key);
}

export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_SET.has(key);
}
