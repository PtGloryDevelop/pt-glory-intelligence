import { getDatasetAds, getDatasetFacets, type ExplorerFilters, type ExplorerRow, type Facet } from "./queries.ts";
import { signArchivedPreviews } from "../media/presentation.ts";

export type DatasetAdsRow = Omit<ExplorerRow, "total_count"> & { archive_url: string | null };
export type DatasetAdsPage = { rows: DatasetAdsRow[]; total: number; facets?: Facet[] };

/**
 * One page of a dataset's ads as the explorer shows it, for the API route and
 * for the page that renders the first page with its HTML. The facets do not
 * depend on the rows, so both reads run together.
 */
export async function datasetAdsPage(datasetId: string, filters: ExplorerFilters, withFacets: boolean): Promise<DatasetAdsPage> {
  const [{ rows, total }, facets] = await Promise.all([
    getDatasetAds(datasetId, filters),
    withFacets ? getDatasetFacets(datasetId) : Promise.resolve(undefined),
  ]);
  // One signing round trip for the page. The URL is short-lived; the object
  // it points at is the durable part.
  const signed = await signArchivedPreviews(rows);
  return {
    rows: rows.map(({ total_count, ...row }) => {
      void total_count;
      return { ...row, archive_url: row.archive_path ? signed.get(row.archive_path) ?? null : null };
    }),
    total,
    facets,
  };
}
