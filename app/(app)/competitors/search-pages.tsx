'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {Relation,SearchPage,SearchPages as Result} from '@/lib/rivals/board';
import styles from './search-pages.module.css';

const SHOWN=5;
const UNIT_KEY='ptg:rival-unit';
const n=(value:number)=>value.toLocaleString('th-TH');
const remembered=()=>{try{return window.localStorage.getItem(UNIT_KEY)??'';}catch{return '';}};

/**
 * The pages behind a ส่องแอด search, answered where they were found: pick the unit once, then ใช่ / ไม่ใช่ per page.
 * A yes also keeps the search word as one of the unit's keywords, so the next round's new pages are suggested on
 * ติดตามคู่แข่ง too; the page itself stays there either way.
 */
export function SearchPages({query}:{query:string}){
  const [result,setResult]=useState<{query:string;data:Result}|null>(null);
  const [error,setError]=useState('');
  const [unitId,setUnitId]=useState('');
  const [all,setAll]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{text:string;unit?:string}|null>(null);

  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/rivals/search?'+new URLSearchParams({q:query}),{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error??'เปิดรายชื่อเพจไม่สำเร็จ');
      if(controller.signal.aborted)return;
      setResult({query,data:body});setError('');setAll(false);setNotice(null);
      const saved=remembered();
      setUnitId(current=>current||((body as Result).units.some(unit=>unit.id===saved)?saved:''));
    }).catch(failure=>{if(!controller.signal.aborted&&failure.name!=='AbortError')setError(failure.message);});
    return ()=>controller.abort();
  },[query]);

  if(error)return <p className={styles.problem} role="alert">{error}</p>;
  if(!result||result.query!==query||!result.data.pages.length)return null;
  const {units,pages}=result.data;
  const unit=units.find(item=>item.id===unitId)??null;

  function pick(id:string){
    setUnitId(id);setNotice(null);
    try{window.localStorage.setItem(UNIT_KEY,id);}catch{/* the choice just is not remembered */}
  }
  async function decide(page:SearchPage,relation:Relation|null){
    if(!unit)return;
    const name=page.page_name??page.page_id;
    setBusy(page.page_id);setNotice(null);
    try{
      const post=(body:Record<string,unknown>)=>fetch('/api/rivals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const response=await post({action:'relation',unit_id:unit.id,unit_name:unit.name,page_id:page.page_id,relation});
      if(!response.ok)throw new Error((await response.json().catch(()=>null))?.error??'บันทึกไม่สำเร็จ');
      // The word is kept for the unit; "already a keyword" is the same outcome.
      if(relation==='direct')await post({action:'keyword-add',unit_id:unit.id,unit_name:unit.name,keyword:query}).catch(()=>null);
      setResult(current=>current&&{...current,data:{...current.data,pages:current.data.pages.map(item=>{
        if(item.page_id!==page.page_id)return item;
        const relations={...item.relations};if(relation)relations[unit.id]=relation;else delete relations[unit.id];
        return {...item,relations};
      })}});
      setNotice(relation==='direct'?{text:`ตั้ง ${name} เป็นคู่แข่งของ ${unit.name} แล้ว`,unit:unit.id}
        :relation==='unrelated'?{text:`ตั้งว่า ${name} ไม่ใช่คู่แข่งของ ${unit.name}`}:{text:`ล้างคำตอบของ ${name} แล้ว`});
    }catch(failure){setNotice({text:failure instanceof Error?failure.message:'บันทึกไม่สำเร็จ'});}
    finally{setBusy(null);}
  }

  const shown=all?pages:pages.slice(0,SHOWN);
  return <section className={styles.panel} aria-label="เพจในผลค้น" data-testid="search-pages">
    <div className={styles.head}>
      <h2>เพจในผลค้น “{query}” · {n(pages.length)} เพจ</h2>
      <label className={styles.unit}><span>เป็นคู่แข่งของ</span>
        <select value={unitId} onChange={event=>pick(event.target.value)} data-testid="search-pages-unit">
          <option value="">เลือกยูนิต</option>
          {units.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
    </div>
    {!unit?<p className={styles.hint}>เลือกยูนิตก่อน แล้วตอบทีละเพจว่าใช่คู่แข่งไหม · เพจที่ตอบว่าใช่จะขึ้นในติดตามคู่แข่งของยูนิตนั้น</p>:null}
    {notice?<p className={styles.notice} role="status">{notice.text}{notice.unit?<> · <Link href={`/competitors?unit=${notice.unit}`}>ดูที่ติดตามคู่แข่ง</Link></>:null}</p>:null}
    <ul className={styles.list}>{shown.map(page=>{
      const relation=unit?page.relations[unit.id]:undefined;
      return <li key={page.page_id} className={styles.row} data-testid="search-page">
        {page.picture
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, no loader
          ?<img className={styles.avatar} src={page.picture} alt="" width={36} height={36} loading="lazy"/>
          :<span className={styles.avatar} aria-hidden>{(page.page_name??'?').slice(0,1)}</span>}
        <div className={styles.text}>
          <Link href={`/pages/${encodeURIComponent(page.page_id)}?scope=all`} className={styles.name}>{page.page_name??page.page_id}</Link>
          <span>แอดที่ตรงคำค้น {n(page.matched_ads)} · กำลังแสดง {n(page.active_ads)}{page.longest_days!=null?` · ยิงนานสุด ${n(page.longest_days)} วัน`:''}</span>
        </div>
        {!unit?null
          :relation==='direct'||relation==='substitute'?<span className={styles.done}><span className={styles.yes}>คู่แข่งของ {unit.name} ✓</span><button type="button" className={styles.link} disabled={busy===page.page_id} onClick={()=>decide(page,null)}>เปลี่ยน</button></span>
          :relation==='unrelated'?<span className={styles.done}><span className={styles.no}>ไม่ใช่คู่แข่ง</span><button type="button" className={styles.link} disabled={busy===page.page_id} onClick={()=>decide(page,null)}>เอากลับ</button></span>
          :<span className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy===page.page_id} onClick={()=>decide(page,'direct')}>ใช่ คู่แข่ง</button>
            <button type="button" className={styles.secondary} disabled={busy===page.page_id} onClick={()=>decide(page,'unrelated')}>ไม่ใช่</button>
          </span>}
      </li>;
    })}</ul>
    {pages.length>SHOWN?<button type="button" className={styles.more} onClick={()=>setAll(value=>!value)}>{all?'ย่อ':`ดูอีก ${n(pages.length-SHOWN)} เพจ`}</button>:null}
  </section>;
}
