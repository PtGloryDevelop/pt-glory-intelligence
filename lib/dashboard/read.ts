import {dbUser} from '../db/user.ts';
import {satisfies,type Actor} from '../auth/role-model.ts';
import {getPageList,type PageListRow} from '../read/pages.ts';
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
  top:{unit:string;page_id:string;page_name:string|null;matched_ads:number;new_matched_7d:number;confirmed:boolean}[]};
export type DashboardData={
  generatedAt:string;owned:DashboardOwned|null;rivals:DashboardRivals|null;
  review:OwnedPerformanceData|null;reviewOptions:ReviewOptions;
  rowSeries:Record<string,ReviewSeries>|null;
  watchlist:{total:number;items:WatchListRow[]}|null;
  collisions:DashboardCollisions|null;
  collections:{pending:number;latest:CollectionDto[]}|null;errors:string[];
};

/** Every read uses the caller's JWT. Opening the dashboard never starts a sync
 * or calls Meta/Apify. Partial outages keep the remaining sections usable. */
export async function getDashboard(actor:Actor,options:ReviewOptions={window:7,sort:'spend',period:null}):Promise<DashboardData>{
  const db=await dbUser();
  const output:DashboardData={generatedAt:new Date().toISOString(),owned:null,rivals:null,review:null,reviewOptions:options,rowSeries:null,watchlist:null,collisions:null,collections:null,errors:[]};
  const review=async()=>{
    const latest=await db.from('owned_library_syncs').select('id,daily_from,daily_to').eq('status','completed').order('finished_at',{ascending:false}).limit(1).maybeSingle();
    if(latest.error)throw latest.error;
    const coverage=latest.data?.daily_from&&latest.data?.daily_to?{from:latest.data.daily_from,to:latest.data.daily_to}:null;
    const period=options.period??(coverage?latestReviewPeriod(coverage,options.window):null);
    const params=new URLSearchParams({sort:options.sort,compare:'1',...(period?{period:'custom',from:period.from,to:period.to}:{period:'7d'})});
    output.review=await getOwnedPerformance(params,latest.data?.id);
    try{output.rowSeries=await getReviewSeries(output.review);}catch{output.errors.push('series');}
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
    const [summary,pages,recent]=await Promise.all([
      db.rpc('dashboard_rival_summary'),
      getPageList({kind:'all'},{sort:'recently_found',recentDays:7,limit:6}),
      getCatalogAds({firstSeenSince:from,limit:6}).catch(error=>{
        console.error('Dashboard recent ads unavailable',{code:(error as {code?:string}).code??'unknown'});
        output.errors.push('rivalAds');return null;
      }),
    ]);
    if(summary.error)throw summary.error;
    output.rivals={...summary.data,topPages:pages.rows,recentAds:recent?.rows??null,week:recent?{from,to,newAds:recent.total}:null} as DashboardRivals;
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
    const board=await getRivalBoard(actor);
    const pages=new Map<string,{unit:string;page_id:string;page_name:string|null;matched_ads:number;new_matched_7d:number;confirmed:boolean}>();
    for(const unit of board.units)for(const page of unit.pages){
      const prev=pages.get(page.page_id);const confirmed=page.relation==='direct'||page.relation==='substitute';
      if(!prev||Number(confirmed)>Number(prev.confirmed)||page.matched_ads>prev.matched_ads)pages.set(page.page_id,{unit:unit.name,page_id:page.page_id,page_name:page.page_name,matched_ads:page.matched_ads,new_matched_7d:page.new_matched_7d,confirmed});
    }
    const list=[...pages.values()];
    output.collisions={units:board.units.length,unitsTotal:board.canEdit?board.units.length+board.unitsWithoutKeywords.length:null,pages:list.length,
      confirmed:list.filter(p=>p.confirmed).length,pending:list.filter(p=>!p.confirmed).length,newThisWeek:board.newThisWeek,tracked:board.tracked,
      top:list.sort((a,b)=>b.new_matched_7d-a.new_matched_7d||Number(b.confirmed)-Number(a.confirmed)||b.matched_ads-a.matched_ads).slice(0,4)};
  };
  const tasks:[string,()=>Promise<void>][]=[['rivals',rivals],['watchlist',watchlist],['collisions',collisions]];
  if(satisfies(actor.role,'analyst'))tasks.push(['owned',own],['review',review],['collections',collections]);
  await Promise.all(tasks.map(async([name,run])=>{
    try{await run();}catch(error){
      console.error('Dashboard section unavailable',{section:name,code:(error as {code?:string}).code??'unknown'});
      output.errors.push(name);
    }
  }));
  return output;
}
