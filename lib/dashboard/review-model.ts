import {isOwnedPerformanceDate, parseOwnedPerformanceQuery, type OwnedPerformanceData, type OwnedPerformancePeriod, type OwnedPerformanceSort, type OwnedPerformanceSummary} from '../owned-ads/performance.ts';

export type ReviewOptions={window:7|14|30;sort:OwnedPerformanceSort;period:OwnedPerformancePeriod|null};
export function parseReviewOptions(params:URLSearchParams):ReviewOptions{
  if(params.getAll('window').length>1)throw new Error('ช่วงวันที่ซ้ำกัน');
  const window=params.get('window')??'7';
  if(!['7','14','30'].includes(window))throw new Error('ช่วงวันที่ไม่ถูกต้อง');
  const query=parseOwnedPerformanceQuery(params);
  if(params.has('period')&&query.period!=='custom')throw new Error('ใช้ช่วงวันที่แบบกำหนดเองสำหรับภาพรวม');
  return {window:Number(window) as ReviewOptions['window'],sort:query.sort,period:query.period==='custom'?{from:query.from,to:query.to}:null};
}

/** End on the latest imported date before today. Never compare an unfinished day. */
export function latestReviewPeriod(coverage:OwnedPerformancePeriod,days:number,now=new Date()):OwnedPerformancePeriod{
  const yesterday=new Date(now.getTime()+7*3600000-86400000).toISOString().slice(0,10);
  const to=coverage.to<yesterday?coverage.to:yesterday;
  const from=new Date(Date.parse(to)-(days-1)*86400000).toISOString().slice(0,10);
  if(!isOwnedPerformanceDate(from)||!isOwnedPerformanceDate(to))throw new Error('ช่วงข้อมูลไม่ถูกต้อง');
  return {from,to};
}

type Metric='spend'|'conversations'|'roas'|'cost_per_conversation';
/** Change is neutral, same currency, equal periods, inside imported bounds, and complete source fields.
 * Coverage describes recorded ad/day rows, not proof that every calendar day has records. */
export function reviewChange(data:OwnedPerformanceData,current:OwnedPerformanceSummary|undefined,metric:Metric):number|null{
  const previous=data.previous?.summary.find(item=>item.currency===current?.currency);
  if(!current||!previous||!data.coverage||!data.previous)return null;
  const periods=[data.period,data.previous.period];
  if(periods.some(period=>period.from<data.coverage!.from||period.to>data.coverage!.to))return null;
  if(Date.parse(periods[0].to)-Date.parse(periods[0].from)!==Date.parse(periods[1].to)-Date.parse(periods[1].from))return null;
  const fields=metric==='cost_per_conversation'?['spend','conversations'] as const:[metric] as const;
  for(const group of [current,previous])for(const field of fields){const coverage=group.coverage[field];if(!coverage||!coverage.total||coverage.present!==coverage.total)return null;}
  const before=previous[metric],after=current[metric];
  if(before==null||after==null||!Number.isFinite(before)||!Number.isFinite(after)||before<=0)return null;
  const change=(after-before)/before*100;
  return Number.isFinite(change)?change:null;
}

export function reviewReturnHref(data:OwnedPerformanceData,options:ReviewOptions):string{
  return '/?'+new URLSearchParams({dashboard:'1',window:String(options.window),period:'custom',from:data.period.from,to:data.period.to,sort:options.sort});
}
