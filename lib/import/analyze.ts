import { normalize } from "../collector/normalize.ts";
import { computeCoverage } from "../collector/coverage.ts";
import { validateRaw, type FileRejectReason } from "../collector/validate.ts";
import type { CanonicalImport } from "../domain/types.ts";

/**
 * Everything the confirm screen needs that can be derived from the file alone.
 *
 * Kept free of any database import so the size, schema and count guards can be
 * tested directly — and so a mistake in this layer cannot depend on connection
 * state to show up.
 */

export type AnalysisRejection = { ok: false; reason: FileRejectReason; detail: string };

export type Analysis = {
  ok: true;
  canonical: CanonicalImport;
  scope: {
    query: string | null; country: string | null; collectionMethod: string;
    collectedAt: string; sourceProduct: string; completenessClaim: string | null;
  };
  reported: { sourceRows: number; uniqueAds: number; uniquePages: number; unresolvedCount: number };
  computed: { sourceRows: number; uniqueAds: number; uniquePages: number; unresolvedCount: number };
  counts: {
    ads: number; pages: number; quarantine: number;
    quarantineReasons: Record<string, number>;
  };
  coverage: { field: string; presentCount: number; totalCount: number; coverage: number; tier: string }[];
  willBePartial: boolean;
};

export type AnalysisResult = Analysis | AnalysisRejection;

export function analyzeImport(text: string): AnalysisResult {
  // validateRaw, not validate: it owns the MAX_BYTES check, which is the only
  // ceiling standing between an upload and the JSON parser.
  const parsed = validateRaw(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, detail: parsed.detail };

  const canonical = normalize(parsed.file);
  const quarantineReasons: Record<string, number> = {};
  for (const row of canonical.quarantine) {
    quarantineReasons[row.reason] = (quarantineReasons[row.reason] ?? 0) + 1;
  }

  return {
    ok: true,
    canonical,
    scope: {
      query: canonical.run.scope.query,
      country: canonical.run.scope.country,
      collectionMethod: canonical.run.collectionMethod,
      collectedAt: canonical.run.collectedAt,
      sourceProduct: canonical.run.sourceProduct,
      completenessClaim: canonical.run.completenessClaim,
    },
    reported: canonical.run.reported,
    computed: canonical.run.computed,
    counts: {
      ads: canonical.ads.length,
      pages: canonical.pages.length,
      quarantine: canonical.quarantine.length,
      quarantineReasons,
    },
    coverage: computeCoverage(canonical).map((row) => ({
      field: row.field, presentCount: row.presentCount,
      totalCount: row.totalCount, coverage: row.coverage, tier: row.tier,
    })),
    willBePartial: canonical.quarantine.length > 0,
  };
}
