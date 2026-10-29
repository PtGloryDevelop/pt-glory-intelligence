import 'server-only';
import {dbUser} from '../db/user.ts';
import {satisfies,type Actor} from '../auth/role-model.ts';
import {supabaseArchiveStore} from '../media/store-supabase.ts';
import {getUnitSummary} from '../owned-ads/unit-summary.ts';

export type Relation='direct'|'substitute'|'unrelated';
export type RivalPage={page_id:string;page_name:string|null;matched_ads:number;new_matched_7d:number;ads_total:number;active_ads:number;longest_days:number|null;last_seen_at:string|null;sample:string|null};
export type RivalRow=RivalPage&{relation:Relation|null;tracked:boolean;picture?:string|null};
/** `hiddenPages` are the pages the team said are not this unit's rivals, so they can be taken back. */
export type RivalUnit={id:string;name:string;keywords:{id:string;keyword:string}[];pages:RivalRow[];hidden:number;hiddenPages:{page_id:string;page_name:string|null}[]};
export type RivalBoard={units:RivalUnit[];unitsWithoutKeywords:{id:string;name:string}[];tracked:number;canEdit:boolean;lastCollectedAt:string|null;newThisWeek:number};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Our units (analysts only: owned data). Names follow the latest import; viewers see units that already have keywords.
 * Read through the unit totals, which are kept per import: grouping a month of daily rows here took most of this board's time. */
async function ownedUnits():Promise<{id:string;name:string}[]>{
  const summary=await getUnitSummary(new URLSearchParams({period:'all'})).catch(()=>null);
  const seen=new Map<string,string>();
  for(const row of summary?.units??[])if(row.id&&!seen.has(row.id))seen.set(row.id,row.name);
  return [...seen].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'th',{numeric:true}));
}

/** Archived page pictures, signed for an hour. A missing picture keeps the letter avatar. */
async function pagePictures(db:Awaited<ReturnType<typeof dbUser>>,pageIds:string[]):Promise<Map<string,string|null>>{
  if(!pageIds.length)return new Map();
  const pictures=await db.from('page_pictures').select('page_id,storage_path').eq('status','archived').in('page_id',pageIds);
  const paths=(pictures.data??[]).filter(row=>row.storage_path);
  const signed=paths.length?await supabaseArchiveStore().getPresentationUrls(paths.map(row=>row.storage_path as string)).catch(()=>new Map<string,string>()):new Map<string,string>();
  return new Map(paths.map(row=>[row.page_id as string,signed.get(row.storage_path as string)??null]));
}

export type SearchPage=RivalPage&{picture:string|null;relations:Record<string,Relation>};
export type SearchPages={units:{id:string;name:string}[];pages:SearchPage[]};

/** Every unit a rival can be for: the owned-ads units, plus a unit that so far only has keywords. Analysts only. */
export async function listRivalUnits():Promise<{id:string;name:string}[]>{
  const db=await dbUser();
  const [units,keywordUnits]=await Promise.all([ownedUnits(),db.from('unit_keywords').select('unit_id,unit_name')]);
  const all=new Map(units.map(unit=>[unit.id,unit.name]));
  for(const row of keywordUnits.data??[])if(!all.has(row.unit_id))all.set(row.unit_id,row.unit_name as string);
  return [...all].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'th',{numeric:true}));
}

/** Where the pages come from: a ส่องแอด search, one pasted page link, or one finished round's dataset. */
export type PageSource={query:string}|{pageId:string}|{datasetId:string};

/**
 * Pages with what the team already decided about each for every unit, so a rival is confirmed where it was
 * found. A search matches like a unit keyword (copy or page name, 60 pages); a page or a round reads by id.
 */
export async function getSearchPages(source:PageSource):Promise<SearchPages>{
  const db=await dbUser();
  const [units,matched,relations]=await Promise.all([
    listRivalUnits(),
    pagesFor(db,source),
    db.from('rival_page_units').select('page_id,unit_id,relation'),
  ]);
  if(relations.error)throw new Error('Search pages unavailable');
  const pictures=await pagePictures(db,matched.map(page=>page.page_id));
  const decided=new Map<string,Record<string,Relation>>();
  for(const row of relations.data??[])decided.set(row.page_id,{...decided.get(row.page_id),[row.unit_id]:row.relation as Relation});
  return {units,pages:matched.map(page=>({...page,picture:pictures.get(page.page_id)??null,relations:decided.get(page.page_id)??{}}))};
}

