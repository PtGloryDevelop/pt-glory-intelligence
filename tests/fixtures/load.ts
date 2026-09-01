import { readFileSync } from "node:fs";
import { join } from "node:path";

const GOLDEN_PATH = join(process.cwd(), "tests", "fixtures", "golden-500.json");

/** Raw text of the pinned export, exactly as the collector wrote it. */
export function goldenText(): string {
  return readFileSync(GOLDEN_PATH, "utf8");
}

/**
 * A fresh deep copy every call. Tests mutate their copy freely; the pinned file
 * on disk is never touched, so one careless test cannot corrupt the baseline
 * every other test measures against.
 */
export function goldenExport(): Record<string, unknown> {
  return JSON.parse(goldenText());
}

/** Numbers the pinned fixture is expected to produce. */
export const GOLDEN_EXPECTED = {
  sourceRows: 500,
  uniqueAds: 500,
  uniquePages: 309,
  unresolvedCount: 0,
} as const;

/**
 * Synthetic export builder for edge cases.
 *
 * Starts from a minimal valid shape rather than the golden file so a test that
 * needs one broken field does not silently depend on 500 real rows.
 */
export function syntheticExport(
  overrides: Partial<Record<string, unknown>> = {},
  rows: Record<string, unknown>[] = [syntheticAd()],
  unresolved: Record<string, unknown>[] = [],
): Record<string, unknown> {
  const file: Record<string, unknown> = {
    schema_version: "pt-glory-meta-ad-library-export.v1",
    generated_at: "2026-08-28T09:57:53.687Z",
    source_rows: rows.length + unresolved.length,
    unique_ads: new Set(rows.filter((r) => r.ad_archive_id).map((r) => r.ad_archive_id)).size,
    unique_pages: new Set(
      [...rows, ...unresolved].map((r) => r.page_id).filter(Boolean),
    ).size,
    unresolved_count: unresolved.length,
    scope: { country: "TH", query: "test", active_status: "active", ad_type: "all", media_type: "all" },
    source: {
      product: "PT Glory Meta Ad Library Extension",
      collection_method: "network_response_observation",
      url: "https://www.facebook.com/ads/library/",
      completeness_claim: "test fixture",
    },
    stop_reason: "limit_reached",
    quality_summary: { warning_records: 0, resolved_records: rows.length, unresolved_records: unresolved.length },
    ads: rows,
    unresolved_ads: unresolved,
  };
  return { ...file, ...overrides };
}

export function syntheticAd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ad_archive_id: "100000000000001",
    record_key: "ad:100000000000001",
    page_id: "200000000000001",
    meta_page_id: "200000000000001",
    page_profile_numeric_id: "300000000000001",
    page_profile_uri: "https://www.facebook.com/300000000000001/",
    page_name: "Synthetic Page",
    page_like_count: 1234,
    page_categories: ["Health/beauty"],
    page_aliases: [],
    is_active: true,
    start_date: "2026-01-01T00:00:00.000Z",
    start_date_raw: "2026-01-01T00:00:00.000Z",
    end_date: null,
    end_date_raw: null,
    network_end_date_raw: "2026-08-28T00:00:00.000Z",
    display_format: "IMAGE",
    collation_id: "400000000000001",
    collation_count: 1,
    publisher_platform: ["FACEBOOK"],
    cta_type: "MESSAGE_PAGE",
    cta_text: "ส่งข้อความ",
    title: null,
    body_text: "ข้อความโฆษณาทดสอบ",
    caption: null,
    link_url: null,
    link_description: null,
    images: [{ original_image_url: null, resized_image_url: "https://example.test/a.jpg" }],
    videos: [],
    cards: [],
    raw_evidence: null,
    _pt_glory: {
      source_level: "network",
      collection_method: "network_response_observation",
      source_position: 1,
      request_url: "https://www.facebook.com/api/graphql/",
      parse_warnings: [],
      change_flags: [],
    },
    ...overrides,
  };
}
