import 'server-only';
import {dbUser} from '../db/user.ts';
import type {OwnedPerformancePeriod} from '../owned-ads/performance.ts';
import {reviewDates} from './series.ts';

/** One day of our ads: spend, chats and Meta-reported sales value. Null means the day is not complete, never zero. */
export type DailyPoint={date:string;spend:number|null;conversations:number|null;purchase_value:number|null};
export type DailySpend=DailyPoint[];
type Field='spend'|'conversations'|'purchase_value';
type UnitRow={id:string|null;currency:string}&Record<Field,number|string|null>;

// One snapshot's day never changes, so each (snapshot, day, currency) total is read once per server instance.
// Shared across callers is safe for the same reason as the unit summary: only analyst/admin reach this read
// (the database function refuses anyone else) and owned data is role-scoped, not per-user.
const cache=new Map<string,UnitRow[]>();

/**
 * Totals per day (spend, chats, sales value), every unit and the unassigned ads together (or one unit when `unit` is set), from the same per-unit database read as
 * the unit summary (migration 0054), one day per call. A day whose rows carry any missing spend is null,
 * never a partial sum; a day outside the imported coverage is null too, never a zero.
 */
export async function getDailySpend(sync:string,period:OwnedPerformancePeriod,coverage:OwnedPerformancePeriod|null,currency:string,unit:string|null=null):Promise<DailySpend>{
  const db=await dbUser();
  const dates=reviewDates(period),values=new Map<string,DailyPoint>();
  for(let start=0;start<dates.length;start+=7){
    await Promise.all(dates.slice(start,start+7).map(async date=>{
      if(!coverage||date<coverage.from||date>coverage.to){values.set(date,{date,spend:null,conversations:null,purchase_value:null});return;}
      // The day's per-unit rows are cached, so every unit (and all of them) reads from one call per day.
      const key=`${sync}:${date}`;
      let all=cache.get(key);
      if(!all){
        const {data,error}=await db.rpc('owned_performance_units',{p_sync:sync,p_from:date,p_to:date});
        if(error)throw error;
        all=data as UnitRow[];
        if(cache.size>2000)cache.clear();
        cache.set(key,all);
      }
      const rows=all.filter(row=>row.currency===currency&&(!unit||row.id===unit));
      // A unit with no row that day spent nothing in it; all units together with a missing value stay unknown.
      const total=(field:Field)=>rows.some(row=>row[field]==null||!Number.isFinite(Number(row[field])))?null:rows.reduce((sum,row)=>sum+Number(row[field]),0);
      values.set(date,{date,spend:total('spend'),conversations:total('conversations'),purchase_value:total('purchase_value')});
    }));
  }
  return dates.map(date=>values.get(date)??{date,spend:null,conversations:null,purchase_value:null});
}
