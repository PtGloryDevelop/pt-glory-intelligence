import type {OwnedPerformanceRow,OwnedPerformanceSummary} from '../owned-ads/performance.ts';
import type {ReviewSeries} from './series.ts';
import {reviewAdKey} from './series.ts';

export type UpdateKind='ours'|'rival'|'data';
export type UpdateSeverity='good'|'warn'|'bad';
export type DashboardUpdate={
  id:string;kind:UpdateKind;severity:UpdateSeverity;label:string;title:string;body:string;
  ad?:{account_id:string;ad_id:string};href?:string;hrefLabel?:string;weight:number;
};
type Input={
  summary:OwnedPerformanceSummary|undefined;rows:OwnedPerformanceRow[];series:Record<string,ReviewSeries>|null;
  rivals:{newAds:number;tracked:number}|null;
};

// ponytail: fixed thresholds; move to per-unit targets once the team sets them (Q12).
export const MIN_CHATS=30;      // below this a cost-per-chat is noise
export const MIN_SPEND=3000;    // THB in the window before a surge is worth a line
const HIGH_CPC=1.2, CHEAP_CPC=0.75, LOW_ROAS=0.6, SURGE=50;

const baht=(value:number)=>Math.round(value).toLocaleString('th-TH');
const pct=(value:number)=>`${Math.round(Math.abs(value))}%`;
const where=(row:OwnedPerformanceRow)=>row.unit_names[0]??row.account_name;
/** Meta-reported purchase value ÷ spend for one row; null when either side is missing. */
export const rowRoas=(row:Pick<OwnedPerformanceRow,'spend'|'purchase_value'>)=>row.spend&&row.spend>0&&row.purchase_value!=null?row.purchase_value/row.spend:null;

/** Deterministic, evidence-backed lines from the rows already on the page. One line per ad, strongest first. */
export function buildUpdates({summary,rows,series,rivals}:Input,limit=6):DashboardUpdate[]{
  const out:DashboardUpdate[]=[];
  const avgCpc=summary?.cost_per_conversation??null, avgRoas=summary?.roas??null;
  const seen=new Set<string>();
  const add=(row:OwnedPerformanceRow,item:Omit<DashboardUpdate,'id'|'ad'|'kind'|'weight'>)=>{
    const key=reviewAdKey(row);if(seen.has(key))return;seen.add(key);
    out.push({...item,id:`ad:${key}`,kind:'ours',ad:{account_id:row.account_id,ad_id:row.ad_id},weight:(row.spend??0)*(item.severity==='good'?0.8:1)});
  };
  for(const row of rows){
    const spend=row.spend??0,chats=row.conversations??0,cpc=row.cost_per_conversation,roas=rowRoas(row);
    if(avgCpc&&cpc!=null&&chats>=MIN_CHATS&&cpc>avgCpc*HIGH_CPC)
      add(row,{severity:'warn',label:'ควรตรวจ',title:`${row.ad_name} ค่าทัก ${cpc.toFixed(2)} บาท สูงกว่าภาพรวม ${pct((cpc/avgCpc-1)*100)}`,
        body:`${where(row)} · ทัก ${chats.toLocaleString('th-TH')} · ROAS ${roas?.toFixed(2)??'—'} · ค่าแอด ${baht(spend)} บาท`});
    const change=series?.[reviewAdKey(row)]?.change;
    if(change!=null&&change>=SURGE&&spend>=MIN_SPEND){
      const cheap=avgCpc!=null&&cpc!=null&&cpc<=avgCpc;
      add(row,{severity:cheap?'good':'warn',label:cheap?'โอกาส':'ควรตรวจ',title:`${row.ad_name} ใช้ค่าแอดเพิ่ม ${pct(change)}${cheap&&avgCpc?` และค่าทักถูกกว่าภาพรวม ${pct((1-cpc!/avgCpc)*100)}`:''}`,
        body:`${where(row)} · ค่าแอด ${baht(spend)} บาท · ROAS ${roas?.toFixed(2)??'—'}${row.status&&row.status.toUpperCase()!=='ACTIVE'?' · สถานะล่าสุดไม่ได้กำลังแสดง ตรวจว่าตั้งใจหยุดหรือไม่':''}`});
    }
    if(avgCpc&&avgRoas&&cpc!=null&&roas!=null&&chats>=MIN_CHATS&&cpc<avgCpc*CHEAP_CPC&&roas<avgRoas*LOW_ROAS)
      add(row,{severity:'warn',label:'ควรตรวจ',title:`${row.ad_name} ทักถูก (${cpc.toFixed(2)} บาท) แต่ ROAS ${roas.toFixed(2)}`,
        body:`${where(row)} · ทัก ${chats.toLocaleString('th-TH')} ครั้ง แต่ Meta รายงานยอดซื้อต่ำ · ดูข้อเสนอและการปิดการขาย`});
  }
  const unassigned=rows.filter(row=>!row.unit_names.length);
  if(unassigned.length){
    const spend=unassigned.reduce((total,row)=>total+(row.spend??0),0);
    out.push({id:'data:unassigned',kind:'data',severity:'warn',label:'ต้องแก้ข้อมูล',
      title:`${unassigned.length} ใน ${rows.length} แอดงบสูงสุดยังไม่ผูกยูนิต`,
      body:`ค่าแอดรวม ${baht(spend)} บาท · ผูกเพจเข้ายูนิตใน Ads Management แล้วตัวเลขรายยูนิตจะครบ`,
      href:'/owned-ads/performance',hrefLabel:'ดูแอดของเรา',weight:spend});
  }
  if(rivals&&!rivals.tracked)
    out.push({id:'rival:untracked',kind:'rival',severity:'warn',label:'ข้อมูลยังไม่ตรง',
      title:rivals.newAds?`เพิ่งพบ ${rivals.newAds} แอดคู่แข่ง แต่ยังไม่มีเพจที่ติดตาม`:'ยังไม่มีเพจคู่แข่งที่ติดตาม',
      body:'แอดที่เพิ่งพบมาจากการค้นกว้าง อาจไม่ใช่คู่แข่งตรง · เลือกเพจที่ขายของคล้ายเราเพื่อให้สรุปแม่นขึ้น',
      href:'/competitors',hrefLabel:'ดูคู่แข่ง',weight:0});
  return out.sort((a,b)=>b.weight-a.weight).slice(0,limit);
}
