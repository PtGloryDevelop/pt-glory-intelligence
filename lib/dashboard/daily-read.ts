import 'server-only';
import {dbUser} from '../db/user.ts';
import type {OwnedPerformancePeriod} from '../owned-ads/performance.ts';
import {reviewDates} from './series.ts';

export type DailySpend={date:string;spend:number|null}[];
type UnitRow={currency:string;spend:number|string|null};

// One snapshot's day never changes, so each (snapshot, day, currency) total is read once per server instance.
// Shared across callers is safe for the same reason as the unit summary: only analyst/admin reach this read
// (the database function refuses anyone else) and owned data is role-scoped, not per-user.
const cache=new Map<string,number|null>();

/**
 * Total spend per day, every unit and the unassigned ads together, from the same per-unit database read as
 * the unit summary (migration 0054), one day per call. A day whose rows carry any missing spend is null,
 * never a partial sum; a day outside the imported coverage is null too, never a zero.
 */
export async function getDailySpend(sync:string,period:OwnedPerformancePeriod,coverage:OwnedPerformancePeriod|null,currency:string):Promise<DailySpend>{
  const db=await dbUser();
  const dates=reviewDates(period),values=new Map<string,number|null>();
  for(let start=0;start<dates.length;start+=7){
    await Promise.all(dates.slice(start,start+7).map(async date=>{
      if(!coverage||date<coverage.from||date>coverage.to){values.set(date,null);return;}
      const key=`${sync}:${date}:${currency}`;
      if(cache.has(key)){values.set(date,cache.get(key)!);return;}
      const {data,error}=await db.rpc('owned_performance_units',{p_sync:sync,p_from:date,p_to:date});
      if(error)throw error;
      const rows=(data as UnitRow[]).filter(row=>row.currency===currency);
      const value=rows.some(row=>row.spend==null||!Number.isFinite(Number(row.spend)))?null:rows.reduce((sum,row)=>sum+Number(row.spend),0);
      if(cache.size>2000)cache.clear();
      cache.set(key,value);values.set(date,value);
    }));
  }
  return dates.map(date=>({date,spend:values.get(date)??null}));
}
