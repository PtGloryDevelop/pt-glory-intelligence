import type { RunCounts } from "../domain/types.ts";

/**
 * Frozen recomputation of the four file-level counts.
 *
 * Transcribed from the collector's own buildExportContract so a correct export
 * can never be rejected over a semantics disagreement:
 *
 *   const ads        = rows.filter(r => Boolean(r.ad_archive_id));
 *   const unresolved = rows.filter(r => !r.ad_archive_id);
 *   const pages      = new Set(rows.map(r => r.page_id).filter(Boolean));
 *   source_rows      = rows.length
 *   unique_ads       = new Set(ads.map(r => r.ad_archive_id)).size
 *   unique_pages     = pages.size
 *   unresolved_count = unresolved.length
 *
 * Two details that are easy to get wrong:
 *   - `unique_pages` counts across ads AND unresolved_ads, not ads alone.
 *   - emptiness follows JS falsiness (`""`, null, undefined, 0), matching the
 *     collector's `Boolean(...)`.
 */

type Row = { ad_archive_id?: unknown; page_id?: unknown };

export function collectorRows(file: { ads?: Row[]; unresolved_ads?: Row[] }): Row[] {
  return [...(file.ads ?? []), ...(file.unresolved_ads ?? [])];
}

export function computeCounts(file: { ads?: Row[]; unresolved_ads?: Row[] }): RunCounts {
  const rows = collectorRows(file);
  const withId = rows.filter((row) => Boolean(row.ad_archive_id));
  const withoutId = rows.filter((row) => !row.ad_archive_id);

  return {
    sourceRows: rows.length,
    uniqueAds: new Set(withId.map((row) => String(row.ad_archive_id))).size,
    uniquePages: new Set(
      rows.map((row) => row.page_id).filter(Boolean).map((value) => String(value)),
    ).size,
    unresolvedCount: withoutId.length,
  };
}

export type CountMismatch = {
  field: keyof RunCounts;
  reported: number | null;
  computed: number;
};

const REPORTED_KEYS: Record<keyof RunCounts, string> = {
  sourceRows: "source_rows",
  uniqueAds: "unique_ads",
  uniquePages: "unique_pages",
  unresolvedCount: "unresolved_count",
};

export function readReportedCounts(file: Record<string, unknown>): Partial<RunCounts> {
  const reported: Partial<RunCounts> = {};
  for (const [canonical, sourceKey] of Object.entries(REPORTED_KEYS) as [keyof RunCounts, string][]) {
    const value = file[sourceKey];
    if (typeof value === "number") reported[canonical] = value;
  }
  return reported;
}

/**
 * Compares what the collector claimed against what we counted.
 *
 * A field the collector omitted is not a mismatch — there is nothing to
 * disagree with. A field it reported with a different number is.
 */
export function diffCounts(reported: Partial<RunCounts>, computed: RunCounts): CountMismatch[] {
  const mismatches: CountMismatch[] = [];
  for (const field of Object.keys(REPORTED_KEYS) as (keyof RunCounts)[]) {
    const claimed = reported[field];
    if (claimed === undefined) continue;
    if (claimed !== computed[field]) {
      mismatches.push({ field, reported: claimed, computed: computed[field] });
    }
  }
  return mismatches;
}
