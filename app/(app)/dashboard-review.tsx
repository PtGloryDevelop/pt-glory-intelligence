'use client';
import Link from 'next/link';
import {usePathname,useSearchParams} from 'next/navigation';
import {useEffect,useState} from 'react';
import {Icon} from '@/components/shell/icons';
import {AdThumb} from '@/components/AdThumb';
import {AdDrawer} from '@/components/AdDrawer';
import type {DashboardData} from '@/lib/dashboard/read';
import type {CatalogAdRow} from '@/lib/read/catalog';
import type {OwnedPerformanceRow,OwnedPerformanceSummary} from '@/lib/owned-ads/performance';
import {reviewChange,reviewReturnHref} from '@/lib/dashboard/review-model';
import {reviewCsv} from '@/lib/dashboard/export';
import {DashboardSparkline} from './dashboard-sparkline';
import {AdStatus} from './owned-ads/owned-client';
import {CompanyDetail} from './owned-ads/company-library';
import styles from './dashboard-review.module.css';

const number=(value:number|null|undefined)=>value==null?'—':value.toLocaleString('th-TH',{maximumFractionDigits:2});
const date=(value:string|null|undefined)=>value?new Date(value).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}):'—';
const moment=(value:string|null|undefined)=>value?new Date(value).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
const key=(ad:{account_id:string;ad_id:string})=>`${ad.account_id}:${ad.ad_id}`;
const ranks=[['spend','ค่าแอดสูงสุด'],['roas','ROAS สูงสุด'],['cost_per_conversation','ค่าทักต่ำสุด'],['conversations','ทักมากสุด']] as const;