async function pagesFor(db:Awaited<ReturnType<typeof dbUser>>,source:PageSource):Promise<RivalPage[]>{
  if('query' in source){
    const {data,error}=await db.rpc('rival_keyword_pages',{p_keywords:[source.query]});
    if(error)throw new Error('Search pages unavailable');
    return data as RivalPage[];
  }
  let ids=['pageId' in source?source.pageId:''];
  if('datasetId' in source){
    const {data,error}=await db.from('dataset_ads').select('ads!inner(pages!inner(page_id))').eq('dataset_id',source.datasetId).limit(2000);
    if(error)throw new Error('Round pages unavailable');
    const rows=(data??[]) as unknown as {ads:{pages:{page_id:string}}}[];
    ids=[...new Set(rows.map(row=>row.ads.pages.page_id))].slice(0,200);
  }
  if(!ids.length||!ids[0])return [];
  const {data,error}=await db.rpc('rival_pages_by_id',{p_page_ids:ids});
  if(error)throw new Error('Pages unavailable');
  return data as RivalPage[];
}

/** Suggestions come from keyword matches on collected ad copy; relations and tracking are team decisions. */
export async function getRivalBoard(actor:Actor,{withUnits=true}:{withUnits?:boolean}={}):Promise<RivalBoard>{
  const db=await dbUser();
  const canEdit=satisfies(actor.role,'analyst');
  // Units without keywords and current unit names: the competitors page needs them, the overview does not.
  // They sum every imported day, the slowest read here, so nothing waits for them until the names are applied.
  const unitsRead=canEdit&&withUnits?ownedUnits():Promise.resolve([]);
  const [keywords,relations,tracked,collected]=await Promise.all([
    db.from('unit_keywords').select('id,unit_id,unit_name,keyword').order('created_at'),
    db.from('rival_page_units').select('page_id,unit_id,unit_name,relation'),
    db.from('rival_tracked_pages').select('page_id'),
    db.rpc('dataset_list').select('collected_at').order('collected_at',{ascending:false}).limit(1),
  ]);
  if(keywords.error||relations.error||tracked.error)throw new Error('Rival board unavailable');
  const trackedSet=new Set((tracked.data??[]).map(row=>row.page_id as string));
  const relationOf=new Map((relations.data??[]).map(row=>[`${row.page_id}:${row.unit_id}`,row.relation as Relation]));
  const byUnit=new Map<string,{name:string;keywords:{id:string;keyword:string}[]}>();
  for(const row of keywords.data??[]){
    const entry=byUnit.get(row.unit_id)??{name:row.unit_name as string,keywords:[] as {id:string;keyword:string}[]};
    entry.keywords.push({id:row.id,keyword:row.keyword});byUnit.set(row.unit_id,entry);
  }
  // A unit the team gave rivals from a search, with no keyword of its own, is on the board too.
  for(const row of relations.data??[])if(!byUnit.has(row.unit_id))byUnit.set(row.unit_id,{name:row.unit_name as string,keywords:[]});
  const matchedByUnit=new Map(await Promise.all([...byUnit].map(async([id,entry])=>{
    if(!entry.keywords.length)return [id,[] as RivalPage[]] as const;
    const {data,error}=await db.rpc('rival_keyword_pages',{p_keywords:entry.keywords.map(k=>k.keyword)});
    if(error)throw new Error('Rival suggestions unavailable');
    return [id,data as RivalPage[]] as const;
  })));
  // Pages the team decided on stay whether or not a keyword still finds them: read those by id, once for every unit.
  const decided=(relations.data??[]).filter(row=>!(matchedByUnit.get(row.unit_id)??[]).some(page=>page.page_id===row.page_id));
  const decidedIds=[...new Set(decided.map(row=>row.page_id as string))].slice(0,200);
  const byId=new Map<string,RivalPage>();
  if(decidedIds.length){
    // Without them the board is what it was before (keyword matches only), not an error page.
    const {data,error}=await db.rpc('rival_pages_by_id',{p_page_ids:decidedIds});
    if(error)console.error('Rival pages by id unavailable',error.code);
    else for(const page of data as RivalPage[])byId.set(page.page_id,page);
  }
  const groups=[...byUnit].map(([id,entry]):RivalUnit=>{
    const extra=decided.filter(row=>row.unit_id===id).flatMap(row=>byId.get(row.page_id)??[]);
    const rows=[...matchedByUnit.get(id)??[],...extra].map(page=>({...page,relation:relationOf.get(`${page.page_id}:${id}`)??null,tracked:trackedSet.has(page.page_id)}));
    const visible=rows.filter(row=>row.relation!=='unrelated');
    // Confirmed first, then by matched ads.
    visible.sort((a,b)=>Number(Boolean(b.relation))-Number(Boolean(a.relation))||b.matched_ads-a.matched_ads);
    const hiddenPages=rows.filter(row=>row.relation==='unrelated').map(row=>({page_id:row.page_id,page_name:row.page_name}));
    return {id,name:entry.name,keywords:entry.keywords,pages:visible,hidden:hiddenPages.length,hiddenPages};
  });
  const units=await unitsRead;
  for(const unit of groups)unit.name=units.find(owned=>owned.id===unit.id)?.name??unit.name;
  groups.sort((a,b)=>a.name.localeCompare(b.name,'th',{numeric:true}));
  const byPage=await pagePictures(db,[...new Set(groups.flatMap(unit=>unit.pages.map(page=>page.page_id)))]);
  for(const unit of groups)for(const page of unit.pages)page.picture=byPage.get(page.page_id)??null;
  // A page can collide with several units; count each page's new ads once.
  const newByPage=new Map(groups.flatMap(unit=>unit.pages.map(page=>[page.page_id,page.new_matched_7d] as const)));
  const lastCollectedAt=(collected.data as {collected_at:string}[]|null)?.[0]?.collected_at??null;
  return {units:groups,unitsWithoutKeywords:units.filter(unit=>!byUnit.has(unit.id)),tracked:trackedSet.size,canEdit,lastCollectedAt,
    newThisWeek:[...newByPage.values()].reduce((sum,value)=>sum+value,0)};
}

