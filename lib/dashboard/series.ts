import type {OwnedPerformancePeriod,OwnedPerformanceRow} from '../owned-ads/performance.ts';
export type ReviewDay={account_id:string;ad_id:string;insight_date:string;currency:string;spend:number|string|null};
export type ReviewSeries={points:{date:string;value:number|null}[];previousSpend:number|null;change:number|null};
export const reviewAdKey=(ad:{account_id:string;ad_id:string})=>`${ad.account_id}:${ad.ad_id}`;
export function reviewDates(period:OwnedPerformancePeriod):string[]{
 const count=Math.round((Date.parse(period.to)-Date.parse(period.from))/86400000)+1;
 if(!Number.isFinite(count)||count<1||count>31)return [];
 return Array.from({length:count},(_,index)=>new Date(Date.parse(period.from)+index*86400000).toISOString().slice(0,10));
}
/** Account + ad + currency identity; absent dates and null fields remain null.
 * Per-ad change additionally requires a stored value for every day of both windows. */
export function reviewSeries(rows:OwnedPerformanceRow[],days:ReviewDay[],period:OwnedPerformancePeriod,previous:OwnedPerformancePeriod):Record<string,ReviewSeries>{
 const currentDates=reviewDates(period),beforeDates=reviewDates(previous),output:Record<string,ReviewSeries>={};
 if(!currentDates.length||currentDates.length!==beforeDates.length)return output;
 for(const ad of rows){
  const values=new Map<string,number|null>();
  for(const day of days){
   if(reviewAdKey(day)!==reviewAdKey(ad)||day.currency!==ad.currency)continue;
   const value=day.spend==null?null:Number(day.spend);
   // Duplicate identity/date would make the chart ambiguous: fail that date closed.
   values.set(day.insight_date,values.has(day.insight_date)||value==null||!Number.isFinite(value)||value<0?null:value);
  }
  const points=currentDates.map(date=>({date,value:values.get(date)??null}));
  const before=beforeDates.map(date=>values.get(date)??null);
  const previousSpend=before.every(value=>value!=null)?before.reduce<number>((total,value)=>total+value!,0):null;
  const currentSpend=points.every(point=>point.value!=null)?points.reduce((total,point)=>total+point.value!,0):null;
  const change=previousSpend!=null&&previousSpend>0&&currentSpend!=null?(currentSpend-previousSpend)/previousSpend*100:null;
  output[reviewAdKey(ad)]={points,previousSpend,change:change!=null&&Number.isFinite(change)?change:null};
 }
 return output;
}
/** Separate paths rather than bridging a missing day; flat values stay flat. */
export function seriesSegments(values:(number|null)[],width=120,height=32):string[]{
 const valid=values.filter((value):value is number=>value!=null&&Number.isFinite(value));
 if(!valid.length)return [];
 const min=Math.min(...valid),max=Math.max(...valid),segments:string[]=[];let points:string[]=[];
 values.forEach((value,index)=>{
  if(value==null||!Number.isFinite(value)){if(points.length)segments.push(points.join(' '));points=[];return;}
  const x=4+(values.length>1?index/(values.length-1):0.5)*(width-8);
  const y=max===min?height/2:4+(1-(value-min)/(max-min))*(height-8);
  points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
 });
 if(points.length)segments.push(points.join(' '));
 return segments;
}
