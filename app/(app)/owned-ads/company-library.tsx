"use client";
import { useEffect, useRef, useState } from "react";
import Link from 'next/link';
import { useSearchParams } from "next/navigation";
import type { CompanyAd } from "@/lib/owned-ads/source-rows";
import { PageHeader } from "@/components/shell/PageHeader";
import { AdStatus, OwnedCard } from "./owned-client";
import { OwnedVideoPlayer } from "./owned-video-player";
import { summarizeOwnedReport } from "@/lib/owned-ads/model";
import { OWNED_LIBRARY_STATUSES, parseOwnedLibraryQuery, type OwnedLibraryFilters } from "@/lib/owned-ads/library-query";
import styles from "./owned-ads.module.css";

type Sync = {
  id:string; status:"running"|"completed"|"failed"; started_at:string; finished_at:string|null;
  source_snapshot_at:string|null; date_start:string|null; date_end:string|null;
  accounts:{id:string;name:string;currency:string}[]; ad_count:number; completed_accounts:number; error:string|null;
};
type Result = {snapshot:Sync|null;progress:Sync|null;rows:CompanyAd[];total:number;pageSize:number};
export function CompanyLibrary({ initialFilters }: { initialFilters: OwnedLibraryFilters }) {
  const params=useSearchParams();
  const [initial]=useState(()=>params?parseOwnedLibraryQuery(new URLSearchParams(params.toString())):initialFilters);
  const [search,setSearch]=useState(initial.search); const [querySearch,setQuerySearch]=useState(initial.search); const [account,setAccount]=useState(initial.account);
  const [status,setStatus]=useState(initial.status); const [page,setPage]=useState(initial.page);
  const [hasSpend,setHasSpend]=useState(initial.hasSpend);
  const [refresh,setRefresh]=useState(0); const [watching,setWatching]=useState(false);
  const [result,setResult]=useState<{key:string;data:Result}|null>(null);
  const [error,setError]=useState<string|null>(null); const [selected,setSelected]=useState<CompanyAd|null>(null);
  const [media,setMedia]=useState<Record<string,string|null>>({});
  const [videoIds,setVideoIds]=useState<Record<string,string|null>>({});
  const [mediaError,setMediaError]=useState(false);
  const rows=result?.data.rows;
  useEffect(()=>{
    if(!rows?.length)return;
    let ignore=false;
    async function load(){for(let offset=0;offset<rows!.length&&!ignore;offset+=4){
    const batch=rows!.slice(offset,offset+4).map(({account_id,ad_id})=>({account_id,ad_id}));
    const unavailable=Object.fromEntries(batch.map(({account_id,ad_id})=>[`${account_id}:${ad_id}`,null]));
    await fetch('/api/owned-ads/media',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:batch})})
      .then(async response=>{if(!response.ok)throw new Error("โหลดภาพไม่ได้");const body=await response.json();if(!ignore){setMediaError(false);setMedia(previous=>({...previous,...unavailable,...Object.fromEntries(body.items.map((x:{account_id:string;ad_id:string;url:string|null})=>[`${x.account_id}:${x.ad_id}`,x.url]))}));setVideoIds(previous=>({...previous,...Object.fromEntries(body.items.map((x:{account_id:string;ad_id:string;video_id?:string|null})=>[`${x.account_id}:${x.ad_id}`,x.video_id??null]))}));}})
      .catch(()=>{if(!ignore){setMediaError(true);setMedia(previous=>({...unavailable,...previous}));}});
    }}
    void load();
    return ()=>{ignore=true;};
  },[rows]);
  const requestedAt=useRef(0);
  useEffect(()=>{
    const timer=setTimeout(()=>setQuerySearch(search),300);
    return ()=>clearTimeout(timer);
  },[search]);
  const query=new URLSearchParams({q:querySearch,account,status,spend:hasSpend?'reported':'all',page:String(page)}).toString();
  const returnTo=`/owned-ads?${query}`;
  const key=query; const loading=result?.key!==key;
  const running=result?.data.progress?.status==="running";
  useEffect(()=>{
    const restore=()=>{
      const filters=parseOwnedLibraryQuery(new URLSearchParams(window.location.search));
      setSearch(filters.search);setQuerySearch(filters.search);setAccount(filters.account);setStatus(filters.status);setPage(filters.page);setHasSpend(filters.hasSpend);
    };
    window.addEventListener("popstate",restore);
    return ()=>window.removeEventListener("popstate",restore);
  },[]);
  useEffect(()=>{
    if(returnTo!==window.location.pathname+window.location.search)window.history.replaceState(null,"",returnTo+window.location.hash);
  },[returnTo]);
  useEffect(()=>{
    let ignore=false; const controller=new AbortController();
    fetch(`/api/owned-ads/library?${query}`,{cache:"no-store",signal:controller.signal})
      .then(async response=>{
        const data=await response.json();if(!response.ok)throw new Error(data.error ?? "เปิดข้อมูลไม่ได้");
        if(!ignore){
          const lastPage=Math.max(0,Math.ceil(data.total/24)-1);
          if(page>lastPage){setPage(lastPage);return;}
          setResult({key,data});setError(null);
          if(data.progress?.status!=="running" && (requestedAt.current===0 || Date.parse(data.progress?.started_at ?? "")>=requestedAt.current))setWatching(false);
        }
      }).catch(problem=>{if(!ignore){setError(problem.message);setWatching(false);}});
    return ()=>{ignore=true;controller.abort();};
  },[query,key,refresh,page]);
  useEffect(()=>{
    if(!watching && !running)return;
    const controller=new AbortController();let pending=false;
    const timer=setInterval(async ()=>{
      if(pending)return;pending=true;
      try {
        const response=await fetch("/api/owned-ads/library?progress=1",{cache:"no-store",signal:controller.signal});
        if(!response.ok)throw new Error("ตรวจสถานะซิงค์ไม่สำเร็จ");
        const data=await response.json();
        setResult(previous=>previous?{...previous,data:{...previous.data,progress:data.progress}}:previous);
        if(data.progress?.status!=="running" && (requestedAt.current===0 || Date.parse(data.progress?.started_at ?? "")>=requestedAt.current)){
          setWatching(false);setRefresh(value=>value+1);
        }
      }catch(problem){if(!controller.signal.aborted)setError((problem as Error).message);}
      finally{pending=false;}
    },5000);
    return ()=>{controller.abort();clearInterval(timer);};
  },[watching,running]);
  async function sync() {
    setWatching(true);setError(null);requestedAt.current=Date.now()-1000;
    try {
      const response=await fetch("/api/owned-ads/sync",{method:"POST"});const body=await response.json();
      if(!response.ok)throw new Error(body.error ?? "เริ่มซิงค์ไม่สำเร็จ");
      if(body.reused)requestedAt.current=0;
      setRefresh(value=>value+1);
    }catch(problem){setWatching(false);setError((problem as Error).message);}
  }
  const snapshot=result?.data.snapshot; const progress=result?.data.progress; const total=result?.data.total ?? 0;
  const displayDate=(value:string|null|undefined)=>value?new Date(value).toLocaleString("th-TH"):"—";
  return <>
    <PageHeader title="แอดของเรา" description="ค้นหาสินค้าหรือเพจ แล้วเลือกแอดที่ต้องการเทียบกับคู่แข่ง"
      actions={<button type="button" data-testid="company-sync" onClick={()=>void sync()} disabled={watching||running}>อัปเดตข้อมูล</button>} />
    {error?<p role="alert">{error} <button type="button" onClick={()=>setRefresh(value=>value+1)}>ลองเปิดใหม่</button></p>:null}
    <div className={styles.connection} data-testid="company-source">
      {snapshot?<>จาก Ads Management · {snapshot.ad_count.toLocaleString("th-TH")} แอด · ผลลัพธ์ช่วง {snapshot.date_start} — {snapshot.date_end}</>:"ยังไม่มีข้อมูล กดอัปเดตข้อมูลเพื่อเริ่ม"}
    </div>
    {watching||running?<p role="status" data-testid="company-sync-progress">กำลังซิงค์ {progress?.status==="running"?`${progress.completed_accounts} / ${progress.accounts.length} บัญชี · ${(progress.ad_count ?? 0).toLocaleString("th-TH")} แอด`:"เตรียมเชื่อมต่อ…"} · ใช้งานชุดข้อมูลก่อนหน้าได้ระหว่างรอ</p>:null}
    {progress?.status==="failed"?<p role="alert">{progress.error}</p>:null}
    <div className={styles.filterBar}>
    <label className={styles.spendFilter}><input type="checkbox" checked={hasSpend} onChange={event=>{setHasSpend(event.target.checked);setPage(0);}}/>มีค่าแอดในช่วงผลลัพธ์ · ปิดเพื่อดูแอดทั้งคลัง</label>
    <div className={styles.librarySearch}>
      <label className={styles.label}>ค้นหาแอดของเรา<input type="search" data-testid="company-search" maxLength={160} value={search} placeholder="พิมพ์ชื่อสินค้า เพจ หรือแคมเปญ เช่น กาแฟ" onChange={e=>{setSearch(e.target.value);setPage(0);}} /></label>
      {(search||account||status)?<button type="button" onClick={()=>{setSearch("");setAccount("");setStatus("");setPage(0);}}>ล้างตัวกรอง</button>:null}
    </div>
    <details className={styles.filters} data-testid="company-advanced">
      <summary>ตัวกรองเพิ่มเติม{account||status?" · กำลังใช้งาน":""}</summary>
      <div className={styles.toolbar}>
      <label className={styles.label}>บัญชี<select data-testid="company-account" value={account} onChange={e=>{setAccount(e.target.value);setPage(0);}}><option value="">ทุกบัญชี</option>{snapshot?.accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></label>
      <label className={styles.label}>สถานะ<select data-testid="company-status" value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="">ทุกสถานะ</option>{OWNED_LIBRARY_STATUSES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {snapshot?<p className={styles.basis}>{snapshot.accounts.length} บัญชี · อัปเดต {displayDate(snapshot.finished_at)} · ข้อมูลต้นทาง {displayDate(snapshot.source_snapshot_at)}<br/>แอดที่ไม่มีผลลัพธ์ในช่วงนี้แสดง “—” · สกุลเงินตามบัญชีต้นทาง</p>:null}
    </details>
    </div>
    {loading&&!error?<p role="status">กำลังเปิดข้อมูล…</p>:null}
    <div className={styles.resultHead}><h2>สื่อโฆษณา</h2><p className={styles.resultCount} data-testid="company-count">พบ {total.toLocaleString("th-TH")} แอด · หน้า {page+1} / {Math.max(1,Math.ceil(total/24)).toLocaleString("th-TH")}</p></div>
    {mediaError?<p role="status">ยังโหลดภาพความละเอียดสูงไม่ได้ กำลังแสดงภาพย่อจากต้นทาง</p>:null}
    <div className={styles.grid} data-testid="company-grid">{!loading&&result?.data.rows.map(ad=><OwnedCard key={`${ad.account_id}:${ad.ad_id}`} ad={{...ad,creative_url:media[`${ad.account_id}:${ad.ad_id}`]??ad.creative_url}} isVideo={Boolean(videoIds[`${ad.account_id}:${ad.ad_id}`]??ad.video_id)} mediaLoading={!Object.hasOwn(media,`${ad.account_id}:${ad.ad_id}`)} currency={ad.currency} contextLabel={ad.page_name??ad.account_name} onOpen={()=>setSelected(ad)} compareHref={`/compare/ads?${new URLSearchParams({account:ad.account_id,owned:ad.ad_id,returnTo})}`} />)}</div>
    {!loading&&snapshot&&total===0?<p>ไม่พบแอดที่ตรงกับตัวกรอง</p>:null}
    <div className={styles.pager}>
      <button type="button" data-testid="company-prev" disabled={page===0||loading} onClick={()=>setPage(p=>p-1)}>ก่อนหน้า</button>
      <button type="button" data-testid="company-next" disabled={(page+1)*24>=total||loading} onClick={()=>setPage(p=>p+1)}>ถัดไป</button>
    </div>
    {selected?<CompanyDetail ad={{...selected,video_id:videoIds[`${selected.account_id}:${selected.ad_id}`]??selected.video_id}} creativeUrl={media[`${selected.account_id}:${selected.ad_id}`]??selected.creative_url} mediaLoading={!Object.hasOwn(media,`${selected.account_id}:${selected.ad_id}`)} period={snapshot??null} returnTo={returnTo} onClose={()=>setSelected(null)}/>:null}
  </>;
}

export function CompanyDetail({ad,creativeUrl,mediaLoading,period,onClose,returnTo="/owned-ads"}:{ad:CompanyAd;creativeUrl:string|null;mediaLoading:boolean;period:{date_start:string|null;date_end:string|null}|null;onClose:()=>void;returnTo?:string}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current;const opener=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';element?.showModal();
    return ()=>{element?.close();document.body.style.overflow=overflow;if(opener?.isConnected)opener.focus({preventScroll:true});};
  },[]);
  const metrics=summarizeOwnedReport([ad]);
  const number=(value:number|null|undefined)=>value==null?'—':value.toLocaleString('th-TH',{maximumFractionDigits:2});
  return <dialog ref={dialog} className={styles.drawer} aria-labelledby="company-detail-title" data-testid="company-detail" onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className={styles.drawerInner}>
      <header className={styles.drawerHead}><div><h2 id="company-detail-title">{ad.ad_name}</h2><p>{ad.page_name??ad.account_name} · แอดของเรา</p></div><button type="button" autoFocus onClick={onClose}>ปิดรายละเอียด</button></header>
      <div className={styles.detailLayout}>
        <div className={styles.detailMedia}><OwnedVideoPlayer key={`${ad.account_id}:${ad.ad_id}`} ad={ad} url={creativeUrl} mediaLoading={mediaLoading} autoLoad /></div>
        <div className={styles.detailInfo}>
          <AdStatus status={ad.status}/><h3>{ad.title??ad.ad_name}</h3><p className={styles.detailCopy}>{ad.body_text??'ต้นทางไม่มีข้อความครีเอทีฟ'}</p>
          <h3>ผลลัพธ์จาก Meta</h3><p>{period?`${period.date_start??'—'} — ${period.date_end??'—'}`:'ตามช่วงวันที่ของชุดข้อมูล'}</p>
          <dl className={styles.facts}>
            <div><dt>ค่าโฆษณา ({ad.currency})</dt><dd>{number(ad.spend)}</dd></div>
            <div><dt>ROAS (Meta)</dt><dd>{number(metrics.roas.value)}</dd></div>
            <div><dt>บทสนทนา</dt><dd>{number(ad.conversations)}</dd></div>
            <div><dt>ต้นทุน/บทสนทนา ({ad.currency})</dt><dd>{number(metrics.cost_per_conversation.value)}</dd></div>
            <div><dt>การซื้อ (Meta)</dt><dd>{number(ad.purchases)}</dd></div>
            <div><dt>มูลค่าซื้อ ({ad.currency})</dt><dd>{number(ad.purchase_value)}</dd></div>
          </dl>
          <details><summary>ข้อมูลต้นทาง</summary><p>{ad.account_name} · Ad {ad.ad_id}</p><p>Impressions {number(ad.impressions)} · มูลค่าซื้อเป็นการระบุที่มาจาก Meta</p></details>
        </div>
      </div>
      <footer className={styles.detailFooter}><Link className={styles.cardCompare} href={`/compare/ads?${new URLSearchParams({account:ad.account_id,owned:ad.ad_id,returnTo})}`}>เทียบแอดนี้กับคู่แข่ง →</Link></footer>
    </div>
  </dialog>;
}
