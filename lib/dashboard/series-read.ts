import 'server-only';
import {dbUser} from '../db/user.ts';
import type {OwnedPerformanceData} from '../owned-ads/performance.ts';
import {reviewDates,reviewSeries,type ReviewDay,type ReviewSeries} from './series.ts';

/** Small bounded read for visible ranking rows only, through caller JWT/RLS.
 * Never transfers the full daily warehouse to the browser or changes its schema. */
export async function getReviewSeries(review:OwnedPerformanceData):Promise<Record<string,ReviewSeries>>{
 if(!review.ready||!review.snapshot||!review.previous||!reviewDates(review.period).length||!reviewDates(review.previous.period).length||!review.rows.length)return {};
 const db=await dbUser(),days:ReviewDay[]=[];
 const ads=[...new Set(review.rows.map(row=>row.ad_id))],accounts=[...new Set(review.rows.map(row=>row.account_id))];
 for(let page=0;page<2;page++){
  const result=await db.from('owned_library_daily').select('account_id,ad_id,insight_date,currency,spend')
   .eq('sync_id',review.snapshot.id).in('ad_id',ads).in('account_id',accounts)
   .gte('insight_date',review.previous.period.from).lte('insight_date',review.period.to)
   .order('account_id').order('ad_id').order('insight_date').range(page*1000,page*1000+999);
  if(result.error)throw result.error;
  days.push(...result.data as ReviewDay[]);
  if(result.data.length<1000)return reviewSeries(review.rows,days,review.period,review.previous.period);
 }
 throw new Error('Daily series exceeds bounded result');
}
