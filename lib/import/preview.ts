import { analyzeImport, type Analysis, type AnalysisRejection } from "./analyze.ts";
import { dbUser } from "../db/user.ts";

/**
 * The file analysis plus the one thing it cannot know on its own: how much of
 * this export the database has already seen.
 *
 * Writes nothing. The UI renders this; it does not re-derive counts, coverage
 * or the reported-vs-computed decision.
 */

export type PreviewRejection = AnalysisRejection;

export type PreviewSuccess = Omit<Analysis, "counts"> & {
  counts: Analysis["counts"] & { existingAds: number; newAds: number };
};

export type PreviewResult = PreviewSuccess | PreviewRejection;

export async function previewImport(text: string): Promise<PreviewResult> {
  const analysis = analyzeImport(text);
  if (!analysis.ok) return analysis;

  const existingAds = await countExistingAds(analysis.canonical.ads.map((ad) => ad.adArchiveId));

  return {
    ...analysis,
    counts: {
      ...analysis.counts,
      existingAds,
      newAds: analysis.canonical.ads.length - existingAds,
    },
  };
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
