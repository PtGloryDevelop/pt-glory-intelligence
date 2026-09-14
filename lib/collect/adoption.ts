import type { PoolClient } from "pg";

export type CommittedRun = {
  runId: string;
  datasetId: string | null;
  ads: number;
  pages: number;
  unresolved: number;
};

/** The canonical-run lookup shared by C09 adoption and C11 manual recovery. */
export async function findCommittedRun(
  client: PoolClient,
  requestId: string,
): Promise<CommittedRun | null> {
  const { rows } = await client.query<{
    run_id: string;
    dataset_id: string | null;
    computed_unique_ads: number;
    computed_unique_pages: number;
    computed_unresolved_count: number;
  }>(
    `select run.id as run_id, dataset.id as dataset_id,
            run.computed_unique_ads, run.computed_unique_pages, run.computed_unresolved_count
       from public.collection_runs run
       left join public.datasets dataset on dataset.collection_run_id = run.id
      where run.reported_quality_summary ->> 'collection_request_id' = $1
      limit 1`,
    [requestId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    runId: row.run_id,
    datasetId: row.dataset_id,
    ads: row.computed_unique_ads,
    pages: row.computed_unique_pages,
    unresolved: row.computed_unresolved_count,
  };
}
