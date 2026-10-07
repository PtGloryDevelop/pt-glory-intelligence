'use client';
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {useEffect,useState} from 'react';
import type {Relation,RivalBoard as Board,RivalRow,RivalUnit} from '@/lib/rivals/board';
import type {CatalogAdRow,CatalogPage} from '@/lib/read/catalog';
import type {RailUnit} from '@/lib/owned-ads/command-center';
import {AdCard} from '@/components/AdCard';
import {AdDrawer} from '@/components/AdDrawer';
import {UnitRail} from '../owned-ads/unit-rail';
import {useJson} from '../owned-ads/use-json';
import styles from './rival-board.module.css';

const REL:Record<Relation,string>={direct:'คู่แข่งตรง',substitute:'สินค้าทดแทน',unrelated:'ไม่เกี่ยว'};
const thaiDate=(value:string|null)=>value?new Date(value).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}):'—';
const n=(value:number)=>value.toLocaleString('th-TH');
type Strip='new'|'age';

/** Competitor ads first (new this week, running longest), then the pages that collide with each unit. */
export function RivalBoard(){
  const params=useSearchParams(),pathname=usePathname();
  const unitId=params.get('unit')??'';
  const [board,setBoard]=useState<Board|null>(null);
  const [problem,setProblem]=useState<string|null>(null);
  const [reload,setReload]=useState(0);
  const [busy,setBusy]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [draft,setDraft]=useState<Record<string,string>>({});
  const [more,setMore]=useState<Record<Strip,boolean>>({new:false,age:false});
  const [selected,setSelected]=useState<CatalogAdRow|null>(null);

  useEffect(()=>{
    const controller=new AbortController();
    fetch('/api/rivals',{cache:'no-store',signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error??'เปิดข้อมูลไม่สำเร็จ');
      if(!controller.signal.aborted){setBoard(body);setProblem(null);setBusy(null);}
    }).catch(failure=>{if(!controller.signal.aborted&&failure.name!=='AbortError')setProblem(failure.message);});
    return ()=>controller.abort();
  },[reload]);

  // Scope: one unit, or every unit that has keywords. Units without keywords show the "add keywords" start instead.
  const bare=board?.unitsWithoutKeywords.find(unit=>unit.id===unitId)??null;
  const scope=(board?.units??[]).filter(unit=>!unitId||unit.id===unitId);
  const pageIds=[...new Set(scope.flatMap(unit=>unit.pages.map(page=>page.page_id)))].slice(0,60).join(',');
  const fresh=useJson<CatalogPage>(board&&pageIds&&!bare?`/api/catalog/ads?pages=${pageIds}&period=week&sort=new&limit=${more.new?24:4}`:null);
  const long=useJson<CatalogPage>(board&&pageIds&&!bare?`/api/catalog/ads?pages=${pageIds}&active=active&sort=age&limit=${more.age?24:4}`:null);

  function pick(id:string){
    const next=new URLSearchParams(params);if(id)next.set('unit',id);else next.delete('unit');
    window.history.replaceState(null,'',`${pathname}${next.size?`?${next}`:''}`);
    setMore({new:false,age:false});setNotice(null);
  }
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

  const unitNew=(unit:RivalUnit)=>unit.pages.reduce((sum,page)=>sum+page.new_matched_7d,0);
  const pending=(unit:RivalUnit)=>unit.pages.filter(page=>!page.relation).length;
  if(problem)return <section className={styles.panel}><p className={styles.problem} role="alert">{problem} <button type="button" onClick={()=>setReload(v=>v+1)}>ลองใหม่</button></p></section>;
  if(!board)return <section className={styles.panel}><p className={styles.loading} role="status">กำลังหาเพจคู่แข่งของแต่ละยูนิต…</p></section>;

  const rail:RailUnit[]=[
    ...board.units.map(unit=>({id:unit.id,name:unit.name,ads:unit.pages.length,falling:0,note:`${n(unit.pages.length)} เพจ${unitNew(unit)?` · ${n(unitNew(unit))} ใหม่`:''}`})),
    ...(board.canEdit?board.unitsWithoutKeywords.map(unit=>({id:unit.id,name:unit.name,ads:0,falling:0,note:'+ คำค้น',dim:true})):[]),
  ];
  const scopeName=unitId?scope[0]?.name??bare?.name??'ยูนิตที่เลือก':'ทุกยูนิต';

  const strip=(key:Strip,title:string,why:string,result:{data:CatalogPage|null;error:string|null})=><section className={styles.panel} data-testid={`rival-${key}`}>
    <div className={styles.head}><h2>{title}</h2>{result.data&&result.data.total>4?<button type="button" className={styles.more} onClick={()=>setMore(value=>({...value,[key]:!value[key]}))}>{more[key]?'ย่อ':`ดูทั้งหมด${result.data.total>24?' (24 แอดแรก)':''}`}</button>:null}</div>
    <p className={styles.why}>{why}</p>
    {result.error?<p className={styles.problem} role="alert">{result.error}</p>:null}
    {!result.data&&!result.error?<p className={styles.loading} role="status">กำลังเปิดแอดคู่แข่ง…</p>:null}
    {result.data?(result.data.rows.length?<div className={styles.cards}>{result.data.rows.map(ad=><div key={ad.ad_archive_id} className={styles.cardWrap}>
      <AdCard ad={ad} onOpen={()=>setSelected(ad)}/>
      {board.canEdit?<Link className={styles.compare} href={`/compare/ads?${new URLSearchParams({dataset:ad.dataset_id,rival:ad.ad_archive_id,returnTo:'/competitors'})}`}>เทียบกับแอดเรา →</Link>:null}
    </div>)}</div>:<p className={styles.empty}>{key==='new'?'ยังไม่พบแอดใหม่จากเพจเหล่านี้ใน 7 วัน':'ยังไม่มีแอดที่กำลังแสดงจากเพจเหล่านี้'}</p>):null}
  </section>;

  function row(unit:RivalUnit,page:RivalRow){
    const key=`${unit.id}:${page.page_id}`;
    return <tr key={page.page_id}>
      <td><div className={styles.pageCell}>
        {page.picture
          // eslint-disable-next-line @next/next/no-img-element -- signed storage URL, no loader
          ?<img className={styles.avatar} src={page.picture} alt="" width={32} height={32} loading="lazy"/>
          :<span className={styles.avatar} aria-hidden>{(page.page_name??'?').slice(0,1)}</span>}
        <div className={styles.pageText}><Link href={`/pages/${encodeURIComponent(page.page_id)}?scope=all`} className={styles.name} title={page.sample??undefined}>{page.page_name??page.page_id}</Link>
          {page.tracked?<span className={`${styles.chip} ${styles.trackedChip}`}>เก็บแอดใหม่อยู่</span>:null}</div>
      </div></td>
      <td className={styles.r}><b>{n(page.new_matched_7d)}</b></td>
      <td className={styles.r}>{n(page.active_ads)}</td>
      <td className={styles.r}>{page.longest_days==null?'—':`${n(page.longest_days)} วัน`}</td>
      {board!.canEdit?<>
        <td>{page.relation?<span className={styles.relDone}><span className={`${styles.chip} ${styles.confirmed}`}>{REL[page.relation]} ✓</span><button type="button" className={styles.ghost} disabled={busy===key} onClick={()=>act(key,{action:'relation',unit_id:unit.id,unit_name:unit.name,page_id:page.page_id,relation:null},'ล้างผลตรวจแล้ว')}>เปลี่ยน</button></span>
          :<div className={styles.rel} role="group" aria-label={`ตรวจว่า ${page.page_name??page.page_id} เป็นอะไรกับ ${unit.name}`}>{(['direct','substitute','unrelated'] as Relation[]).map(value=><button type="button" key={value} disabled={busy===key}
            onClick={()=>act(key,{action:'relation',unit_id:unit.id,unit_name:unit.name,page_id:page.page_id,relation:value},value==='unrelated'?`ซ่อน ${page.page_name??'เพจ'} จาก ${unit.name} แล้ว`:`ตั้งเป็น${REL[value]}ของ ${unit.name} แล้ว`)}>{REL[value]}</button>)}</div>}</td>
        <td><button type="button" className={page.tracked?styles.on:styles.btn} disabled={busy===`t:${page.page_id}`} onClick={()=>act(`t:${page.page_id}`,{action:'track',page_id:page.page_id,tracked:!page.tracked},page.tracked?'หยุดเก็บแอดใหม่ของเพจนี้แล้ว':'เพิ่มเพจนี้ในรายการเก็บแอดใหม่แล้ว')} title={page.tracked?'กดเพื่อหยุดเก็บ':'ให้ระบบเก็บแอดใหม่ของเพจนี้ทุกรอบ'}>{page.tracked?'✓ เก็บอยู่':'เก็บแอดใหม่'}</button></td>
      </>:<td>{page.relation?REL[page.relation]:'ยังไม่ได้ตรวจ'}</td>}
    </tr>;
  }

  const pagesTable=(unit:RivalUnit)=><section key={unit.id} className={styles.panel} aria-label={`เพจคู่แข่งของ ${unit.name}`}>
    <div className={styles.head}><h2>เพจคู่แข่งของ {unit.name} · {n(unit.pages.length)} เพจ</h2>{pending(unit)?<span className={`${styles.chip} ${styles.suggested}`}>รอทีมตรวจ {n(pending(unit))}</span>:null}</div>
    <div className={styles.keywords}><span className={styles.kwLabel}>คำค้นที่ใช้หาคู่แข่ง:</span>
      {unit.keywords.map(k=><span key={k.id} className={styles.kw}>{k.keyword}{board.canEdit?<button type="button" aria-label={`ลบคำค้น ${k.keyword}`} disabled={busy===`kd:${k.id}`} onClick={()=>act(`kd:${k.id}`,{action:'keyword-remove',keyword_id:k.id},`ลบคำค้น “${k.keyword}” แล้ว`)}>×</button>:null}</span>)}
      {board.canEdit?<form className={styles.addKw} onSubmit={event=>{event.preventDefault();addKeyword(unit);}}>
        <label className={styles.srOnly} htmlFor={`kw-${unit.id}`}>เพิ่มคำค้นให้ {unit.name}</label>
        <input id={`kw-${unit.id}`} type="text" enterKeyHint="done" title="พิมพ์คำแล้วกด Enter" value={draft[unit.id]??''} maxLength={60} placeholder="+ คำค้น" onChange={event=>setDraft(value=>({...value,[unit.id]:event.target.value}))}/>
      </form>:null}</div>
    {unit.pages.length?<div className={styles.tableWrap}><table className={styles.table}>
      <thead><tr><th>เพจ</th><th className={styles.r}>แอดใหม่ 7 วัน</th><th className={styles.r}>กำลังแสดง</th><th className={styles.r}>ยิงนานสุด</th>{board.canEdit?<><th>เพจนี้คือ</th><th><span className={styles.srOnly}>เก็บแอดใหม่</span></th></>:<th>สถานะ</th>}</tr></thead>
      <tbody>{unit.pages.map(page=>row(unit,page))}</tbody>
    </table></div>:<p className={styles.empty}>ยังไม่พบเพจที่ตรงคำค้นของยูนิตนี้ในข้อมูลที่เก็บไว้ · ลองเพิ่มคำค้นที่ลูกค้าใช้</p>}
    {unit.hidden?<p className={styles.hidden}>ซ่อนไว้ {n(unit.hidden)} เพจที่ทีมตั้งว่าไม่เกี่ยวกับ {unit.name} · เปิดดูได้จากหน้าเพจคู่แข่ง</p>:null}
  </section>;

  return <div className={styles.layout} data-testid="rival-board">
    <UnitRail units={rail} unassigned={null} fallingTotal={null} active={unitId} onPick={pick}/>
    <div className={styles.stack}>
      {notice?<p className={styles.notice} role="status">{notice}</p>:null}
      {bare?<section className={styles.panel}><div className={styles.start}><h2>ใส่คำค้นให้ {bare.name}</h2>
        <p>ใส่คำที่ลูกค้าใช้หาสินค้าของยูนิตนี้ 3–5 คำ ระบบจะหาเพจคู่แข่งจากแอดที่เก็บไว้ แล้วให้ทีมตรวจว่าเป็นคู่แข่งจริงไหม</p>
        <form className={styles.firstKw} onSubmit={event=>{event.preventDefault();addKeyword(bare);}}>
          <input aria-label={`คำค้นแรกของ ${bare.name}`} value={draft[bare.id]??''} maxLength={60} placeholder="เช่น ผงผัก, ดีท็อกซ์, ไขมันในเลือด" onChange={event=>setDraft(value=>({...value,[bare.id]:event.target.value}))}/>
          <button type="submit" disabled={(draft[bare.id]??'').trim().length<2||busy===`kw:${bare.id}`}>เพิ่มคำค้น</button>
        </form></div></section>
      :!board.units.length?<section className={styles.panel}><div className={styles.start}><h2>เริ่มจากใส่คำค้นให้ยูนิต</h2><p>เลือกยูนิตในแถบซ้าย แล้วใส่คำที่ลูกค้าใช้หาสินค้า 3–5 คำ · ระบบจะหาเพจคู่แข่งจากแอดที่เก็บไว้</p></div></section>
      :<>
        {strip('new',`🆕 แอดใหม่ของคู่แข่ง${fresh.data?` · ${n(fresh.data.total)} แอดใน 7 วัน`:''}`,`แอดที่ระบบเห็นครั้งแรกใน 7 วัน จากเพจคู่แข่งของ ${scopeName} · ใหม่สำหรับเรา อาจยิงมาก่อนแล้ว · เก็บล่าสุด ${thaiDate(board.lastCollectedAt)}`,fresh)}
        {strip('age','🔥 ยิงนานที่สุด',`แอดที่ยังแสดงอยู่และยิงมานานที่สุดจากเพจคู่แข่งของ ${scopeName} · ใช้หาไอเดียทำแอด`,long)}
        {scope.map(pagesTable)}
      </>}
      <p className={styles.foot}>Ads Library ไม่มีข้อมูลค่าแอดของคู่แข่ง และไม่มียอดขาย · “ใหม่” คือระบบเพิ่งเห็นครั้งแรก · เพจไม่เท่ากับแบรนด์ · ระบบเก็บแอดใหม่อยู่ {n(board.tracked)} เพจ</p>
    </div>
    {selected?<AdDrawer adArchiveId={selected.ad_archive_id} datasetId={selected.dataset_id} onClose={()=>setSelected(null)} compareHref={board.canEdit?`/compare/ads?${new URLSearchParams({dataset:selected.dataset_id,rival:selected.ad_archive_id,returnTo:'/competitors'})}`:undefined}/>:null}
  </div>;
}
