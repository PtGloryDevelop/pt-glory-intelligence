'use client';
import Link from 'next/link';
import type {OfferSummary} from '@/lib/pages/summary';
import type {UnitOffers} from '@/lib/rivals/offers';
import {useJson} from '../owned-ads/use-json';
import styles from './offer-compare.module.css';

const REL={direct:'คู่แข่งตรง',substitute:'สินค้าทดแทน'} as const;
const n=(value:number)=>value.toLocaleString('th-TH');
const day=(value:string)=>new Date(`${value}T12:00:00+07:00`).toLocaleDateString('th-TH',{day:'numeric',month:'short',timeZone:'Asia/Bangkok'});

/** The three cells of one side: offers found, baht amounts (cheapest first, so rows line up), and how many ads were read. */
function Cells({summary,empty}:{summary:OfferSummary|null;empty:string}){
  if(!summary)return <td colSpan={3} className={styles.muted}>อ่านข้อความแอดไม่สำเร็จ</td>;
  if(!summary.readable)return <td colSpan={3} className={styles.muted}>{empty}</td>;
  const of=(ads:number)=>`${n(ads)}/${n(summary.readable)}`;
  const prices=[...summary.prices].sort((a,b)=>a.baht-b.baht);
  return <>
    <td>{summary.offers.length?<div className={styles.chips}>{summary.offers.map(offer=><span key={offer.label} className={styles.chip}><b>{offer.label}</b>{of(offer.ads)}</span>)}</div>:<span className={styles.muted}>ไม่พบคำโปร</span>}</td>
    <td>{prices.length?<div className={styles.chips}>{prices.map(price=><span key={price.baht} className={`${styles.chip} ${styles.price}`}><b>{n(price.baht)} บาท</b>{of(price.ads)}</span>)}</div>:<span className={styles.muted}>ไม่พบราคา</span>}</td>
    <td className={styles.num}>{n(summary.readable)} แอด</td>
  </>;
}

/**
 * Our offers and prices beside those of the pages the team matched to this unit, read from ad copy.
 * Counts of text found (FACT); which offer works better is not something this data can say.
 */
export function OfferCompare({unit,names,reload}:{unit:{id:string;name:string};names:Map<string,string|null>;reload:number}){
  const offers=useJson<UnitOffers>(`/api/rivals/offers?unit=${unit.id}`,reload);
  const data=offers.data;
  return <section className={styles.panel} aria-labelledby="unit-offers-heading" data-testid="unit-offers">
    <div className={styles.head}><h2 id="unit-offers-heading">ข้อเสนอและราคา: เรา vs คู่แข่ง · {unit.name}</h2><span className={styles.fact}>ข้อเท็จจริง</span></div>
    {offers.error?<p className={styles.problem} role="alert">{offers.error}</p>
      :!data?<p className={styles.loading} role="status">กำลังอ่านข้อความแอดของเราและคู่แข่ง…</p>
      :<div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>ใคร</th><th>ข้อเสนอที่พบในข้อความ</th><th>ราคาที่เขียนในแอด</th><th>อ่านจาก</th></tr></thead>
        <tbody>
          <tr className={styles.oursRow}><th scope="row"><span className={styles.who}><span className={styles.ours}>แอดเรา · {unit.name}</span><small>มีค่าแอดใน 7 วัน{data.period?` (${day(data.period.from)}–${day(data.period.to)})`:''}</small></span></th>
            <Cells summary={data.ours} empty="ไม่มีแอดที่มีค่าแอดใน 7 วัน"/></tr>
          {data.rivals.map(row=><tr key={row.page_id}><th scope="row"><span className={styles.who}><Link className={styles.rival} href={`/pages/${row.page_id}?scope=all`}>{names.get(row.page_id)??row.page_id}</Link><small>{REL[row.relation]} · กำลังแสดง</small></span></th>
            <Cells summary={row.summary} empty="ไม่มีแอดที่กำลังแสดงในข้อมูลที่เก็บ"/></tr>)}
          {!data.rivals.length?<tr><td colSpan={4} className={styles.muted}>ยังไม่มีเพจที่ทีมตั้งเป็นคู่แข่งตรงหรือสินค้าทดแทนของ {unit.name} · ตั้งได้ในตารางเพจคู่แข่งด้านล่าง</td></tr>:null}
        </tbody>
      </table></div>}
    <p className={styles.note}>จับคำจากข้อความแอด · ตัวเลขคือจำนวนแอดที่พบคำนั้น / แอดที่อ่าน · ราคาคือตัวเลขที่ตามด้วย “บาท” ในข้อความ อาจเป็นค่าส่งหรือส่วนลดได้ · แอดเรานับแอดที่มีค่าแอดใน 7 วัน คู่แข่งนับแอดที่กำลังแสดงตอนเก็บล่าสุด · บอกได้ว่าใครเสนออะไร ไม่ได้บอกว่าข้อเสนอไหนขายดีกว่า</p>
  </section>;
}
