'use client';
import {useState} from 'react';
import type {DailyPoint} from '@/lib/dashboard/daily-read';
import styles from './daily-chart.module.css';

type Metric='spend'|'conversations'|'cost_per_conversation'|'roas';
/** One measure at a time: each has its own scale, so two never share an axis. */
const METRICS:{id:Metric;label:string;unit:string;digits:number}[]=[
  {id:'spend',label:'ค่าแอด',unit:'บาท',digits:0},
  {id:'conversations',label:'ทัก',unit:'ครั้ง',digits:0},
  {id:'cost_per_conversation',label:'ค่าทัก',unit:'บาท',digits:2},
  {id:'roas',label:'ROAS (Meta)',unit:'',digits:2},
];
const RATIOS:Metric[]=['cost_per_conversation','roas'];

const valueOf=(day:DailyPoint,metric:Metric):number|null=>{
  switch(metric){
    case 'spend':return day.spend;
    case 'conversations':return day.conversations;
    case 'cost_per_conversation':return day.spend!=null&&day.conversations?day.spend/day.conversations:null;
    case 'roas':return day.spend&&day.purchase_value!=null?day.purchase_value/day.spend:null;
  }
};
const number=(value:number,digits:number)=>value.toLocaleString('th-TH',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const compact=new Intl.NumberFormat('th-TH',{notation:'compact',maximumFractionDigits:1});
const date=(value:string,weekday=false)=>new Date(`${value}T12:00:00+07:00`).toLocaleDateString('th-TH',{...(weekday?{weekday:'short'}:{}),day:'numeric',month:'short',timeZone:'Asia/Bangkok'});
/** A round top for the axis (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten), with room above the tallest bar for its label. */
function niceTop(value:number):number{
  if(value<=0)return 1;
  const raw=value*1.15,power=10**Math.floor(Math.log10(raw));
  return ([1,1.2,1.5,2,2.5,3,4,5,6,8,10].find(step=>step*power>=raw)??10)*power;
}

/**
 * Our ads day by day: spend, chats, cost per chat or ROAS, as Ads Management reported them.
 * The axis and a reference line carry the scale; only the latest and the highest day are labelled, every
 * other day is one hover (or focus) away and in the table. A day without complete figures is hatched, never zero.
 */
export function DailyChart({days}:{days:DailyPoint[]}){
  const [metric,setMetric]=useState<Metric>('spend');
  const [hover,setHover]=useState<number|null>(null);
  const spec=METRICS.find(item=>item.id===metric)!;
  const values=days.map(day=>valueOf(day,metric));
  const known=days.filter((_,index)=>values[index]!=null);
  // Sums read from the complete days; the ratios are the period's own (total over total), never an average of days.
  const sum=(field:'spend'|'conversations'|'purchase_value')=>known.reduce((total,day)=>total+(day[field]??0),0);
  const reference=!known.length?null:metric==='cost_per_conversation'?(sum('conversations')?sum('spend')/sum('conversations'):null)
    :metric==='roas'?(sum('spend')?sum('purchase_value')/sum('spend'):null):sum(metric)/known.length;
  const ratio=RATIOS.includes(metric);
  const top=niceTop(Math.max(0,...values.map(value=>value??0),reference??0));
  const ticks=[0,top/2,top];
  const axis=(value:number)=>ratio&&metric==='roas'?number(value,1):compact.format(value);
  const fmt=(value:number|null)=>value==null?'—':`${number(value,spec.digits)}${spec.unit?` ${spec.unit}`:''}`;
  const last=values.length-1;
  const peak=values.reduce<number|null>((best,value,index)=>value!=null&&(best==null||value>values[best]!)?index:best,null);
  const every=days.length>20?5:days.length>10?2:1;
  const summary=reference==null?'ยังไม่มีวันที่ข้อมูลครบ'
    :ratio?`ทั้งช่วง ${fmt(reference)}`:`รวม ${fmt(sum(metric as 'spend'|'conversations'))} · เฉลี่ยวันละ ${fmt(reference)}`;
  const incomplete=days.length-known.length;
  const versus=(value:number)=>reference?`${value>=reference?'สูงกว่า':'ต่ำกว่า'}${ratio?'ทั้งช่วง':'ค่าเฉลี่ย'} ${number(Math.abs(value/reference-1)*100,0)}%`:'';

  return <div className={styles.chart}>
    <div className={styles.head}>
      <div className={styles.tabs} role="group" aria-label="ตัวเลขรายวัน">{METRICS.map(item=>
        <button key={item.id} type="button" aria-pressed={item.id===metric} onClick={()=>{setMetric(item.id);setHover(null);}}>{item.label}</button>)}</div>
      <span className={styles.summary}>{summary}{incomplete?` · ข้อมูลไม่ครบ ${incomplete} วัน`:''}</span>
    </div>
    <div className={styles.plot}>
      <div className={styles.axis} aria-hidden>{ticks.map(tick=><span key={tick} style={{bottom:`${tick/top*100}%`}}>{axis(tick)}</span>)}</div>
      <div className={styles.area} role="img" aria-label={`${spec.label}รายวัน: ${days.map((day,index)=>`${date(day.date)} ${fmt(values[index])}`).join(', ')}`}
        onMouseLeave={()=>setHover(null)}>
        {ticks.map(tick=><span key={tick} className={styles.grid} style={{bottom:`${tick/top*100}%`}}/>)}
        {reference!=null?<span className={styles.reference} style={{bottom:`${reference/top*100}%`}}><em>{ratio?'ทั้งช่วง':'เฉลี่ย'}<b>{ratio?number(reference,spec.digits):compact.format(reference)}</b></em></span>:null}
        <div className={styles.columns}>{days.map((day,index)=>{
          const value=values[index];
          const label=value!=null&&(index===last||index===peak);
          return <div key={day.date} className={styles.column} tabIndex={0} data-active={hover===index||undefined}
            onMouseEnter={()=>setHover(index)} onFocus={()=>setHover(index)} onBlur={()=>setHover(null)}
            aria-label={`${date(day.date,true)} ${value==null?'ข้อมูลไม่ครบ':fmt(value)}`}>
            {value==null?<span className={styles.missing}/>
              :<span className={styles.bar} data-last={index===last||undefined} style={{height:`${Math.max(1.5,value/top*100)}%`}}>
                {label?<b className={styles.cap}>{index===last?'ล่าสุด ':''}{number(value,spec.digits)}</b>:null}
              </span>}
          </div>;})}</div>
        {hover!=null?<div className={styles.tip} style={{left:`calc((100% - var(--gutter)) * ${(hover+0.5)/days.length})`}} data-edge={hover<days.length/4?'start':hover>days.length*3/4?'end':undefined} aria-hidden>
          <strong>{fmt(values[hover])}</strong>
          <span>{date(days[hover].date,true)}</span>
          {values[hover]!=null?<span>{versus(values[hover]!)}</span>:<span>ข้อมูลวันนี้ไม่ครบ</span>}
        </div>:null}
      </div>
    </div>
    <div className={styles.xaxis} aria-hidden>{days.map((day,index)=><span key={day.date}>{index%every===0||index===last?(index===0?date(day.date):String(Number(day.date.slice(8)))):''}</span>)}</div>
    <details className={styles.table}>
      <summary>ดูเป็นตาราง</summary>
      <table><thead><tr><th>วันที่</th>{METRICS.map(item=><th key={item.id}>{item.label}</th>)}</tr></thead>
        <tbody>{days.map(day=><tr key={day.date}><td>{date(day.date,true)}</td>{METRICS.map(item=>{const value=valueOf(day,item.id);return <td key={item.id}>{value==null?'—':number(value,item.digits)}</td>;})}</tr>)}</tbody></table>
    </details>
  </div>;
}