export class RivalInputError extends Error{}
type Input={action?:unknown;unit_id?:unknown;unit_name?:unknown;keyword?:unknown;keyword_id?:unknown;page_id?:unknown;relation?:unknown;tracked?:unknown};

/** Analyst/admin writes (RLS enforces the role too). Every value is checked before it reaches the database. */
export async function applyRivalAction(input:Input):Promise<void>{
  const db=await dbUser();
  const text=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max?value.trim():null;
  const unit=typeof input.unit_id==='string'&&UUID.test(input.unit_id)?input.unit_id:null;
  const page=typeof input.page_id==='string'&&/^[0-9]{1,32}$/.test(input.page_id)?input.page_id:null;
  let result:{error:{code?:string;message:string}|null};
  switch(input.action){
    case 'keyword-add':{
      const name=text(input.unit_name,120),keyword=text(input.keyword,60);
      if(!unit||!name||!keyword||keyword.length<2)throw new RivalInputError('คำค้นต้องยาว 2–60 ตัวอักษร');
      result=await db.from('unit_keywords').insert({unit_id:unit,unit_name:name,keyword});
      if(result.error?.code==='23505')throw new RivalInputError('มีคำค้นนี้ในยูนิตแล้ว');
      break;
    }
    case 'keyword-remove':{
      if(typeof input.keyword_id!=='string'||!UUID.test(input.keyword_id))throw new RivalInputError('ไม่พบคำค้น');
      result=await db.from('unit_keywords').delete().eq('id',input.keyword_id);break;
    }
    case 'relation':{
      const name=text(input.unit_name,120);
      if(!unit||!page||!name)throw new RivalInputError('ข้อมูลเพจหรือยูนิตไม่ถูกต้อง');
      if(input.relation===null)result=await db.from('rival_page_units').delete().eq('page_id',page).eq('unit_id',unit);
      else if(input.relation==='direct'||input.relation==='substitute'||input.relation==='unrelated')
        result=await db.from('rival_page_units').upsert({page_id:page,unit_id:unit,unit_name:name,relation:input.relation,decided_at:new Date().toISOString()});
      else throw new RivalInputError('ความสัมพันธ์ไม่ถูกต้อง');
      break;
    }
    case 'track':{
      if(!page||typeof input.tracked!=='boolean')throw new RivalInputError('ข้อมูลเพจไม่ถูกต้อง');
      result=input.tracked?await db.from('rival_tracked_pages').upsert({page_id:page}):await db.from('rival_tracked_pages').delete().eq('page_id',page);break;
    }
    default:throw new RivalInputError('ไม่รู้จักคำสั่ง');
  }
  if(result.error)throw new Error('Rival write failed');
}
