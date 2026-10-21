'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {AdCard} from '@/components/AdCard';
import {AdDrawer} from '@/components/AdDrawer';
import {PageHeader} from '@/components/shell/PageHeader';
import {Icon} from '@/components/shell/icons';
import type {CatalogAdRow} from '@/lib/read/catalog';
import {activeFilter,filterValue,pageOffset} from '@/lib/read/request';
import {useCollectLauncher} from '../collect/collect-launcher';
import styles from './catalog-library.module.css';

const SORTS=[['','ล่าสุดที่เก็บ'],['new','เพิ่งพบ'],['age','ยิงนานที่สุด']] as const;
// The formats the collected ads actually carry (display_format), most common first.
const FORMATS=[['','ทุกรูปแบบ'],['VIDEO','วิดีโอ'],['IMAGE','ภาพ'],['MULTI_IMAGES','หลายภาพ'],['DPA','แคตตาล็อกสินค้า (DPA)'],['DCO','ครีเอทีฟผสม (DCO)'],['CAROUSEL','ภาพสไลด์']] as const;
const PAGE=24;

// ponytail: groups repeats within the 24 rows on screen (same page + same copy); a library-wide grouped query is the upgrade if repeats span pages.
const copyKey=(ad:CatalogAdRow)=>`${ad.page_id}|${(ad.title||'').trim()}|${(ad.body_text||'').replace(/\s+/g,' ').trim().slice(0,240)}`;
function groupRepeats(rows:CatalogAdRow[]){
 const groups=new Map<string,CatalogAdRow[]>();
 for(const ad of rows){const key=(ad.title||ad.body_text)?copyKey(ad):ad.ad_archive_id;groups.set(key,[...(groups.get(key)??[]),ad]);}
 return [...groups.values()];
}

// The inspector docks beside the grid on wide screens; narrower, the same details open over the grid.
const WIDE='(min-width: 1100px)';
const subscribe=(change:()=>void)=>{const query=window.matchMedia(WIDE);query.addEventListener('change',change);return ()=>query.removeEventListener('change',change);};
const useWide=()=>useSyncExternalStore(subscribe,()=>window.matchMedia(WIDE).matches,()=>false);
const stamp=(value:string|null|undefined)=>value?new Date(value).toLocaleString('th-TH',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}):'—';

/**
 * ส่องแอด (UI v3): the rival ad library as a Finder gallery with an inspector.
 * Every filter is a stored field the catalog read already supports; the keyword chips only fill the search.
 */
