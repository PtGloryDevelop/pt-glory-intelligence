import 'server-only';
import {dbUser} from '../db/user.ts';
import {satisfies,type Role} from '../auth/role-model.ts';

export type FreshnessChip={label:string;stale:boolean};
export type Freshness={owned:FreshnessChip|null;rivals:FreshnessChip|null};

const bangkok=(value:string,withTime=true)=>new Date(value).toLocaleString('th-TH',{day:'numeric',month:'short',timeZone:'Asia/Bangkok',...(withTime?{hour:'2-digit',minute:'2-digit'}:{})});
const daysOld=(value:string,now:number)=>(now-Date.parse(value))/86_400_000;

/** Two cheap reads through the caller's JWT. A failed read hides its chip; it never blocks the page. */
export async function getFreshness(role:Role,now=Date.now()):Promise<Freshness>{
  const db=await dbUser();
  const owned=async():Promise<FreshnessChip|null>=>{
    if(!satisfies(role,'analyst'))return null;
    const {data,error}=await db.from('owned_library_syncs').select('finished_at,daily_to').eq('status','completed').order('finished_at',{ascending:false}).limit(1).maybeSingle();
    if(error||!data)return null;
    const through=data.daily_to as string|null;
    // ponytail: 2 days = yesterday's import missing; tune if the daily job moves.
    return {label:through?`แอดเรา ข้อมูลถึง ${bangkok(`${through}T12:00:00+07:00`,false)}`:`แอดเรา นำเข้า ${bangkok(data.finished_at as string)}`,stale:through?daysOld(`${through}T23:59:59+07:00`,now)>2:false};
  };
  const rivals=async():Promise<FreshnessChip|null>=>{
    const {data,error}=await db.rpc('dataset_list').select('collected_at').order('collected_at',{ascending:false}).limit(1);
    const latest=(data as {collected_at:string}[]|null)?.[0]?.collected_at;
    if(error||!latest)return null;
    return {label:`คู่แข่ง เก็บล่าสุด ${bangkok(latest)}`,stale:daysOld(latest,now)>7};
  };
  const [o,r]=await Promise.all([owned().catch(()=>null),rivals().catch(()=>null)]);
  return {owned:o,rivals:r};
}
