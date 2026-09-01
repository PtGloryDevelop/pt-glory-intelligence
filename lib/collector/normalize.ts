import { isForbiddenKey } from "./contract.ts";
import type { CollectorExport } from "./validate.ts";
import type {
  CanonicalAd, CanonicalAdObservation, CanonicalImport, CanonicalPage,
  CanonicalPageObservation, CanonicalRun, CollectionMethod, QuarantineRow,
} from "../domain/types.ts";
import { computeCounts, readReportedCounts } from "./counts.ts";

/**
 * Collector payload → canonical model.
 *
 * Second layer of protection, not the first: the validator has already rejected
 * unknown and forbidden fields. This maps an explicit allowlist, so even a
 * hand-built row passed straight to the normalizer cannot smuggle a metric
 * through.
 *
 * Deliberately dropped: meta_page_id (identical to page_id in every row of the
 * reference export), page_aliases and raw_evidence and end_date_raw (always
 * empty), and every forbidden metric.
 */

const DROPPED = ["meta_page_id", "page_aliases", "raw_evidence", "end_date_raw"] as const;

export function normalize(file: CollectorExport): CanonicalImport {
  const run = normalizeRun(file);
  const ads: CanonicalAd[] = [];
  const adObservations: CanonicalAdObservation[] = [];
  const quarantine: QuarantineRow[] = [];
  const pages = new Map<string, CanonicalPage>();
  const pageObservations = new Map<string, CanonicalPageObservation>();

  for (const row of file.ads) {
    const adArchiveId = str(row.ad_archive_id);
    const pageId = str(row.page_id);
    if (!adArchiveId) {
      // Row-level outcome, not a broken file: the import continues as partial.
      quarantine.push({ reason: "missing_ad_archive_id", payload: row });
      continue;
    }
    if (!pageId) {
      // The validator requires page_id on every row that has an ad_archive_id,
      // so reaching here means validation was skipped. Neither quarantine
      // reason describes it honestly, so fail loudly instead of mislabelling.
      throw new Error(
        `normalize() received ad ${adArchiveId} without page_id; run validate() first`,
      );
    }

    if (!pages.has(pageId)) {
      pages.set(pageId, {
        pageId,
        pageProfileNumericId: str(row.page_profile_numeric_id),
        pageProfileUri: str(row.page_profile_uri),
      });
      pageObservations.set(pageId, {
        pageId,
        pageName: str(row.page_name),
        pageLikeCount: num(row.page_like_count),
        pageCategories: strArray(row.page_categories),
      });
    }

    ads.push({
      adArchiveId,
      pageId,
      collationId: str(row.collation_id),
      startDate: String(row.start_date),
      endDate: str(row.end_date),
      isActive: bool(row.is_active),
      displayFormat: str(row.display_format),
      publisherPlatform: strArray(row.publisher_platform),
    });

    adObservations.push({
      adArchiveId,
      isActive: bool(row.is_active),
      collationCount: num(row.collation_count),
      displayFormat: str(row.display_format),
      publisherPlatform: strArray(row.publisher_platform),
      ctaType: str(row.cta_type),
      ctaText: str(row.cta_text),
      title: str(row.title),
      bodyText: str(row.body_text),
      caption: str(row.caption),
      linkUrl: str(row.link_url),
      linkDescription: str(row.link_description),
      media: {
        images: array(row.images),
        videos: array(row.videos),
        cards: array(row.cards),
      },
      provenance: {
        recordKey: str(row.record_key),
        startDateRaw: str(row.start_date_raw),
        networkEndDateRaw: str(row.network_end_date_raw),
        collectorMeta: sanitizeMeta(row._pt_glory),
      },
    });
  }

  for (const row of file.unresolved_ads) {
    quarantine.push({ reason: "unresolved_source_record", payload: row });
  }

  return {
    run,
    pages: [...pages.values()],
    pageObservations: [...pageObservations.values()],
    ads,
    adObservations,
    quarantine,
  };
}

function normalizeRun(file: CollectorExport): CanonicalRun {
  const scope = (file.scope ?? {}) as Record<string, unknown>;
  return {
    sourceProduct: String(file.source.product ?? ""),
    collectionMethod: file.source.collection_method as CollectionMethod,
    collectorSchemaVersion: file.schema_version,
    sourceUrl: str(file.source.url),
    completenessClaim: str(file.source.completeness_claim),
    scope: {
      country: str(scope.country),
      query: str(scope.query),
      activeStatus: str(scope.active_status),
      adType: str(scope.ad_type),
      mediaType: str(scope.media_type),
    },
    collectedAt: file.generated_at,
    stopReason: str(file.stop_reason),
    reported: {
      sourceRows: readReportedCounts(file).sourceRows ?? 0,
      uniqueAds: readReportedCounts(file).uniqueAds ?? 0,
      uniquePages: readReportedCounts(file).uniquePages ?? 0,
      unresolvedCount: readReportedCounts(file).unresolvedCount ?? 0,
      qualitySummary: isRecord(file.quality_summary) ? file.quality_summary : null,
    },
    computed: computeCounts(file),
  };
}

/**
 * Collector metadata is stored verbatim except for anything on the forbidden
 * list, so a future collector cannot park a metric inside _pt_glory.
 */
function sanitizeMeta(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isForbiddenKey(key)) continue;
    clean[key] = entry;
  }
  return clean;
}

/** Field names this normalizer intentionally discards. Asserted by tests. */
export const DROPPED_FIELDS = DROPPED;

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
