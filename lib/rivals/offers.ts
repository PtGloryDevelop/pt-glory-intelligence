import 'server-only';
import {dbUser} from '../db/user.ts';
import {getPageAds} from '../read/pages.ts';
import {latestReviewPeriod} from '../dashboard/review-model.ts';
import {offerSignals,type OfferSummary} from '../pages/summary.ts';

export type RivalOffer={page_id:string;relation:'direct'|'substitute';summary:OfferSummary|null};
/**
 * The offers written in a unit's ad copy beside those of the rival pages the team matched to it.
 * Ours: ads with spend in the unit over the overview's 7-day window. Rivals: their ads still running at
 * the last collection. A side that could not be read is null; the other still shows.
 */
export type UnitOffers={period:{from:string;to:string}|null;ours:OfferSummary|null;rivals:RivalOffer[]};

// ponytail: one page_ads read per rival page; a unit with more matched pages than this shows the first ones.
const MAX_PAGES=12;

export async function getUnitOffers(unitId:string):Promise<UnitOffers>{
  const db=await dbUser();
  const [latest,relations]=await Promise.all([
    db.from('owned_library_syncs').select('id,daily_ready,daily_from,daily_to').eq('status','completed').order('finished_at',{ascending:false}).limit(1).maybeSingle(),
    db.from('rival_page_units').select('page_id,relation').eq('unit_id',unitId).in('relation',['direct','substitute']).order('decided_at'),
  ]);
  if(relations.error)throw relations.error;
  const ours=async()=>{
    const sync=latest.data;
    if(latest.error||!sync?.daily_ready||!sync.daily_from||!sync.daily_to)return {period:null,summary:null};
    const period=latestReviewPeriod({from:sync.daily_from,to:sync.daily_to},7);
    const {data,error}=await db.rpc('owned_unit_copy',{p_sync:sync.id,p_unit:unitId,p_from:period.from,p_to:period.to});
    if(error)throw error;
    return {period,summary:offerSignals((data??[]) as {title:string|null;body_text:string|null}[])};
  };
  const rivals=(relations.data??[]).slice(0,MAX_PAGES).map(async(row):Promise<RivalOffer>=>{
    const relation=row.relation as RivalOffer['relation'];
    try{
      const ads=await getPageAds({kind:'all'},row.page_id,{signal:'active',sort:'most_reused',limit:500});
      return {page_id:row.page_id,relation,summary:offerSignals(ads.rows)};
    }catch{return {page_id:row.page_id,relation,summary:null};}
  });
  const [own,rivalRows]=await Promise.all([
    ours().catch(error=>{console.error('Owned unit copy unavailable',{code:(error as {code?:string}).code??'unknown'});return {period:null,summary:null};}),
    Promise.all(rivals),
  ]);
  return {period:own.period,ours:own.summary,rivals:rivalRows};
}