export function CatalogLibrary({canAnalyze,keywords,datasets}:{canAnalyze:boolean;keywords:string[];datasets:{id:string;label:string}[]}){
 const navigation=useSearchParams(),status=activeFilter(navigation.get('active'));
 const query=filterValue(navigation.get('search'),160)??'',period=navigation.get('period')==='week'?'week':'';
 const active=status.ok?status.value??'':'',offset=pageOffset(navigation.get('offset'));
 const format=FORMATS.some(([value])=>value===navigation.get('format'))?navigation.get('format')!:'';
 const sort=SORTS.some(([value])=>value===navigation.get('sort'))?navigation.get('sort')!:'';
 const [result,setResult]=useState<{key:string;rows:CatalogAdRow[];total:number;lastCollectedAt:string|null}|null>(null);
 const [error,setError]=useState(''),[refresh,setRefresh]=useState(0),[picked,setPicked]=useState<CatalogAdRow|null>(null);
 const wide=useWide();
 // Ads collected from the side panel show up here without a reload.
 const collected=useCollectLauncher()?.version??0;
 const params=new URLSearchParams({search:query,limit:String(PAGE),offset:String(offset)});
 if(period)params.set('period',period);if(active)params.set('active',active);if(format)params.set('format',format);if(sort)params.set('sort',sort);
 const request=params.toString(),loading=result?.key!==request;
 const returnParams=new URLSearchParams(params);returnParams.delete('limit');returnParams.set('view','all');
 if(!query)returnParams.delete('search');if(!offset)returnParams.delete('offset');
 const returnTo='/competitors?'+returnParams.toString();
 const rows=!loading&&result?result.rows:[];
 const groups=groupRepeats(rows);
 // On a wide screen the inspector always shows something: the reader's pick, else the first ad on the page.
 const selected=picked&&rows.some(ad=>ad.ad_archive_id===picked.ad_archive_id&&ad.dataset_id===picked.dataset_id)?picked:wide?groups[0]?.[0]??null:null;
 const compareHref=(ad:CatalogAdRow)=>canAnalyze?`/compare/ads?${new URLSearchParams({dataset:ad.dataset_id,rival:ad.ad_archive_id,returnTo})}`:undefined;

 function browse(changes:Record<string,string>){
  const location=new URL(window.location.href);
  for(const [key,value]of Object.entries(changes)){
   if(value)location.searchParams.set(key,value);else location.searchParams.delete(key);
  }
  location.searchParams.set('view','all');
  window.history.replaceState(null,'',location.pathname+location.search);
  setPicked(null);
 }
 useEffect(()=>{
  const controller=new AbortController();
  const location=new URL(window.location.href);
  for(const [key,value]of Object.entries({search:query,period,active,format,sort,offset:offset?String(offset):''})){
   if(value)location.searchParams.set(key,value);else location.searchParams.delete(key);
  }
  if(location.search!==window.location.search)window.history.replaceState(null,'',location.pathname+location.search);
  fetch('/api/catalog/ads?'+request,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   const body=await response.json();if(!response.ok)throw new Error(body.error??'เปิดคลังคู่แข่งไม่ได้');
   if(!controller.signal.aborted){setResult({key:request,...body});setError('');}
  }).catch(problem=>{if(!controller.signal.aborted)setError(problem.message);});
  return ()=>controller.abort();
 },[request,refresh,collected,query,period,active,format,sort,offset]);

 const tools=<div className={styles.tools}>
  <form className={styles.search} role="search" onSubmit={event=>{event.preventDefault();browse({search:String(new FormData(event.currentTarget).get('search')??'').trim(),offset:''});}}>
   <Icon name="search" size={15}/>
   <input key={query} name="search" type="search" data-testid="catalog-search" maxLength={160} placeholder="ชื่อสินค้า ข้อเสนอ ข้อความ หรือเพจ" aria-label="ค้นแอดคู่แข่ง" defaultValue={query}/>
   {query?<button type="button" className={styles.clearSearch} aria-label="ล้างคำค้น" onClick={()=>browse({search:'',offset:''})}>×</button>:null}
  </form>
  <label className={styles.popup}><span>เรียง</span><select aria-label="เรียงแอด" value={sort} onChange={event=>browse({sort:event.target.value,offset:''})}>{SORTS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
 </div>;

 return <div className={styles.page} data-testid="catalog-library">
  <PageHeader title="ส่องแอด" description={`แอดคู่แข่งจาก Meta Ad Library · เก็บล่าสุด ${stamp(result?.lastCollectedAt)}`} actions={tools}/>
  <div className={styles.scope} role="toolbar" aria-label="ตัวกรองแอดคู่แข่ง">
   {keywords.length?<div className={styles.chips}><span className={styles.scopeLabel}>ใส่คำค้นของยูนิต</span>{keywords.map(word=>word===query
    ?<button key={word} type="button" className={styles.chip} disabled title="อยู่ในช่องค้นหาแล้ว">✓ {word}</button>
    :<button key={word} type="button" className={styles.chip} onClick={()=>browse({search:word,offset:''})}>+ {word}</button>)}</div>:null}
   <div className={styles.popups}>
    <label className={styles.popup}><span>สถานะ</span><select aria-label="สถานะแอดคู่แข่ง" value={active} onChange={event=>browse({active:event.target.value,offset:''})}><option value="">ทุกสถานะ</option><option value="active">กำลังแสดง</option><option value="inactive">หยุดแล้ว</option><option value="unknown">ไม่ทราบ</option></select></label>
    <label className={styles.popup}><span>ช่วงที่พบ</span><select aria-label="ช่วงที่พบ" value={period} onChange={event=>browse({period:event.target.value,offset:''})}><option value="">ทั้งหมด</option><option value="week">เพิ่งพบใน 7 วัน</option></select></label>
    <label className={styles.popup}><span>รูปแบบ</span><select aria-label="รูปแบบแอด" value={format} onChange={event=>browse({format:event.target.value,offset:''})}>{FORMATS.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    {datasets.length?<form method="get" action="/competitors" className={styles.popup}><span>รอบที่เก็บ</span><select name="dataset" aria-label="รอบที่เก็บ" defaultValue="" onChange={event=>{if(event.currentTarget.value)event.currentTarget.form?.requestSubmit();}}><option value="">ทุกรอบ</option>{datasets.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></form>:null}
   </div>
  </div>

  {error?<p className={styles.problem} role="alert">{error} <button type="button" onClick={()=>setRefresh(value=>value+1)}>ลองอีกครั้ง</button></p>:null}
  <div className={styles.split} data-inspector={wide||undefined}>
   <section className={styles.results} aria-label="แอดคู่แข่ง">
    {loading&&!error?<p className={styles.note} role="status">กำลังค้นแอดในคลัง…</p>:null}
    <div className={styles.grid} data-testid="catalog-grid">{groups.map(group=><div key={group[0].ad_archive_id} className={styles.repeatWrap}>
     <AdCard tile ad={group[0]} selected={selected?.ad_archive_id===group[0].ad_archive_id} onOpen={()=>setPicked(group[0])}/>
     {group.length>1?<span className={styles.repeatBadge} title={`แอดข้อความเดียวกันจากเพจเดียวกัน ${group.length} ตัว: ${group.map(ad=>ad.ad_archive_id).join(', ')}`} data-testid="catalog-repeat">{group.length} เวอร์ชัน</span>:null}
    </div>)}</div>
    {!loading&&result?.total===0?<div className={styles.empty}><p>ยังไม่มีแอดที่ตรงกับตัวกรอง</p><button type="button" onClick={()=>browse({search:'',active:'',period:'',format:'',offset:''})}>ดูทั้งคลัง</button>{canAnalyze?<Link href="/collect">ค้นและเก็บแอดเพิ่ม →</Link>:null}</div>:null}
    {!loading&&result&&result.total>0&&result.rows.length===0?<div className={styles.empty}><p>หน้านี้ไม่มีแอด</p><button type="button" onClick={()=>browse({offset:''})}>กลับหน้าแรก</button></div>:null}
   </section>
   {wide?<div className={styles.inspector}>{selected
    ?<AdDrawer key={`${selected.dataset_id}:${selected.ad_archive_id}`} docked adArchiveId={selected.ad_archive_id} datasetId={selected.dataset_id} onClose={()=>setPicked(null)} compareHref={compareHref(selected)} canAnalyze={canAnalyze}/>
    :<p className={styles.inspectorEmpty}>{loading?'กำลังเปิด…':'เลือกแอดเพื่อดูรายละเอียด'}</p>}</div>:null}
  </div>

  <footer className={styles.status}>
   <span data-testid="catalog-count">{result&&!loading?`${result.total.toLocaleString('th-TH')} แอด${result.rows.length?` · แสดง ${(offset+1).toLocaleString('th-TH')}–${(offset+result.rows.length).toLocaleString('th-TH')}`:''}${groups.length<rows.length?` · รวมข้อความซ้ำเป็น ${groups.length} การ์ด`:''}`:'กำลังเปิดข้อมูล…'}</span>
   <span className={styles.pager}>
    <button type="button" disabled={loading||offset===0} onClick={()=>browse({offset:String(Math.max(0,offset-PAGE))})}>ก่อนหน้า</button>
    <span>หน้า {(Math.floor(offset/PAGE)+1).toLocaleString('th-TH')}{result&&!loading?` / ${Math.max(1,Math.ceil(result.total/PAGE)).toLocaleString('th-TH')}`:''}</span>
    <button type="button" disabled={loading||!result||offset+PAGE>=result.total} onClick={()=>browse({offset:String(offset+PAGE)})}>ถัดไป</button>
   </span>
   <span>สถานะตามครั้งที่เก็บ · “เพิ่งพบ” คือวันที่ระบบพบครั้งแรก · Ad Library ไม่มีข้อมูลงบหรือยอดขายของคู่แข่ง</span>
  </footer>
  {!wide&&selected?<AdDrawer adArchiveId={selected.ad_archive_id} datasetId={selected.dataset_id} onClose={()=>setPicked(null)} compareHref={compareHref(selected)} canAnalyze={canAnalyze}/>:null}
 </div>;
}
