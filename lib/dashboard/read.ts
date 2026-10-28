import {dbUser} from '../db/user.ts';
import {satisfies,type Actor} from '../auth/role-model.ts';
import type {PageListRow} from '../read/pages.ts';
import {listWatchItems,type WatchListRow} from '../read/watchlist.ts';
import {listCollections} from '../collect/read.ts';
import type {CollectionDto} from '../collect/dto.ts';
import type {CompanyAd} from '../owned-ads/source-rows.ts';
import type {OwnedMetric} from '../owned-ads/model.ts';
import {cachedOwnedImage} from '../owned-ads/media-cache.ts';
import {getCatalogAds,type CatalogAdRow} from '../read/catalog.ts';
import {getOwnedPerformance} from '../owned-ads/performance-read.ts';
import type {OwnedPerformanceData} from '../owned-ads/performance.ts';
import {latestReviewPeriod,type ReviewOptions} from './review-model.ts';
import {getReviewSeries} from './series-read.ts';
import {getRivalBoard} from '../rivals/board.ts';
import type {ReviewSeries} from './series.ts';
import {getDailySpend,type DailySpend} from './daily-read.ts';

export type DashboardMetric=OwnedMetric & {reportedValue?:number|null};
export type DashboardCurrency={
  currency:string;inventory:number;active:number;unknownStatus:number;metricsAds:number;
  metrics:Record<'spend'|'conversations'|'purchases'|'purchase_value'|'roas',DashboardMetric>;
};
export type DashboardOwned={
  snapshot:{id:string;finished_at:string;source_snapshot_at:string|null;date_start:string;date_end:string;ad_count:number;accounts:{id:string;name:string;currency:string}[]}|null;
  inventory:number;active:number;unknownStatus:number;metricsAds:number;currencies:DashboardCurrency[];topAds:CompanyAd[];
  progress:{id:string;status:'running'|'completed'|'failed';completed_accounts:number;accountsCount:number;started_at:string;finished_at:string|null}|null;
};
export type DashboardRivals={
  ads:number;active:number;inactive:number;unknown:number;pages:number;recentlyFound:number;
  lastCollectedAt:string|null;datasets:number;topPages:PageListRow[];
  recentAds:CatalogAdRow[]|null;week:{from:string;to:string;newAds:number}|null;
};
export type DashboardCollisions={units:number;unitsTotal:number|null;pages:number;confirmed:number;pending:number;newThisWeek:number;tracked:number;
  top:{unit:string;page_id:string;page_name:string|null;matched_ads:number;new_matched_7d:number;confirmed:boolean}[];
  /** Per unit with keywords: its keywords and how many rival pages they match (the team's "unrelated" excluded). */
  byUnit:{id:string;name:string;keywords:string[];pages:number}[]};
/** Active rival ads that started longest ago: on the units' rival pages, or the whole library when no unit has keywords. */
export type DashboardLongest={scope:'units'|'library';rows:CatalogAdRow[]};
export type DashboardData={
  generatedAt:string;owned:DashboardOwned|null;rivals:DashboardRivals|null;
  review:OwnedPerformanceData|null;reviewOptions:ReviewOptions;
  rowSeries:Record<string,ReviewSeries>|null;
  daily:DailySpend|null;
  watchlist:{total:number;items:WatchListRow[]}|null;
  collisions:DashboardCollisions|null;longest:DashboardLongest|null;
  collections:{pending:number;latest:CollectionDto[]}|null;errors:string[];
};

/** Every read uses the caller's JWT. Opening the dashboard never starts a sync
 * or calls Meta/Apify. Partial outages keep the remaining sections usable. */
