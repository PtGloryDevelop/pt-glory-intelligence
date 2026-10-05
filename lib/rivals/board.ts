import 'server-only';
import {dbUser} from '../db/user.ts';
import {satisfies,type Actor} from '../auth/role-model.ts';

export type Relation='direct'|'substitute'|'unrelated';
export type RivalPage={page_id:string;page_name:string|null;matched_ads:number;new_matched_7d:number;ads_total:number;active_ads:number;longest_days:number|null;last_seen_at:string|null;sample:string|null};
export type RivalRow=RivalPage&{relation:Relation|null;tracked:boolean};
export type RivalUnit={id:string;name:string;keywords:{id:string;keyword:string}[];pages:RivalRow[];hidden:number};
export type RivalBoard={units:RivalUnit[];unitsWithoutKeywords:{id:string;name:string}[];tracked:number;canEdit:boolean;lastCollectedAt:string|null;newThisWeek:number};

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Our units (analysts only: owned data). Names follow the latest import; viewers see units that already have keywords. */
async function ownedUnits(db:Awaited<ReturnType<typeof dbUser>>):Promise<{id:string;name:string}[]>{
  const latest=await db.from('owned_library_syncs').select('id,daily_ready,daily_from,daily_to').eq('status','completed').order('finished_at',{ascending:false}).limit(1).maybeSingle();
  if(latest.error||!latest.data?.daily_ready||!latest.data.daily_from)return [];
  const {data,error}=await db.rpc('owned_performance_units',{p_sync:latest.data.id,p_from:latest.data.daily_from,p_to:latest.data.daily_to});
  if(error)return [];
  const seen=new Map<string,string>();
  for(const row of data as {id:string|null;name:string|null}[])if(row.id&&!seen.has(row.id))seen.set(row.id,row.name??row.id);
  return [...seen].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'th',{numeric:true}));
}

/** Suggestions come from keyword matches on collected ad copy; relations and tracking are team decisions. */
export async function getRivalBoard(actor:Actor):Promise<RivalBoard>{
  const db=await dbUser();
  const canEdit=satisfies(actor.role,'analyst');
  const [keywords,relations,tracked,units,collected]=await Promise.all([
    db.from('unit_keywords').select('id,unit_id,unit_name,keyword').order('created_at'),
    db.from('rival_page_units').select('page_id,unit_id,relation'),
    db.from('rival_tracked_pages').select('page_id'),
    canEdit?ownedUnits(db):Promise.resolve([]),
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
  const groups=await Promise.all([...byUnit].map(async([id,entry]):Promise<RivalUnit>=>{
    const {data,error}=await db.rpc('rival_keyword_pages',{p_keywords:entry.keywords.map(k=>k.keyword)});
    if(error)throw new Error('Rival suggestions unavailable');
    const rows=(data as RivalPage[]).map(page=>({...page,relation:relationOf.get(`${page.page_id}:${id}`)??null,tracked:trackedSet.has(page.page_id)}));
    const visible=rows.filter(row=>row.relation!=='unrelated');
    // Confirmed first, then by matched ads.
    visible.sort((a,b)=>Number(Boolean(b.relation))-Number(Boolean(a.relation))||b.matched_ads-a.matched_ads);
    return {id,name:units.find(unit=>unit.id===id)?.name??entry.name,keywords:entry.keywords,pages:visible,hidden:rows.length-visible.length};
  }));
  groups.sort((a,b)=>a.name.localeCompare(b.name,'th',{numeric:true}));
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
