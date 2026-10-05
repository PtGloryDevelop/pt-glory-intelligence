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
  rivals:{units:number;pages:number;pending:number;newThisWeek:number;tracked:number}|null;
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
  // Competitor lines carry no spend, so they would always sort last; they get reserved slots instead.
  const rivalLines:DashboardUpdate[]=[];
  if(rivals){
    const rival=(id:string,severity:UpdateSeverity,label:string,title:string,body:string,weight=0)=>rivalLines.push({id,kind:'rival',severity,label,title,body,href:'/competitors',hrefLabel:'ดูคู่แข่งที่ชนกับเรา',weight});
    if(!rivals.units)rival('rival:no-keywords','warn','ข้อมูลยังไม่ตรง','ยังไม่ได้ใส่คำค้นให้ยูนิต ระบบจึงหาคู่แข่งที่ชนกับเราไม่ได้','ใส่คำที่ลูกค้าใช้หาสินค้า 3–5 คำต่อยูนิต แล้วระบบจะเสนอเพจคู่แข่งจากแอดที่เก็บไว้');
    else if(rivals.newThisWeek)rival('rival:new','warn','ควรดู',`เพจที่ชนกับสินค้าเรามีแอดใหม่ ${rivals.newThisWeek} ตัวสัปดาห์นี้`,`จาก ${rivals.pages} เพจที่ตรงคำค้นของ ${rivals.units} ยูนิต · ระบบเห็นครั้งแรกใน 7 วัน`,1);
    else rival('rival:quiet','good','ไม่มีความเปลี่ยนแปลง','สัปดาห์นี้ยังไม่พบแอดใหม่จากเพจที่ชนกับสินค้าเรา',`ดู ${rivals.pages} เพจใน ${rivals.units} ยูนิตที่ใส่คำค้นแล้ว${rivals.tracked?'':' · ยังไม่มีเพจที่ติดตาม จึงไม่มีการเก็บแอดใหม่ของเพจเหล่านี้'}`);
    if(rivals.pending)rival('rival:pending','warn','รอทีมยืนยัน',`${rivals.pending} เพจคู่แข่งที่ระบบเสนอยังรอทีมยืนยัน`,'ยืนยันว่าเป็นคู่แข่งตรง สินค้าทดแทน หรือไม่เกี่ยว เพื่อให้สรุปคู่แข่งแม่นขึ้น');
  }
  const reserved=rivalLines.sort((a,b)=>b.weight-a.weight).slice(0,2);
  return [...out.sort((a,b)=>b.weight-a.weight).slice(0,limit-reserved.length),...reserved];
}
