import type { CanonicalImport } from "../domain/types.ts";

/**
 * Field coverage per dataset.
 *
 * One `isPresent` used everywhere. Two definitions drifting apart is how a
 * "100% covered" field turns out to be null objects: the previous collector
 * shipped `impressions_with_index` as `{impressions_text: null,
 * impressions_index: -1}` on every row, which a plain null check reports as
 * fully populated.
 */

export const QUALITY_TIERS = ["normal", "partial", "low"] as const;
export type QualityTier = (typeof QUALITY_TIERS)[number];

export const TIER_THRESHOLDS = { normal: 0.8, partial: 0.5 } as const;

export type FieldCoverage = {
  field: string;
  presentCount: number;
  totalCount: number;
  /** Always paired with its counts; never surfaced as a bare percentage. */
  coverage: number;
  tier: QualityTier;
};

/**
 * Absent means: null, undefined, a blank string, an empty array, an array whose
 * every element is itself absent, or an object whose values are all null.
 *
 * Present means a value the collector actually read. `false` and `0` are read
 * values: `is_active = false` is a known state, `page_like_count = 0` is a known
 * count. Only `null` is unknown.
 *
 * Arrays recurse for the same reason objects do — `[{}]` or `[null]` is the
 * array-shaped version of the null-object problem, and calling it covered
 * would repeat the `impressions_with_index` mistake one level up.
 */
export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some(isPresent);
  if (typeof value === "object") {
    const values = Object.values(value as Record<string, unknown>);
    if (values.length === 0) return false;
    return values.some((entry) => entry !== null && entry !== undefined);
  }
  // Numbers and booleans, including 0 and false.
  return true;
}

export function tierFor(coverage: number): QualityTier {
  if (coverage >= TIER_THRESHOLDS.normal) return "normal";
  if (coverage >= TIER_THRESHOLDS.partial) return "partial";
  return "low";
}

export function coverageOf(field: string, values: unknown[]): FieldCoverage {
  const totalCount = values.length;
  const presentCount = values.filter(isPresent).length;
  const coverage = totalCount === 0 ? 0 : presentCount / totalCount;
  return { field, presentCount, totalCount, coverage, tier: tierFor(coverage) };
}

/**
 * Fields measured for every dataset. Chosen because each one drives a metric,
 * a filter or a claim in the UI.
 */
export const MEASURED_FIELDS = [
  "ad_archive_id", "page_id", "page_name", "page_like_count", "page_categories",
  "start_date", "display_format", "cta_type", "cta_text", "body_text", "title",
  "caption", "link_url", "link_description", "images", "videos", "cards",
  "collation_count", "publisher_platform", "is_active",
] as const;

export function computeCoverage(input: CanonicalImport): FieldCoverage[] {
  const ads = input.ads;
  const adsById = new Map(ads.map((ad) => [ad.adArchiveId, ad]));
  const observations = input.adObservations;
  const pageById = new Map(input.pages.map((page) => [page.pageId, page]));
  const pageObsById = new Map(input.pageObservations.map((obs) => [obs.pageId, obs]));

  const pick = (field: (typeof MEASURED_FIELDS)[number]): unknown[] =>
    observations.map((observation) => {
      const ad = adsById.get(observation.adArchiveId);
      const pageObs = ad ? pageObsById.get(ad.pageId) : undefined;
      const page = ad ? pageById.get(ad.pageId) : undefined;
      switch (field) {
        case "ad_archive_id": return observation.adArchiveId;
        case "page_id": return page?.pageId ?? null;
        case "page_name": return pageObs?.pageName ?? null;
        case "page_like_count": return pageObs?.pageLikeCount ?? null;
        case "page_categories": return pageObs?.pageCategories ?? [];
        case "start_date": return ad?.startDate ?? null;
        case "display_format": return observation.displayFormat;
        case "cta_type": return observation.ctaType;
        case "cta_text": return observation.ctaText;
        case "body_text": return observation.bodyText;
        case "title": return observation.title;
        case "caption": return observation.caption;
        case "link_url": return observation.linkUrl;
        case "link_description": return observation.linkDescription;
        case "images": return observation.media.images;
        case "videos": return observation.media.videos;
        case "cards": return observation.media.cards;
        case "collation_count": return observation.collationCount;
        case "publisher_platform": return observation.publisherPlatform;
        case "is_active": return observation.isActive;
      }
    });

  return MEASURED_FIELDS.map((field) => coverageOf(field, pick(field)));
}
