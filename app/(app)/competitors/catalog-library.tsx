'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useSearchParams} from 'next/navigation';
import {AdCard} from '@/components/AdCard';
import {AdDrawer} from '@/components/AdDrawer';
import type {CatalogAdRow} from '@/lib/read/catalog';
import {activeFilter,filterValue,pageOffset} from '@/lib/read/request';
import styles from './competitors.module.css';
export function CatalogLibrary({canAnalyze}:{canAnalyze:boolean}){
 const navigation=useSearchParams(),status=activeFilter(navigation.get('active'));
 const query=filterValue(navigation.get('search'),160)??'',period=navigation.get('period')==='week'?'week':'';
 const active=status.ok?status.value??'':'',offset=pageOffset(navigation.get('offset'));
 const [result,setResult]=useState<{key:string;rows:CatalogAdRow[];total:number;lastCollectedAt:string|null}|null>(null);
 const [error,setError]=useState(''),[refresh,setRefresh]=useState(0),[selected,setSelected]=useState<CatalogAdRow|null>(null);
 const params=new URLSearchParams({search:query,limit:'24',offset:String(offset)});
 if(period)params.set('period',period);if(active)params.set('active',active);
 const request=params.toString(),loading=result?.key!==request;
 const returnParams=new URLSearchParams(params);returnParams.delete('limit');
 if(!query)returnParams.delete('search');if(!offset)returnParams.delete('offset');
 const returnTo='/competitors'+(returnParams.size?'?'+returnParams.toString():'');
 function browse(changes:Record<string,string>){
  const location=new URL(window.location.href);
  for(const [key,value]of Object.entries(changes)){
   if(value)location.searchParams.set(key,value);else location.searchParams.delete(key);
  }
  window.history.replaceState(null,'',location.pathname+location.search);
 }
 useEffect(()=>{
  const controller=new AbortController();
  const location=new URL(window.location.href);
  for(const [key,value]of Object.entries({search:query,period,active,offset:offset?String(offset):''})){
   if(value)location.searchParams.set(key,value);else location.searchParams.delete(key);
  }
  if(location.search!==window.location.search)window.history.replaceState(null,'',location.pathname+location.search);
  fetch('/api/catalog/ads?'+request,{signal:controller.signal,cache:'no-store'}).then(async response=>{
   const body=await response.json();if(!response.ok)throw new Error(body.error??'เปิดคลังคู่แข่งไม่ได้');
   if(!controller.signal.aborted){setResult({key:request,...body});setError('');}
  }).catch(problem=>{if(!controller.signal.aborted)setError(problem.message);});
  return ()=>controller.abort();
 },[request,refresh,query,period,active,offset]);
 return <section className={styles.catalog}>
  <form className={styles.searchBar} onSubmit={event=>{event.preventDefault();browse({search:String(new FormData(event.currentTarget).get('search')??'').trim(),offset:''});}}>
   <label>ค้นหาในคลังคู่แข่ง<input key={query} name="search" type="search" data-testid="catalog-search" maxLength={160} placeholder="ชื่อสินค้า ข้อเสนอ ข้อความ หรือเพจ…" defaultValue={query}/></label><button type="submit">ค้นหาแอด</button>
   <label>ช่วงที่พบ<select aria-label="ช่วงที่พบ" value={period} onChange={event=>browse({period:event.target.value,offset:''})}><option value="">ทั้งหมด</option><option value="week">เพิ่งพบใน 7 วัน</option></select></label>
   <label>สถานะ<select aria-label="สถานะแอดคู่แข่ง" value={active} onChange={event=>browse({active:event.target.value,offset:''})}><option value="">ทุกสถานะ</option><option value="active">พบว่ากำลังแสดง</option><option value="inactive">พบว่าหยุดแล้ว</option><option value="unknown">ไม่ทราบ</option></select></label>
  </form>
  <p className={styles.freeSearch}>ค้นจากข้อมูลที่เก็บไว้ ไม่มีค่าดึงข้อมูลเพิ่ม</p>
  {error?<p role="alert">{error} <button onClick={()=>setRefresh(value=>value+1)}>ลองอีกครั้ง</button></p>:null}
  <div className={styles.catalogHead}><h2>{period==='week'?'แอดที่เราเพิ่งพบใน 7 วัน':'คลังแอดคู่แข่งทั้งหมด'}</h2><span data-testid="catalog-count">{result&&!loading?`พบ ${result.total.toLocaleString('th-TH')} แอด${result.rows.length?` · แสดง ${(offset+1).toLocaleString('th-TH')}–${(offset+result.rows.length).toLocaleString('th-TH')}`:''} · หน้า ${Math.floor(offset/24)+1}`:'กำลังเปิดข้อมูล…'}</span></div>
  {loading&&!error?<p role="status">กำลังค้นแอดในคลัง…</p>:null}
  <div className={styles.catalogGrid} data-testid="catalog-grid">{!loading&&result?.rows.map(ad=><AdCard key={ad.ad_archive_id} ad={ad} onOpen={()=>setSelected(ad)}/>)}</div>
  {!loading&&result?.total===0?<p>ยังไม่มีแอดที่ตรงกับตัวกรอง <button onClick={()=>browse({search:'',active:'',period:'',offset:''})}>ดูทั้งคลัง</button>{canAnalyze?<Link href="/collect"> ค้นและเก็บแอดเพิ่ม →</Link>:null}</p>:null}
  {!loading&&result&&result.total>0&&result.rows.length===0?<p>หน้านี้ไม่มีแอด <button onClick={()=>browse({offset:''})}>กลับหน้าแรก</button></p>:null}
  <div className={styles.pager}><button disabled={loading||offset===0} onClick={()=>browse({offset:String(Math.max(0,offset-24))})}>ก่อนหน้า</button><button disabled={loading||!result||offset+24>=result.total} onClick={()=>browse({offset:String(offset+24)})}>ถัดไป</button></div>
  <p className={styles.freeSearch}>สถานะตามครั้งที่เก็บไว้ · “เพิ่งพบ” คือวันที่ระบบพบครั้งแรก · เก็บล่าสุด {result?.lastCollectedAt?new Date(result.lastCollectedAt).toLocaleDateString('th-TH'):'—'}</p>
  {selected?<AdDrawer adArchiveId={selected.ad_archive_id} datasetId={selected.dataset_id} onClose={()=>setSelected(null)} compareHref={canAnalyze?`/compare/ads?${new URLSearchParams({dataset:selected.dataset_id,rival:selected.ad_archive_id,returnTo})}`:undefined}/>:null}
 </section>;
}