export function Dashboard({canAnalyze}:{canAnalyze:boolean}){
 const pathname=usePathname(),params=useSearchParams();
 const requestParams=new URLSearchParams();
 for(const field of ['window','period','from','to','sort'])for(const value of params.getAll(field))requestParams.append(field,value);
 const query=requestParams.toString();
 const [result,setResult]=useState<{query:string;data:DashboardData}|null>(null);
 const [problem,setProblem]=useState<{query:string;message:string}|null>(null);
 const [refresh,setRefresh]=useState(0),[refreshing,setRefreshing]=useState(false);
 const [currency,setCurrency]=useState('THB');
 const [images,setImages]=useState<Record<string,string|null>>({});
 const [selected,setSelected]=useState<OwnedPerformanceRow|null>(null);
 const [rival,setRival]=useState<CatalogAdRow|null>(null);
 const data=result?.query===query?result.data:null,error=problem?.query===query?problem.message:null;
 const loading=refreshing||(!data&&!error);
 function reload(){setRefreshing(true);setRefresh(value=>value+1);}
 function change(field:'window'|'sort',value:string){
  const next=new URLSearchParams(params);next.set('dashboard','1');next.set(field,value);
  if(field==='window')for(const item of ['period','from','to'])next.delete(item);
  setSelected(null);setRival(null);
  window.history.replaceState(null,'',`${pathname}?${next}`);
 }
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/dashboard'+(query?`?${query}`:''),{signal:controller.signal,cache:'no-store'}).then(async response=>{
   const body=await response.json();if(!response.ok)throw new Error(body.error??'เปิดภาพรวมไม่ได้');
   if(!controller.signal.aborted){setResult({query,data:body});setProblem(null);}
  }).catch(problem=>{if(!controller.signal.aborted)setProblem({query,message:problem.message});}).finally(()=>{if(!controller.signal.aborted)setRefreshing(false);});
  return ()=>controller.abort();
 },[query,refresh]);
 useEffect(()=>{
  if(!selected||selected.creative_url||Object.hasOwn(images,key(selected)))return;
  const controller=new AbortController();
  fetch('/api/owned-ads/media',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({items:[{account_id:selected.account_id,ad_id:selected.ad_id}]})}).then(async response=>{
   if(!response.ok)throw new Error();const result=await response.json();
   if(!controller.signal.aborted)setImages(previous=>({...previous,...Object.fromEntries(result.items.map((item:{account_id:string;ad_id:string;url:string|null})=>[key(item),item.url]))}));
  }).catch(()=>{if(!controller.signal.aborted)setImages(previous=>({...previous,[key(selected)]:null}));});
  return ()=>controller.abort();
 },[selected,images]);
 const review=data?.review;
 const group=review?.summary.find(item=>item.currency===currency)??review?.summary[0];
 const previous=review?.previous?.summary.find(item=>item.currency===group?.currency);
 const rows=review?.rows.filter(ad=>ad.currency===group?.currency).slice(0,6)??[];
 const returnTo=review&&data?reviewReturnHref(review,data.reviewOptions):pathname;
 const compareHref=(ad:{account_id:string;ad_id:string})=>'/compare/ads?'+new URLSearchParams({account:ad.account_id,owned:ad.ad_id,returnTo});
 const rivalHref=(ad:CatalogAdRow)=>'/compare/ads?'+new URLSearchParams({dataset:ad.dataset_id??'',rival:ad.ad_archive_id,returnTo});
 const libraryHref=review?'/owned-ads/performance?'+new URLSearchParams({period:'custom',from:review.period.from,to:review.period.to,sort:data!.reviewOptions.sort}):'/owned-ads/performance';
 function exportVisible(){if(!review)return;const url=URL.createObjectURL(new Blob([reviewCsv(rows,review.period)],{type:'text/csv;charset=utf-8'}));const anchor=document.createElement('a');anchor.href=url;anchor.download=`pt-glory-${review.period.from}-${review.period.to}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const periodControls=canAnalyze&&data?<div className={styles.periodControls}><label>ช่วงข้อมูล<select aria-label="ช่วงข้อมูลภาพรวม" value={data.reviewOptions.period?'selected':data.reviewOptions.window} onChange={event=>change('window',event.target.value)}>{data.reviewOptions.period?<option value="selected">ช่วงวันที่เดิมที่นำไปเทียบ</option>:null}{[7,14,30].map(days=><option value={days} key={days}>{days} วันล่าสุดที่มีข้อมูล</option>)}</select></label>{(review?.summary.length??0)>1?<label>สกุลเงิน<select aria-label="สกุลเงินสรุป" value={group?.currency??''} onChange={event=>{setCurrency(event.target.value);setSelected(null);}}>{review!.summary.map(item=><option key={item.currency}>{item.currency}</option>)}</select></label>:null}</div>:null;
 return <div className={styles.page} data-testid="dashboard">
  <header className={styles.header}><div><h1>วันนี้เราควรตรวจอะไร</h1><p>ตรวจผลแอดเรา จับความเคลื่อนไหวคู่แข่ง แล้วเลือกสิ่งที่จะทดลองต่อ</p></div><div className={styles.headerActions}>{periodControls}<button type="button" onClick={reload} disabled={loading}><Icon name="history"/>{loading?'กำลังเปิดข้อมูล…':'รีเฟรช'}</button></div></header>
  <div className={styles.topTools}><nav className={styles.jumpLinks} aria-label="ส่วนของภาพรวม">{canAnalyze?<a href="#own-review">ภาพรวมผลแอด</a>:null}<a href="#market-review">ความเคลื่อนไหวคู่แข่ง</a>{canAnalyze?<a href="#next-experiment">วางแผนทดลอง</a>:null}</nav><form action="/competitors" method="get" className={styles.searchForm} data-testid="dashboard-search"><label htmlFor="scout-search"><Icon name="search"/><input id="scout-search" name="search" type="search" maxLength={160} aria-label="ค้นสินค้า หรือเพจคู่แข่ง" placeholder="ค้นสินค้า ข้อเสนอ หรือชื่อเพจ…"/></label><button type="submit">ค้นหลักฐานเพิ่ม</button></form></div>
  {error?<div className={styles.error} role="alert">{error} <button onClick={reload}>ลองอีกครั้ง</button><Link href={pathname}>เปิดภาพรวมใหม่</Link></div>:null}
  {!data&&!error?<p className={styles.loading} role="status">กำลังสรุปผลแอดและความเคลื่อนไหวที่เก็บไว้…</p>:null}
  {data?<>
   {data.errors.length?<p className={styles.error} role="status">ข้อมูลบางส่วนเปิดไม่ได้: {data.errors.map(item=>({owned:'คลังแอดเรา',review:'ผลแอดเรา',series:'กราฟรายวัน',rivals:'คู่แข่ง',rivalAds:'หลักฐานคู่แข่ง',watchlist:'รายการติดตาม',collections:'รอบเก็บข้อมูล'}[item]??item)).join(' · ')} <button onClick={reload}>โหลดอีกครั้ง</button></p>:null}
   <div className={styles.marketBrief} data-testid="dashboard-market-brief"><a href="#market-review"><Icon name="search"/><span>คู่แข่ง: เพิ่งพบ <strong>{number(data.rivals?.week?.newAds)}</strong> แอดใน 7 วัน</span><span>ดูหลักฐาน →</span></a><Link href="/watchlist"><Icon name="bookmark"/>รายการที่คุณติดตาม {number(data.watchlist?.total)}</Link></div>
   {canAnalyze?<section id="own-review" className={styles.ownedSection} aria-labelledby="own-review-title">
    <div className={styles.sectionHead}><div><h2 id="own-review-title">ผลแอดเราเปลี่ยนไปอย่างไร</h2><p>{review?`${date(review.period.from)} — ${date(review.period.to)} · ช่วงข้อมูลที่บันทึกไว้`: 'ผลลัพธ์จาก Ads Management'}</p></div></div>
    {review?.ready?<>
     <div className={styles.resultStrip} data-testid="dashboard-metrics"><dl>{(['spend','roas','conversations','cost_per_conversation'] as const).map(metric=><div key={metric} data-metric={metric}><dt><Icon name={metric==='spend'?'wallet':metric==='roas'?'chart':metric==='conversations'?'compare':'target'}/>{{spend:`ค่าแอด (${group?.currency??'—'})`,roas:'ROAS (Meta)',conversations:'ทักจากแอด',cost_per_conversation:`ค่าทัก (${group?.currency??'—'})`}[metric]}</dt><dd data-testid={`review-${metric}`}>{number(group?.[metric])}</dd><ComparisonMetric data={review} group={group} metric={metric} previous={previous}/></div>)}</dl><p>เทียบกับ {date(review.previous?.period.from)} — {date(review.previous?.period.to)} · จากรายการที่ต้นทางรายงาน วันที่ไม่มีรายการไม่ถูกเติมเป็นศูนย์</p></div>
     {review.coverage&&[review.period,review.previous?.period].some(period=>period&&(period.from<review.coverage!.from||period.to>review.coverage!.to))?<p className={styles.note} role="status">ช่วงที่เลือกหรือช่วงก่อนหน้ามีวันที่อยู่นอกข้อมูลที่นำเข้า ({date(review.coverage.from)} — {date(review.coverage.to)}) · แสดงเฉพาะผลที่รายงานและงดเทียบ %</p>:null}
     <div className={styles.rankingPanel}><div className={styles.rankingHead}><div><h3><Icon name="chart"/>ผลแอดที่ต้องหยิบมาดู</h3><p>เรียงจาก {number(review.total)} แอดที่มีค่าแอดในช่วงนี้ · เปิดสื่อก่อนตัดสินใจ</p></div><div className={styles.tableTools}><Link href={libraryHref}>ตรวจทั้งหมด</Link><button type="button" disabled={!rows.length} onClick={exportVisible}><Icon name="download"/>ส่งออก {rows.length} แอด</button></div></div>
     <div className={styles.rankingTabs} role="group" aria-label="เรียงแอดสำหรับตรวจ">{ranks.map(([sort,label])=><button type="button" key={sort} aria-pressed={data.reviewOptions.sort===sort} onClick={()=>change('sort',sort)}>{label}</button>)}</div>
     {rows.length?<div className={styles.tableWrap}><table className={styles.reviewTable} data-testid="dashboard-owned-table"><caption>ผลแอด {group?.currency} · {date(review.period.from)} — {date(review.period.to)}</caption><thead><tr><th scope="col">แอด / เพจ / ยูนิต</th><th scope="col">ค่าแอด</th><th scope="col">ROAS</th><th scope="col">ทัก</th><th scope="col">ค่าทัก</th><th scope="col">ค่าแอดรายวัน</th><th scope="col"><span className={styles.srOnly}>เปิดหลักฐานและเลือกเทียบ</span></th></tr></thead><tbody>{rows.map((ad,index)=>{const series=data.rowSeries?.[key(ad)];return <tr key={key(ad)}><th scope="row"><div className={styles.adIdentity}><span className={styles.rank}>{index+1}</span><span className={styles.adAvatar} data-tone={index%4} aria-hidden>{ad.ad_name.slice(0,2).toUpperCase()}</span><div><button data-testid={`dashboard-open-${ad.ad_id}`} onClick={()=>setSelected(ad)}>{ad.ad_name}</button><span title={ad.page_name??ad.account_name}>{ad.page_name??ad.account_name}</span><small>{ad.unit_names.join(' · ')||'ยังไม่ระบุยูนิต'} · <AdStatus status={ad.status}/></small></div></div></th><td data-label="ค่าแอด">{number(ad.spend)}{series?.change!=null?<small className={styles.rowChange} title="เทียบกับช่วงก่อนหน้า ข้อมูลครบทุกวัน">{series.change>0?'+':''}{number(series.change)}%</small>:null}</td><td data-label="ROAS (Meta)">{number(ad.spend&&ad.purchase_value!=null?ad.purchase_value/ad.spend:null)}</td><td data-label="ทัก">{number(ad.conversations)}</td><td data-label="ค่าทัก">{number(ad.cost_per_conversation)}</td><td className={styles.trendCell} data-label="ค่าแอดรายวัน"><DashboardSparkline series={series} label={`ค่าแอดรายวันของ ${ad.ad_name}`}/></td><td className={styles.rowActions}><button type="button" onClick={()=>setSelected(ad)} aria-label={`ตรวจแอด ${ad.ad_name}`}>ตรวจแอด</button><Link href={compareHref(ad)} aria-label={`เลือกเทียบ ${ad.ad_name}`}>เลือกเทียบ <Icon name="compare"/></Link></td></tr>;})}</tbody></table></div>:<p className={styles.empty}>ไม่มีแอดในรายการอันดับที่เปิดอยู่สำหรับสกุลเงินนี้ <Link href={libraryHref}>เปิดผลแอดทั้งหมด</Link></p>}
     <p className={styles.note}>แสดงสูงสุด 6 รายการจากหน้าอันดับแรก แยกสกุลเงิน · กราฟเป็นค่าแอดรายวัน เว้นช่องเมื่อไม่มีข้อมูล · อันดับไม่ใช่คำแนะนำปรับงบอัตโนมัติ</p></div>
    </>:review?<p className={styles.empty}>ยังไม่มีผลแอดรายวันสำหรับช่วงนี้ <Link href="/owned-ads">อัปเดตข้อมูลจากเว็บเดิม</Link></p>:<Unavailable label="ผลแอดเรา" retry={reload}/>}
   </section>:null}
   <section id="market-review" className={styles.marketSection} aria-labelledby="market-title"><div className={styles.sectionHead}><div><h2 id="market-title"><Icon name="search"/>คู่แข่งมีอะไรให้จับตา</h2><p>เพิ่งพบ {number(data.rivals?.week?.newAds)} แอดใน 7 วัน · เก็บล่าสุด {date(data.rivals?.lastCollectedAt)}</p></div><Link href="/competitors?period=week">ดูทั้งหมด <Icon name="search"/></Link></div>
    <div className={styles.marketGrid}>
     <div className={styles.evidenceFeed}><h3>ข้อความและข้อเสนอที่เพิ่งพบ</h3><p className={styles.note}>“เพิ่งพบ” คือระบบเห็นครั้งแรก แอดอาจเริ่มยิงก่อนหน้านั้น</p>
      {data.rivals?.recentAds?.length?<div data-testid="dashboard-rivals">{data.rivals.recentAds.slice(0,4).map(ad=><article className={styles.evidence} key={`${ad.dataset_id}:${ad.ad_archive_id}`}><EvidencePreview ad={ad} onOpen={()=>setRival(ad)}/><div className={styles.evidenceBody}><div className={styles.evidenceMeta}><Link href={`/pages/${ad.page_id}?scope=all`}>{ad.page_name??ad.page_id}</Link><span>พบ {date(ad.first_seen_at)}</span></div><button type="button" className={styles.copyEvidence} data-testid={`open-ad-${ad.ad_archive_id}`} onClick={()=>setRival(ad)}>{ad.title||ad.body_text||'เปิดดูสื่อและข้อความที่เก็บไว้'}</button><div className={styles.evidenceFoot}><span>{ad.display_format??'ไม่ทราบรูปแบบ'} · CTA: {ad.cta_text||ad.cta_type||'ไม่มีข้อมูล'}</span><button type="button" onClick={()=>setRival(ad)}>เปิดหลักฐาน</button>{canAnalyze&&ad.dataset_id?<Link href={rivalHref(ad)}>เลือกเทียบ</Link>:null}</div></div></article>)}</div>:data.rivals?.recentAds==null?<Unavailable label="หลักฐานคู่แข่ง" retry={reload}/>:<p className={styles.empty}>ยังไม่พบแอดใหม่ใน 7 วัน <Link href="/competitors">ดูแอดในคลัง</Link></p>}
     </div>
     <aside className={styles.marketAside}><section><div className={styles.asideHead}><h3>เพจที่เพิ่งพบแอดเพิ่ม</h3><Link href="/pages?scope=all&sort=recently_found">ดูเพจ</Link></div>{data.rivals?.topPages.length?<div className={styles.pageList}>{data.rivals.topPages.slice(0,4).map(page=><Link href={`/pages/${page.page_id}?scope=all`} key={page.page_id}><span>{page.page_name??page.page_id}<small>ทั้งหมด {number(page.observed_ads)} แอดที่เก็บไว้</small></span><strong>{number(page.recently_found)}<small>เพิ่งพบ / 7 วัน</small></strong></Link>)}</div>:<p className={styles.note}>ยังไม่มีข้อมูลเพจพร้อมตรวจ</p>}</section><section><div className={styles.asideHead}><h3>คู่แข่งที่คุณติดตาม</h3><Link href="/watchlist">เปิดรายการ</Link></div>{data.watchlist?.items.length?<div className={styles.pageList}>{data.watchlist.items.slice(0,3).map(item=><Link href={`/watchlist/${item.id}`} key={item.id}><span>{item.target_name}<small>{item.scope_name??'ข้อมูลทั้งหมดที่เก็บไว้'}</small></span><Icon name="bookmark"/></Link>)}</div>:data.watchlist?<div className={styles.emptyWatch}><Icon name="bookmark"/><p>ยังไม่ได้ปักหมุดคู่แข่ง</p><span>เลือกเพจที่ขายสินค้าคล้ายเรา แล้วติดตามเพื่อกลับมาตรวจหลักฐานต่อ</span><Link href="/pages?scope=all">เลือกเพจที่จะติดตาม</Link></div>:<Unavailable label="รายการติดตาม" retry={reload}/>}</section></aside>
    </div>
   </section>
   {canAnalyze?<section id="next-experiment" className={styles.experiment}><div className={styles.experimentIntro}><Icon name="compare"/><div><h2>เปลี่ยนสิ่งที่เห็น เป็นแผนทดลอง</h2><p>เลือกคู่แอดที่สินค้าหรือปัญหาลูกค้าใกล้กัน แล้วเขียนสิ่งที่จะเปลี่ยนและเกณฑ์วัดผล</p></div><Link className={styles.primary} href={'/compare/ads?'+new URLSearchParams({returnTo})}>เริ่มเทียบและวางแผน <Icon name="compare"/></Link></div><ol><li><strong>ตรวจหลักฐาน</strong><span>เปิดคำเปิด ข้อเสนอ สื่อ และผลแอดเรา</span></li><li><strong>เลือกสิ่งที่จะเปลี่ยน</strong><span>ระบุเหตุผลจากแอดที่นำมาเทียบ</span></li><li><strong>กำหนดวิธีวัดผล</strong><span>เขียนเป้าหมายและดาวน์โหลดแผนให้ทีม</span></li></ol><p className={styles.note}>ร่างแผนเก็บในเบราว์เซอร์นี้ ยังไม่มีผลทดลองร่วมของทีม · % ปิดรอเชื่อมระบบขาย</p></section>:null}
   <details className={styles.provenance}><summary>ตรวจแหล่งข้อมูลและความครบถ้วน</summary><dl>{canAnalyze?<><Provenance title="แอดเราทั้งคลัง" value={number(data.owned?.inventory)}/><Provenance title="นำเข้าข้อมูลรายวันถึง" value={date(review?.coverage?.to)}/><Provenance title="ค่าแอดที่มีข้อมูล / รายการแอดต่อวัน" value={`${number(group?.coverage.spend.present)} / ${number(group?.coverage.spend.total)}`}/></>:null}<Provenance title="คลังคู่แข่ง" value={`${number(data.rivals?.ads)} แอด · ${number(data.rivals?.pages)} เพจ`}/></dl><p className={styles.note}>“—” คือไม่มีข้อมูลหรือยังไม่ครบ · ROAS = มูลค่าซื้อ ÷ ค่าแอดที่ Meta รายงาน · ค่าทัก = ค่าแอด ÷ บทสนทนา · ไม่แสดง % เปลี่ยนเมื่อช่วงอยู่นอกข้อมูล ฟิลด์ไม่ครบ หรือฐานเดิมเป็นศูนย์ · คู่แข่งไม่มีข้อมูลค่าแอดและ ROAS</p></details>
   <footer className={styles.footer}>อ่านจากข้อมูลที่บันทึกไว้ · เปิดเมื่อ {moment(data.generatedAt)} · รีเฟรชหน้านี้ไม่สั่งเก็บแอดเพิ่ม</footer>
  </>:null}
  {selected?<CompanyDetail ad={selected} creativeUrl={images[key(selected)]??selected.creative_url} mediaLoading={!selected.creative_url&&!Object.hasOwn(images,key(selected))} period={review?{date_start:review.period.from,date_end:review.period.to}:null} returnTo={returnTo} onClose={()=>setSelected(null)}/>:null}
  {rival?<AdDrawer adArchiveId={rival.ad_archive_id} datasetId={rival.dataset_id} onClose={()=>setRival(null)} compareHref={canAnalyze&&rival.dataset_id?rivalHref(rival):undefined}/>:null}
 </div>;
}
function ComparisonMetric({data,group,metric,previous}:{data:NonNullable<DashboardData['review']>;group:OwnedPerformanceSummary|undefined;metric:'spend'|'roas'|'conversations'|'cost_per_conversation';previous:OwnedPerformanceSummary|undefined}){
 const change=reviewChange(data,group,metric);
 const current=group?.[metric],before=previous?.[metric],max=Math.max(current??0,before??0);
 return <><div className={styles.change}><span>{change==null?'ยังเทียบ % ไม่ได้':`${change>0?'+':''}${number(change)}%`}</span><small>ช่วงก่อน {number(before)}</small></div>{change!=null&&current!=null&&before!=null&&max>0?<div className={styles.periodBars} role="img" aria-label={`เทียบยอดที่รายงาน ช่วงก่อน ${number(before)} ช่วงนี้ ${number(current)}`}><span style={{width:`${before/max*100}%`}}/><span style={{width:`${current/max*100}%`}}/><small>ช่วงก่อน / ช่วงนี้</small></div>:null}</>;
}
function Provenance({title,value}:{title:string;value:string}){return <div><dt>{title}</dt><dd>{value}</dd></div>;}
function EvidencePreview({ad,onOpen}:{ad:CatalogAdRow;onOpen:()=>void}){return <button type="button" className={styles.evidencePreview} onClick={onOpen} aria-label={`เปิดหลักฐานแอด ${ad.page_name??ad.page_id}`}><AdThumb ad={ad}/><span className={styles.previewFallback} title="ภาพย่อเปิดไม่ได้ · กดตรวจข้อมูลแอด"><Icon name="image"/><small>ดูข้อมูล</small></span></button>;}
function Unavailable({label,retry}:{label:string;retry:()=>void}){return <p className={styles.empty} role="status">เปิดข้อมูล{label}ไม่ได้ <button onClick={retry}>ลองอีกครั้ง</button></p>;}
