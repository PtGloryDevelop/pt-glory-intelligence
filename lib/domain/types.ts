/**
 * Canonical domain model.
 *
 * Nothing here mirrors the collector's JSON shape. When a collector changes its
 * payload, only lib/collector/normalize.ts moves; these types and everything
 * built on them stay put.
 *
 * Two rules this file enforces by omission:
 *   - No forbidden performance metric exists as a field, so no UI or query can
 *     surface one by accident (CLAUDE.md rule 3).
 *   - No collector-only field (meta_page_id, page_aliases, raw_evidence,
 *     end_date_raw) exists either.
 */

export const COLLECTION_METHODS = [
  "network_response_observation",
  "user_initiated_dom_observation",
  "socialapis_api",
] as const;
export type CollectionMethod = (typeof COLLECTION_METHODS)[number];

/** One collection execution. Scope and provenance live here, not on each ad. */
export type CanonicalRun = {
  sourceProduct: string;
  collectionMethod: CollectionMethod;
  collectorSchemaVersion: string;
  sourceUrl: string | null;
  completenessClaim: string | null;
  scope: {
    country: string | null;
    query: string | null;
    activeStatus: string | null;
    adType: string | null;
    mediaType: string | null;
  };
  /** From the export's generated_at. The only timestamp the file provides. */
  collectedAt: string;
  stopReason: string | null;
  /** What the collector claimed. Provenance only — never a canonical metric. */
  reported: RunCounts & { qualitySummary: Record<string, unknown> | null };
  /** What the server counted from the parsed file. Canonical. */
  computed: RunCounts;
};

export type RunCounts = {
  sourceRows: number;
  uniqueAds: number;
  uniquePages: number;
  unresolvedCount: number;
};

/** Page identity. Mutable page attributes live on CanonicalPageObservation. */
export type CanonicalPage = {
  pageId: string;
  /** Distinct from pageId whenever present; never folded together. */
  pageProfileNumericId: string | null;
  pageProfileUri: string | null;
};

export type CanonicalPageObservation = {
  pageId: string;
  pageName: string | null;
  pageLikeCount: number | null;
  pageCategories: string[];
};

/** Master ad. Only fields that identify the ad or describe its current state. */
export type CanonicalAd = {
  adArchiveId: string;
  pageId: string;
  collationId: string | null;
  startDate: string;
  /** Null while the ad is active; the raw upstream value stays in provenance. */
  endDate: string | null;
  /** Null means the collector could not read the state. Never coerce to false. */
  isActive: boolean | null;
  displayFormat: string | null;
  publisherPlatform: string[];
};

/** Point-in-time reading of everything about an ad that can change. */
export type CanonicalAdObservation = {
  adArchiveId: string;
  isActive: boolean | null;
  collationCount: number | null;
  displayFormat: string | null;
  publisherPlatform: string[];
  ctaType: string | null;
  ctaText: string | null;
  title: string | null;
  bodyText: string | null;
  caption: string | null;
  linkUrl: string | null;
  linkDescription: string | null;
  media: CanonicalMedia;
  provenance: CanonicalProvenance;
};

export type CanonicalMedia = {
  images: unknown[];
  videos: unknown[];
  cards: unknown[];
};

/**
 * Collector-specific trail. Kept beside the observation, never merged into the
 * canonical fields above, so a shape change here cannot leak into the model.
 */
export type CanonicalProvenance = {
  recordKey: string | null;
  startDateRaw: string | null;
  networkEndDateRaw: string | null;
  collectorMeta: Record<string, unknown> | null;
};

/** Everything one import produces, before any database work. */
export type CanonicalImport = {
  run: CanonicalRun;
  pages: CanonicalPage[];
  pageObservations: CanonicalPageObservation[];
  ads: CanonicalAd[];
  adObservations: CanonicalAdObservation[];
  quarantine: QuarantineRow[];
};

export const QUARANTINE_REASONS = [
  "missing_ad_archive_id",
  "unresolved_source_record",
] as const;
export type QuarantineReason = (typeof QUARANTINE_REASONS)[number];

export type QuarantineRow = {
  reason: QuarantineReason;
  payload: unknown;
};