export async function getDashboard(actor:Actor,options:ReviewOptions={window:7,sort:'spend',period:null,unit:null},sections:('owned'|'watchlist'|'collections')[]=[]):Promise<DashboardData>{
  const db=await dbUser();
  const output:DashboardData={generatedAt:new Date().toISOString(),owned:null,rivals:null,review:null,reviewOptions:options,rowSeries:null,daily:null,watchlist:null,collisions:null,longest:null,collections:null,errors:[]};
  const review=async()=>{
    const latest=await db.from('owned_library_syncs').select('id,daily_from,daily_to').eq('status','completed').order('finished_at',{ascending:false}).limit(1).maybeSingle();
    if(latest.error)throw latest.error;
    const coverage=latest.data?.daily_from&&latest.data?.daily_to?{from:latest.data.daily_from,to:latest.data.daily_to}:null;
    const period=options.period??(coverage?latestReviewPeriod(coverage,options.window):null);
    // Part of today against all of yesterday reads as a fall, so today is shown without a previous window.
    const unfinished=!options.period&&options.window==='today';
    const params=new URLSearchParams({sort:options.sort,compare:unfinished?'0':'1',...(period?{period:'custom',from:period.from,to:period.to}:{period:'7d'}),...(options.unit?{unit:options.unit}:{})});
    const result=await getOwnedPerformance(params,latest.data?.id);
    output.review=result;
    const currency=result.summary.find(item=>item.currency==='THB')?.currency??result.summary[0]?.currency;
    await Promise.all([
      getReviewSeries(result).then(value=>{output.rowSeries=value;}).catch(()=>{output.errors.push('series');}),
      result.ready&&latest.data?.id&&currency?getDailySpend(latest.data.id,result.period,result.coverage,currency,options.unit).then(value=>{output.daily=value;}).catch(()=>{output.errors.push('daily');}):Promise.resolve(),
    ]);
  };
  const own=async()=>{
    const {data,error}=await db.rpc('dashboard_owned_summary');
    if(error)throw error;
    const value=data as DashboardOwned;
    value.topAds=value.topAds.map(row=>({...row,creative_url:cachedOwnedImage(row)??null}));
    output.owned=value;
  };
  const rivals=async()=>{
    const to=output.generatedAt;const from=new Date(Date.parse(to)-7*86_400_000).toISOString();
    const [summary,recent]=await Promise.all([
      db.rpc('dashboard_rival_summary'),
      getCatalogAds({firstSeenSince:from,limit:6}).catch(error=>{
        console.error('Dashboard recent ads unavailable',{code:(error as {code?:string}).code??'unknown'});
        output.errors.push('rivalAds');return null;
      }),
    ]);
    if(summary.error)throw summary.error;
    output.rivals={...summary.data,topPages:[],recentAds:recent?.rows??null,week:recent?{from,to,newAds:recent.total}:null} as DashboardRivals;
  };
  const watchlist=async()=>{
    const items=await listWatchItems();output.watchlist={total:items.length,items:items.slice(0,6)};
  };
  const collections=async()=>{
    const [latest,pending]=await Promise.all([
      listCollections(3),db.from('collection_request_status').select('id',{count:'exact',head:true}).neq('status','succeeded').neq('status','failed'),
    ]);
    if(pending.error)throw pending.error;
    output.collections={pending:pending.count??0,latest};
  };
  const collisions=async()=>{
    const board=await getRivalBoard(actor,{withUnits:false});
    // One unit picked: its rival pages only; the per-unit list for the units table stays whole.
    const scoped=options.unit?board.units.filter(unit=>unit.id===options.unit):board.units;
    const pages=new Map<string,{unit:string;page_id:string;page_name:string|null;matched_ads:number;new_matched_7d:number;confirmed:boolean}>();
    for(const unit of scoped)for(const page of unit.pages){
      const prev=pages.get(page.page_id);const confirmed=page.relation==='direct'||page.relation==='substitute';
      if(!prev||Number(confirmed)>Number(prev.confirmed)||page.matched_ads>prev.matched_ads)pages.set(page.page_id,{unit:unit.name,page_id:page.page_id,page_name:page.page_name,matched_ads:page.matched_ads,new_matched_7d:page.new_matched_7d,confirmed});
    }
    const list=[...pages.values()];
    output.collisions={units:scoped.length,unitsTotal:board.canEdit?board.units.length+board.unitsWithoutKeywords.length:null,pages:list.length,
      confirmed:list.filter(p=>p.confirmed).length,pending:list.filter(p=>!p.confirmed).length,
      newThisWeek:options.unit?list.reduce((sum,page)=>sum+page.new_matched_7d,0):board.newThisWeek,tracked:board.tracked,
      top:list.sort((a,b)=>b.new_matched_7d-a.new_matched_7d||Number(b.confirmed)-Number(a.confirmed)||b.matched_ads-a.matched_ads).slice(0,4),
      byUnit:board.units.map(unit=>({id:unit.id,name:unit.name,keywords:unit.keywords.map(item=>item.keyword),pages:unit.pages.length}))};
    // Longest-running needs the units' pages, so it follows the board rather than racing it.
    const ids=list.map(page=>page.page_id).slice(0,200);
    // A picked unit with no rival pages has no longest-running rival ads; the whole library would answer another question.
    if(options.unit&&!ids.length){output.longest={scope:'units',rows:[]};return;}
    try{
      const longest=await getCatalogAds({sort:'age',active:'active',pageIds:ids.length?ids:null,limit:4});
      output.longest={scope:ids.length?'units':'library',rows:longest.rows};
    }catch(error){
      console.error('Dashboard longest-running ads unavailable',{code:(error as {code?:string}).code??'unknown'});
      output.errors.push('longest');
    }
  };
  // ponytail: owned summary, watchlist and collections stay available for callers that ask; the overview
  // page renders none of them, so it does not pay for them.
  const tasks:[string,()=>Promise<void>][]=[['rivals',rivals],['collisions',collisions]];
  if(sections.includes('watchlist'))tasks.push(['watchlist',watchlist]);
  if(satisfies(actor.role,'analyst')){
    tasks.push(['review',review]);
    if(sections.includes('owned'))tasks.push(['owned',own]);
    if(sections.includes('collections'))tasks.push(['collections',collections]);
  }
  await Promise.all(tasks.map(async([name,run])=>{
    try{await run();}catch(error){
      console.error('Dashboard section unavailable',{section:name,code:(error as {code?:string}).code??'unknown'});
      output.errors.push(name);
    }
  }));
  return output;
}
