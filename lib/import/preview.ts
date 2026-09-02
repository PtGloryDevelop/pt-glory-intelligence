import { normalize } from "../collector/normalize.ts";
import { computeCoverage } from "../collector/coverage.ts";
import { validate, type FileRejectReason } from "../collector/validate.ts";
import { dbUser } from "../db/user.ts";
import type { CanonicalImport } from "../domain/types.ts";

/**
 * Everything the confirm screen needs, computed without writing a single row.
 *
 * The UI renders this; it does not re-derive counts, coverage or the
 * reported-vs-computed decision. A file that disagrees with itself has already
 * been rejected here.
 */

export type PreviewRejection = { ok: false; reason: FileRejectReason; detail: string };

export type PreviewSuccess = {
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
    existingAds: number; newAds: number;
  };
  coverage: { field: string; presentCount: number; totalCount: number; coverage: number; tier: string }[];
  willBePartial: boolean;
};

export type PreviewResult = PreviewSuccess | PreviewRejection;

export async function previewImport(text: string): Promise<PreviewResult> {
  const parsed = validateRawText(text);
  if (!parsed.ok) return parsed;

  const canonical = normalize(parsed.file);
  const quarantineReasons: Record<string, number> = {};
  for (const row of canonical.quarantine) {
    quarantineReasons[row.reason] = (quarantineReasons[row.reason] ?? 0) + 1;
  }

  const existingAds = await countExistingAds(canonical.ads.map((ad) => ad.adArchiveId));

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
      existingAds,
      newAds: canonical.ads.length - existingAds,
    },
    coverage: computeCoverage(canonical).map((row) => ({
      field: row.field, presentCount: row.presentCount,
      totalCount: row.totalCount, coverage: row.coverage, tier: row.tier,
    })),
    willBePartial: canonical.quarantine.length > 0,
  };
}

function validateRawText(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false as const, reason: "malformed_json" as const, detail: (error as Error).message };
  }
  const result = validate(parsed);
  return result.ok
    ? { ok: true as const, file: result.file }
    : { ok: false as const, reason: result.reason, detail: result.detail };
}

/** Counts how many of these ads the database already knows, in one query. */
async function countExistingAds(adArchiveIds: string[]): Promise<number> {
  if (adArchiveIds.length === 0) return 0;
  const supabase = await dbUser();
  let existing = 0;
  // Chunked to keep the `in` list within PostgREST's URL limits.
  for (let index = 0; index < adArchiveIds.length; index += 200) {
    const chunk = adArchiveIds.slice(index, index + 200);
    const { count, error } = await supabase
      .from("ads")
      .select("ad_archive_id", { count: "exact", head: true })
      .in("ad_archive_id", chunk);
    if (error) throw error;
    existing += count ?? 0;
  }
  return existing;
}
