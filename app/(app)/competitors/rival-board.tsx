'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
import type {Relation,RivalBoard as Board,RivalRow,RivalUnit} from '@/lib/rivals/board';
import styles from './rival-board.module.css';

const REL:Record<Relation,string>={direct:'คู่แข่งตรง',substitute:'สินค้าทดแทน',unrelated:'ไม่เกี่ยว'};
const thaiDate=(value:string|null)=>value?new Date(value).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}):'—';
// ponytail: cost from the 1 Oct paid test run (USD 0.021 for 28 ads) and ~30 ads per page; replace with collector pricing once scheduled.
const PER_PAGE_RUN=30*0.021/28;

/** Competitor pages that collide with our units: suggested by team keywords, confirmed by the team. */
export function RivalBoard(){
  const [board,setBoard]=useState<Board|null>(null);
  const [problem,setProblem]=useState<string|null>(null);
  const [reload,setReload]=useState(0);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [draft,setDraft]=useState<Record<string,string>>({});
  const [newUnit,setNewUnit]=useState('');

  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/rivals',{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error??'เปิดข้อมูลไม่สำเร็จ');
      if(!controller.signal.aborted){setBoard(body);setProblem(null);setBusy(null);}
    }).catch(failure=>{if(!controller.signal.aborted&&failure.name!=='AbortError')setProblem(failure.message);});
    return ()=>controller.abort();
  },[reload]);

  async function act(key:string,body:Record<string,unknown>,done:string){
    setBusy(key);setNotice(null);
    try{
      const response=await fetch('/api/rivals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'บันทึกไม่สำเร็จ');
      setNotice(done);setReload(value=>value+1); // busy clears when the refreshed board arrives
    }catch(failure){setNotice(failure instanceof Error?failure.message:'บันทึกไม่สำเร็จ');setBusy(null);}
  }
  const addKeyword=(unit:{id:string;name:string})=>{
    const keyword=(draft[unit.id]??'').trim();if(keyword.length<2)return;
    setDraft(value=>({...value,[unit.id]:''}));
    void act(`kw:${unit.id}`,{action:'keyword-add',unit_id:unit.id,unit_name:unit.name,keyword},`เพิ่มคำค้น “${keyword}” ให้ ${unit.name} แล้ว`);
  };

  if(problem)return <section className={styles.panel}><p className={styles.problem} role="alert">{problem} <button type="button" onClick={()=>setReload(v=>v+1)}>ลองใหม่</button></p></section>;
  if(!board)return <section className={styles.panel}><p className={styles.loading} role="status">กำลังหาคู่แข่งที่ชนกับสินค้าเรา…</p></section>;

  const trackedPages=new Set(board.units.flatMap(unit=>unit.pages.filter(page=>page.tracked).map(page=>page.page_id)));
  const run=board.tracked*PER_PAGE_RUN;

  function row(unit:RivalUnit,page:RivalRow){
    const key=`${unit.id}:${page.page_id}`;
    return <li key={page.page_id} className={styles.row}>
      <span className={styles.avatar} aria-hidden>{(page.page_name??'?').slice(0,1)}</span>
      <div className={styles.main}>
        <Link href={`/pages/${encodeURIComponent(page.page_id)}?scope=all`} className={styles.name}>{page.page_name??page.page_id}</Link>
        <div className={styles.chips}>
          {page.relation?<span className={`${styles.chip} ${styles.confirmed}`}>{REL[page.relation]} · ทีมยืนยันแล้ว</span>:<span className={`${styles.chip} ${styles.suggested}`}>ระบบเสนอจากคำค้น · รอยืนยัน</span>}
          {page.tracked?<span className={`${styles.chip} ${styles.trackedChip}`}>ติดตามอยู่</span>:null}
        </div>
        {page.sample?<p className={styles.sample}>{page.sample}</p>:null}
      </div>
      <dl className={styles.stats}>
        <div><dt>แอดที่ตรงคำค้น</dt><dd>{page.matched_ads} / {page.ads_total}</dd></div>
        <div><dt>กำลังแสดง</dt><dd>{page.active_ads}</dd></div>
        <div><dt>ยิงนานสุด</dt><dd>{page.longest_days==null?'—':`${page.longest_days} วัน`}</dd></div>
        <div><dt>เห็นล่าสุด</dt><dd>{thaiDate(page.last_seen_at)}</dd></div>
      </dl>
      {board!.canEdit?<div className={styles.acts}>
        {page.relation?<button type="button" className={styles.ghost} disabled={busy===key} onClick={()=>act(key,{action:'relation',unit_id:unit.id,unit_name:unit.name,page_id:page.page_id,relation:null},'ย้อนการยืนยันแล้ว')}>แก้ความสัมพันธ์</button>
          :<div className={styles.rel} role="group" aria-label={`ยืนยันความสัมพันธ์ของ ${page.page_name??page.page_id} กับ ${unit.name}`}>
            <span>ยืนยัน:</span>{(['direct','substitute','unrelated'] as Relation[]).map(value=><button type="button" key={value} disabled={busy===key}
              onClick={()=>act(key,{action:'relation',unit_id:unit.id,unit_name:unit.name,page_id:page.page_id,relation:value},value==='unrelated'?`ซ่อน ${page.page_name??'เพจ'} จาก ${unit.name} แล้ว`:`ยืนยันว่าเป็น${REL[value]}ของ ${unit.name} แล้ว`)}>{REL[value]}</button>)}</div>}
        <button type="button" className={page.tracked?styles.on:styles.btn} disabled={busy===`t:${page.page_id}`} onClick={()=>act(`t:${page.page_id}`,{action:'track',page_id:page.page_id,tracked:!page.tracked},page.tracked?'เลิกติดตามแล้ว':'เพิ่มในรายการติดตามของบริษัทแล้ว')}>{page.tracked?'✓ ติดตามแล้ว':'ติดตาม'}</button>
      </div>:null}
    </li>;
  }

  return <div className={styles.layout} data-testid="rival-board">
    <div className={styles.stack}>
      {notice?<p className={styles.notice} role="status">{notice}</p>:null}
      {board.units.map(unit=><section key={unit.id} className={styles.panel} aria-label={`คู่แข่งของ ${unit.name}`}>
        <div className={styles.unitHead}>
          <b className={styles.unit}>{unit.name}</b>
          <div className={styles.keywords}>{unit.keywords.map(k=><span key={k.id} className={styles.kw}>{k.keyword}{board.canEdit?<button type="button" aria-label={`ลบคำค้น ${k.keyword}`} disabled={busy===`kd:${k.id}`} onClick={()=>act(`kd:${k.id}`,{action:'keyword-remove',keyword_id:k.id},`ลบคำค้น “${k.keyword}” แล้ว`)}>×</button>:null}</span>)}</div>
          {board.canEdit?<form className={styles.addKw} onSubmit={event=>{event.preventDefault();addKeyword(unit);}}>
            <label className={styles.srOnly} htmlFor={`kw-${unit.id}`}>เพิ่มคำค้นให้ {unit.name}</label>
            <input id={`kw-${unit.id}`} value={draft[unit.id]??''} maxLength={60} placeholder="+ คำค้น" onChange={event=>setDraft(value=>({...value,[unit.id]:event.target.value}))}/>
          </form>:null}
        </div>
        {unit.pages.length?<ul className={styles.list}>{unit.pages.map(page=>row(unit,page))}</ul>:<p className={styles.empty}>ยังไม่พบเพจที่ตรงคำค้นของยูนิตนี้ในข้อมูลที่เก็บไว้ · ลองเพิ่มคำค้นที่ลูกค้าใช้</p>}
        {unit.hidden?<p className={styles.hidden}>ซ่อนไว้ {unit.hidden} เพจที่ทีมตั้งว่าไม่เกี่ยวกับ {unit.name} · เปิดดูได้จากหน้าเพจคู่แข่ง</p>:null}
      </section>)}
      {!board.units.length?<section className={styles.panel}><div className={styles.start}><h2>เริ่มจากใส่คำค้นให้ยูนิต</h2><p>ใส่คำที่ลูกค้าใช้หาสินค้าของยูนิตนั้น 3–5 คำ เช่น U15: ผงผัก, ดีท็อกซ์, ไขมันในเลือด · ระบบจะหาเพจคู่แข่งจากแอดที่เก็บไว้แล้วให้ทีมยืนยัน</p></div></section>:null}
      {board.canEdit&&board.unitsWithoutKeywords.length?<section className={styles.panel}><form className={styles.newUnit} onSubmit={event=>{event.preventDefault();const unit=board.unitsWithoutKeywords.find(item=>item.id===newUnit);if(unit)addKeyword(unit);}}>
        <label htmlFor="rival-new-unit">เพิ่มคำค้นให้ยูนิตอื่น</label>
        <select id="rival-new-unit" value={newUnit} onChange={event=>setNewUnit(event.target.value)}><option value="">เลือกยูนิต</option>{board.unitsWithoutKeywords.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>
        <input aria-label="คำค้น" value={draft[newUnit]??''} maxLength={60} placeholder="คำค้นแรก" disabled={!newUnit} onChange={event=>setDraft(value=>({...value,[newUnit]:event.target.value}))}/>
        <button type="submit" disabled={!newUnit||(draft[newUnit]??'').trim().length<2}>เพิ่ม</button>
      </form></section>:null}
    </div>
    <aside className={styles.stack}>
      <section className={styles.panel} aria-labelledby="rival-collect-heading">
        <div className={styles.sideHead}><h2 id="rival-collect-heading">รายการติดตามของบริษัท</h2></div>
        <div className={styles.side}>
          <p><b>{board.tracked} เพจ</b> ที่ทีมติดตามร่วมกัน{trackedPages.size<board.tracked?` (แสดงในยูนิตด้านซ้าย ${trackedPages.size} เพจ)`:''}</p>
          <div className={styles.est}><span>ค่าเก็บแอดใหม่ของเพจที่ติดตาม (ประมาณ)</span><b>{board.tracked?`USD ${run.toFixed(2)} ต่อรอบ`:'—'}</b><span>{board.tracked?`≈ USD ${(run*4.3).toFixed(2)} ต่อเดือน ถ้าเก็บสัปดาห์ละครั้ง`:'ยังไม่มีเพจที่ติดตาม'}</span></div>
          <p className={styles.note}>ยังไม่ได้เปิดเก็บอัตโนมัติ · ประมาณจากรอบทดสอบ 1 ต.ค. (USD 0.021 ได้ 28 แอด) สมมติเพจละราว 30 แอดต่อรอบ</p>
        </div>
      </section>
      <section className={styles.panel}><div className={styles.side}><p className={styles.note}>“แอดที่ตรงคำค้น” นับจากข้อความแอดล่าสุดที่เก็บไว้ · Ads Library ไม่มีข้อมูลค่าแอดของคู่แข่ง และไม่มียอดขาย · เพจไม่เท่ากับแบรนด์</p></div></section>
    </aside>
  </div>;
}
