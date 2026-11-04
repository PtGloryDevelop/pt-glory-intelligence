import type {dbUser} from '../db/user.ts';

export type LatestRound={lastCollectedAt:string|null;stamp:string};
type RoundRow={run:{collected_at:string}};

/** `stamp` changes as soon as a round is added or removed, so anything kept from the rival data can be keyed on it. */
export function latestRound(rows:RoundRow[]):LatestRound{
  const lastCollectedAt=rows.reduce<string|null>((latest,row)=>latest===null||Date.parse(row.run.collected_at)>Date.parse(latest)?row.run.collected_at:latest,null);
  return {lastCollectedAt,stamp:`${rows.length}:${lastCollectedAt??''}`};
}

/** The same rounds as dataset_list(), without its per-round counts: this runs on every page, and those took most of its time. */
export async function readLatestRound(db:Awaited<ReturnType<typeof dbUser>>):Promise<LatestRound>{
  const {data,error}=await db.from('datasets').select('run:collection_runs!inner(collected_at),category:categories!inner(id)');
  if(error)throw error;
  return latestRound((data??[]) as unknown as RoundRow[]);
}
