'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {Relation,SearchPage,SearchPages as Result} from '@/lib/rivals/board';
import styles from './search-pages.module.css';

const SHOWN=5;
const UNIT_KEY='ptg:rival-unit';
const n=(value:number)=>value.toLocaleString('th-TH');
const remembered=()=>{try{return window.localStorage.getItem(UNIT_KEY)??'';}catch{return '';}};

/** Where the pages come from: a ส่องแอด search, a pasted page link, or a finished round. */
export type PagesFrom={q:string}|{page:string}|{dataset:string};

/**
 * Pages answered where they were found: pick the unit once (or it is the round's unit), then ใช่ / ไม่ใช่ per
 * page. A yes from a search also keeps the search word as one of the unit's keywords, so the next round's new
 * pages are suggested on ติดตามคู่แข่ง too; the page itself stays there either way.
 */
export function SearchPages({from,title,unit:fixed,waitForAdoption=false}:{
  from:PagesFrom;
  title:(count:number)=>string;
  /** The round's own unit: no picker. */
  unit?:{id:string;name:string};
  /** A round whose pages become the unit's rivals a moment after it finishes: look once more if they have not yet. */
  waitForAdoption?:boolean;
}){
  const key=new URLSearchParams(from as Record<string,string>).toString();
  const [result,setResult]=useState<{key:string;data:Result}|null>(null);
  const [error,setError]=useState('');
  const [picked,setPicked]=useState('');
  const [all,setAll]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<{text:string;unit?:string}|null>(null);
  const [again,setAgain]=useState(0);

  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/rivals/search?'+key,{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error??'เปิดรายชื่อเพจไม่สำเร็จ');
      if(controller.signal.aborted)return;
      setResult({key,data:body});setError('');
      if(!fixed){const saved=remembered();setPicked(current=>current||((body as Result).units.some(item=>item.id===saved)?saved:''));}
    }).catch(failure=>{if(!controller.signal.aborted&&failure.name!=='AbortError')setError(failure.message);});
    return ()=>controller.abort();
  },[key,again,fixed]);

  // The adoption runs one step after the round finishes; a single second look is enough.
  const unitId=fixed?.id??picked;
  const pending=waitForAdoption&&again===0&&result?.key===key&&result.data.pages.length>0&&!result.data.pages.some(page=>page.relations[unitId]);
  useEffect(()=>{
    if(!pending)return;
    const timer=setTimeout(()=>setAgain(1),6000);
    return ()=>clearTimeout(timer);
  },[pending]);

  if(error)return <p className={styles.problem} role="alert">{error}</p>;
  if(!result||result.key!==key||!result.data.pages.length)return null;
  const {units,pages}=result.data;
  const unit=fixed??units.find(item=>item.id===picked)??null;
  const word='q' in from?from.q:null;

  function pick(id:string){
    setPicked(id);setNotice(null);
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
      if(relation==='direct'&&word)await post({action:'keyword-add',unit_id:unit.id,unit_name:unit.name,keyword:word}).catch(()=>null);
      setResult(current=>current&&{...current,data:{...current.data,pages:current.data.pages.map(item=>{
        if(item.page_id!==page.page_id)return item;
        const relations={...item.relations};if(relation)relations[unit.id]=relation;else delete relations[unit.id];
        return {...item,relations};
      })}});
      setNotice(relation==='direct'?{text:`ตั้ง ${name} เป็นคู่แข่งของ ${unit.name} แล้ว`,unit:unit.id}
        :relation==='unrelated'?{text:`เอา ${name} ออกจากคู่แข่งของ ${unit.name} แล้ว`}:{text:`เอา ${name} กลับมาให้ตอบใหม่แล้ว`});
    }catch(failure){setNotice({text:failure instanceof Error?failure.message:'บันทึกไม่สำเร็จ'});}
    finally{setBusy(null);}
  }

  const shown=all?pages:pages.slice(0,SHOWN);
  return <section className={styles.panel} aria-label="เพจ" data-testid="search-pages">
    <div className={styles.head}>
      <h2>{title(pages.length)}</h2>
      {fixed?null:<label className={styles.unit}><span>เป็นคู่แข่งของ</span>
        <select value={picked} onChange={event=>pick(event.target.value)} data-testid="search-pages-unit">
          <option value="">เลือกยูนิต</option>
          {units.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>}
    </div>
    {!unit?<p className={styles.hint}>เลือกยูนิตก่อน แล้วตอบทีละเพจว่าใช่คู่แข่งไหม · เพจที่ตอบว่าใช่จะขึ้นในติดตามคู่แข่งของยูนิตนั้น</p>:null}
    {pending?<p className={styles.hint} role="status">กำลังตั้งเพจเหล่านี้เป็นคู่แข่งของ {unit?.name}…</p>:null}
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
          <span>{word?`แอดที่ตรงคำค้น ${n(page.matched_ads)}`:`${n(page.ads_total)} แอด`} · กำลังแสดง {n(page.active_ads)}{page.longest_days!=null?` · ยิงนานสุด ${n(page.longest_days)} วัน`:''}</span>
        </div>
        {!unit||pending?null
          :relation==='direct'||relation==='substitute'?<span className={styles.done}><span className={styles.yes}>คู่แข่งของ {unit.name} ✓</span><button type="button" className={styles.link} disabled={busy===page.page_id} onClick={()=>decide(page,'unrelated')}>เอาออก</button></span>
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
