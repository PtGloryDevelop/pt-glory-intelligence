'use client';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useEffect,useMemo,useState} from 'react';
import {AdThumb} from '@/components/AdThumb';
import {AdImage} from '@/components/AdImage';
import type {DashboardData} from '@/lib/dashboard/read';
import type {OwnedPerformanceRow,OwnedPerformanceSummary} from '@/lib/owned-ads/performance';
import {reviewChange} from '@/lib/dashboard/review-model';
import {reviewAdKey} from '@/lib/dashboard/series';
import {buildUpdates,MIN_CHATS,rowRoas,type DashboardUpdate} from '@/lib/dashboard/updates';
import {DashboardSparkline} from './dashboard-sparkline';
import styles from './dashboard.module.css';

const WINDOWS=[7,14,30] as const;
const KIND={ours:'แอดเรา',rival:'คู่แข่ง',data:'ข้อมูล'} as const;
const num=(value:number|null|undefined,digits=2)=>value==null?'—':value.toLocaleString('th-TH',{minimumFractionDigits:digits,maximumFractionDigits:digits});
// A spend jump is only good or bad next to its results: same threshold as the overview feed's surge rule.
const SPEND_JUMP=50;
function spendTone(change:number,roas:number|null|undefined,overall:number|null|undefined):'good'|'bad'|'cut'|null{
  if(roas==null||overall==null)return null;
  if(change>=SPEND_JUMP)return roas<overall?'bad':'good';
  // A good ad losing half its budget is a decision worth checking.
  if(change<=-SPEND_JUMP&&roas>=overall)return 'cut';
  return null;
}
const thaiDate=(value:string|null|undefined)=>value?new Date(value.length===10?`${value}T12:00:00+07:00`:value).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Bangkok'}):'—';
const vs=(value:number|null,avg:number|null|undefined,goodUp:boolean)=>{
  if(value==null||!avg)return '';const ratio=value/avg;
  return goodUp?(ratio>1.1?styles.good:ratio<0.9?styles.bad:''):(ratio<0.9?styles.good:ratio>1.1?styles.bad:'');
};

function Delta({value,goodUp}:{value:number|null;goodUp:boolean|null}){
  if(value==null)return <span className={`${styles.delta} ${styles.flat}`}>ไม่มีช่วงเทียบ</span>;
  const tone=goodUp==null||Math.abs(value)<1?styles.flat:(value>0)===goodUp?styles.deltaGood:styles.deltaBad;
  return <span className={`${styles.delta} ${tone}`}>{value>0?'▲':'▼'} {Math.abs(value).toFixed(1)}%</span>;
}

function OwnedThumb({url,video,name}:{url:string|null|undefined;video:boolean;name:string}){
  return <span className={styles.thumb}>
    {url?<AdImage src={url} alt={name} sizes="56px" referrerPolicy="no-referrer"/>:<span className={styles.thumbEmpty} aria-hidden>{url===undefined?'…':'—'}</span>}
    {video?<span className={styles.play} aria-label="วิดีโอ">▶</span>:null}
  </span>;
}

export function Dashboard({canAnalyze}:{canAnalyze:boolean}){
  const params=useSearchParams(),router=useRouter(),pathname=usePathname();
  const days=WINDOWS.find(value=>String(value)===params.get('window'))??7;
  const query=`window=${days}`;
  const [result,setResult]=useState<{query:string;data:DashboardData}|null>(null);
  const [problem,setProblem]=useState<{query:string;message:string}|null>(null);
  const [retry,setRetry]=useState(0);
  const [local,setLocal]=useState<{key:string;ids:string[]}|null>(null);
  const [showSeen,setShowSeen]=useState(false);
  const data=result?.query===query?result.data:null,error=problem?.query===query?problem.message:null;

  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/dashboard?${query}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error??'เปิดภาพรวมไม่สำเร็จ');
      if(!controller.signal.aborted){setResult({query,data:body});setProblem(null);}
    }).catch(failure=>{if(!controller.signal.aborted)setProblem({query,message:failure.message});});
    return ()=>controller.abort();
  },[query,retry]);

  const review=data?.review??null;
  const summary:OwnedPerformanceSummary|undefined=review?.summary.find(item=>item.currency==='THB')??review?.summary[0];
  const rows=useMemo(()=>(review?.rows??[]).filter(row=>row.currency===summary?.currency),[review,summary]);
  const top=rows.slice(0,8);
  const seenKey=review?`pg-overview-seen:${review.period.from}:${review.period.to}`:null;

  // Per-viewer convenience only: what this person already looked at in this period.
  // seenKey exists only after the client fetch, so reading storage here never runs during SSR.
  const stored=useMemo(()=>{
    if(!seenKey)return [];
    try{const value:unknown=JSON.parse(localStorage.getItem(seenKey)??'[]');return Array.isArray(value)?value.filter((item):item is string=>typeof item==='string'):[];}catch{return [];}
  },[seenKey]);
  const seen=local?.key===seenKey?local.ids:stored;
  function toggleSeen(id:string){
    if(!seenKey)return;
    const next=seen.includes(id)?seen.filter(item=>item!==id):[...seen,id];
    setLocal({key:seenKey,ids:next});
    try{localStorage.setItem(seenKey,JSON.stringify(next));}catch{}
  }


  const updates=useMemo(()=>data?buildUpdates({summary,rows,series:data.rowSeries,
    rivals:data.collisions?{units:data.collisions.units,pages:data.collisions.pages,pending:data.collisions.pending,newThisWeek:data.collisions.newThisWeek,tracked:data.collisions.tracked}:null}):[],[data,summary,rows]);
  const open=updates.filter(item=>!seen.includes(item.id)),done=updates.filter(item=>seen.includes(item.id));
  const periodQuery=review?`period=custom&from=${review.period.from}&to=${review.period.to}`:'';
  const adHref=(ad:{ad_id:string})=>`/owned-ads/performance?q=${encodeURIComponent(ad.ad_id)}${periodQuery?`&${periodQuery}`:''}`;
  const compareHref=(ad:{account_id:string;ad_id:string})=>`/compare/ads?${new URLSearchParams({account:ad.account_id,owned:ad.ad_id})}`;
  const rowByKey=new Map(rows.map(row=>[reviewAdKey(row),row]));

  function setWindow(value:number){
    const next=new URLSearchParams(params);next.set('window',String(value));
    for(const item of ['period','from','to','dashboard','sort'])next.delete(item);
    router.replace(`${pathname}?${next}`,{scroll:false});
  }

  function updateRow(item:DashboardUpdate){
    const row=item.ad?rowByKey.get(reviewAdKey(item.ad)):undefined;
    return <li key={item.id} className={seen.includes(item.id)?styles.isSeen:undefined}>
      {row?<OwnedThumb url={row.creative_url??null} video={Boolean(row.video_id)} name={row.ad_name}/>:<span className={`${styles.thumb} ${styles.thumbKind}`} aria-hidden>{item.kind==='rival'?'คู่แข่ง':'ข้อมูล'}</span>}
      <div className={styles.feedBody}>
        <div className={styles.meta}><span className={`${styles.kind} ${styles[item.kind]}`}>{KIND[item.kind]}</span><span className={`${styles.sev} ${styles[item.severity]}`}>{item.label}</span></div>
        <h3>{item.title}</h3><p>{item.body}</p>
        <div className={styles.acts}>
          {item.ad?<><Link className={styles.btnPrimary} href={adHref(item.ad)}>ดูแอด</Link><Link className={styles.btn} href={compareHref(item.ad)}>เทียบกับคู่แข่ง</Link></>
            :item.href?<Link className={styles.btnPrimary} href={item.href}>{item.hrefLabel}</Link>:null}
          <button type="button" className={styles.btnGhost} onClick={()=>toggleSeen(item.id)}>{seen.includes(item.id)?'ย้อนกลับ':'ดูแล้ว'}</button>
        </div>
      </div>
    </li>;
  }

  const kpis:[string,'spend'|'roas'|'conversations'|'cost_per_conversation',boolean|null,number,string][]=[
    ['ค่าแอด','spend',null,0,'บาท'],['ROAS (Meta)','roas',true,2,''],
    ['ทักจากแอด','conversations',true,0,''],['ค่าทัก','cost_per_conversation',false,2,'บาท'],
  ];
  const previous=review?.previous?.summary.find(item=>item.currency===summary?.currency);
  const rivals=data?.rivals,recent=rivals?.recentAds?.slice(0,4)??[];

  return <div className={styles.page} data-testid="overview">
    <header className={styles.head}>
      <div>
        <h1>สัปดาห์นี้มีอะไรเปลี่ยน</h1>
        <p>{review?`${thaiDate(review.period.from)} – ${thaiDate(review.period.to)}${review.previous?` เทียบกับ ${thaiDate(review.previous.period.from)} – ${thaiDate(review.previous.period.to)}`:''} · แอดเราสกุล ${summary?.currency??'THB'}`:canAnalyze?'กำลังเปิดข้อมูล…':'ภาพรวมคู่แข่งและรายการติดตาม'}</p>
      </div>
      {canAnalyze?<div className={styles.seg} role="group" aria-label="ช่วงเวลา">{WINDOWS.map(value=><button key={value} type="button" aria-pressed={value===days} onClick={()=>setWindow(value)}>{value} วัน</button>)}</div>:null}
    </header>

    {error?<div className={styles.problem} role="alert">{error} <button type="button" className={styles.btn} onClick={()=>setRetry(value=>value+1)}>ลองใหม่</button></div>:null}
    {!data&&!error?<p className={styles.loading} role="status">กำลังเปิดภาพรวม…</p>:null}

    {data&&canAnalyze&&!review?<div className={styles.problem} role="alert">ผลแอดเราเปิดไม่ได้ในรอบนี้ ส่วนอื่นยังใช้ได้ <button type="button" className={styles.btn} onClick={()=>setRetry(value=>value+1)}>ลองใหม่</button></div>:null}
    {data&&canAnalyze&&review?<section className={styles.kpis} aria-label="ผลแอดเรา">
      {kpis.map(([label,metric,goodUp,digits,unit])=>{
        const value=summary?.[metric],before=previous?.[metric];
        return <div key={label} className={styles.kpi}>
          <span className={styles.kpiLabel}>{label}</span>
          <span className={styles.kpiValue}>{num(value,digits)}{unit?<small>{unit}</small>:null}</span>
          <span className={styles.kpiCmp}>{review&&summary?<Delta value={reviewChange(review,summary,metric)} goodUp={goodUp}/>:null}{before!=null?`ก่อนหน้า ${num(before,digits)}`:''}</span>
        </div>;
      })}
    </section>:null}

    {data?<div className={styles.grid}>
      <div className={styles.stack}>
        <section className={styles.panel} aria-labelledby="updates-heading">
          <div className={styles.panelHead}><h2 id="updates-heading">อัปเดตที่ควรรู้</h2><span>{open.length} รายการรอดู · คัดจากตัวเลขช่วงนี้ เรียงตามค่าแอดที่เกี่ยวข้อง</span></div>
          <ul className={styles.feed}>
            {open.length?open.map(updateRow):<li className={styles.feedEmpty}><h3>ดูครบทุกรายการแล้ว</h3><p>รายการใหม่จะขึ้นเมื่อมีข้อมูลรอบถัดไป</p></li>}
            {done.length?<li className={styles.feedToggle}><button type="button" className={styles.btnGhost} onClick={()=>setShowSeen(value=>!value)}>{showSeen?'ซ่อน':'แสดง'}รายการที่ดูแล้ว ({done.length})</button></li>:null}
            {showSeen?done.map(updateRow):null}
          </ul>
          {data.errors.includes('series')?<p className={styles.note}>กราฟรายวันเปิดไม่ได้ อัปเดตเรื่องค่าแอดที่เพิ่มขึ้นจึงอาจไม่ครบ</p>:null}
        </section>

        {canAnalyze&&top.length?<section className={styles.panel} aria-labelledby="top-heading">
          <div className={styles.panelHead}><h2 id="top-heading">แอดใช้งบสูงสุด</h2><Link className={styles.btnGhost} href={`/owned-ads/performance${periodQuery?`?${periodQuery}`:''}`}>ดูทั้ง {summary?.ad_count.toLocaleString('th-TH')??''} แอด →</Link></div>
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>แอด</th><th>ยูนิต</th><th className={styles.r}>ค่าแอด</th><th className={styles.r}>ROAS</th><th className={styles.r}>ทัก</th><th className={styles.r}>ค่าทัก</th><th>รายวัน</th><th><span className={styles.srOnly}>ทำต่อ</span></th></tr></thead>
            <tbody>{top.map((row:OwnedPerformanceRow)=>{
              const series=data.rowSeries?.[reviewAdKey(row)];const enough=(row.conversations??0)>=MIN_CHATS;
              return <tr key={reviewAdKey(row)}>
                <td><div className={styles.adCell}><OwnedThumb url={row.creative_url??null} video={Boolean(row.video_id)} name={row.ad_name}/><div><b>{row.ad_name}</b><small>{row.page_name??row.account_name}</small></div></div></td>
                <td>{row.unit_names.length?<span className={styles.unit}>{row.unit_names.join(', ')}</span>:<span className={`${styles.unit} ${styles.unitNone}`}>ยังไม่ผูกยูนิต</span>}</td>
                <td className={styles.r}>{num(row.spend)}{series?.change!=null?(()=>{const tone=spendTone(series.change,rowRoas(row),summary?.roas);
                  return <span className={`${styles.sub} ${tone==='bad'?styles.bad:tone==='good'?styles.good:tone==='cut'?styles.warn:''}`} title={tone==='bad'?'ค่าแอดพุ่งแต่ ROAS ต่ำกว่าภาพรวม':tone==='good'?'เพิ่มค่าแอดแล้ว ROAS ยังสูงกว่าภาพรวม':tone==='cut'?'แอด ROAS ดีกว่าภาพรวมแต่ค่าแอดลดลงมาก ตรวจว่าตั้งใจลดหรือไม่':undefined}>{series.change>0?'▲':'▼'} {Math.abs(series.change).toFixed(Math.abs(series.change)>=100?0:1)}%</span>;})():null}</td>
                <td className={`${styles.r} ${vs(rowRoas(row),summary?.roas,true)}`}>{num(rowRoas(row))}</td>
                <td className={styles.r}>{num(row.conversations,0)}</td>
                <td className={`${styles.r} ${enough?vs(row.cost_per_conversation,summary?.cost_per_conversation,false):''}`} title={enough?undefined:`ทักน้อยกว่า ${MIN_CHATS} ครั้ง ยังไม่เทียบกับภาพรวม`}>{num(row.cost_per_conversation)}</td>
                <td className={styles.spark}><DashboardSparkline series={series} label={`ค่าแอดรายวัน ${row.ad_name}`}/></td>
                <td><div className={styles.rowActs}><Link href={adHref(row)}>ตรวจ</Link><Link href={compareHref(row)}>เทียบ</Link></div></td>
              </tr>;})}</tbody>
          </table></div>
          <p className={styles.note}>สีเขียว/แดงเทียบกับภาพรวม (ROAS {num(summary?.roas)} · ค่าทัก {num(summary?.cost_per_conversation)}) · ค่าแอดที่เพิ่มตั้งแต่ {SPEND_JUMP}% เป็นสีแดงเมื่อ ROAS ต่ำกว่าภาพรวม และเขียวเมื่อยังสูงกว่า · สีส้มคือแอดที่ ROAS ดีแต่ค่าแอดลดลงตั้งแต่ {SPEND_JUMP}% · ค่าทักเทียบเฉพาะแอดที่ทักตั้งแต่ {MIN_CHATS} ครั้ง · ROAS และมูลค่าซื้อเป็นตัวเลขที่ Meta รายงาน</p>
        </section>:null}
      </div>

      <div className={styles.stack}>
        <section className={styles.panel} aria-labelledby="rivals-heading">
          <div className={styles.panelHead}><h2 id="rivals-heading">คู่แข่งสัปดาห์นี้</h2><Link className={styles.btnGhost} href="/competitors">ดูทั้งหมด →</Link></div>
          {data.collisions?.pages?<ul className={styles.collide}>{data.collisions.top.map(page=><li key={page.page_id}>
            <Link href={`/pages/${encodeURIComponent(page.page_id)}?scope=all`}>{page.page_name??page.page_id}</Link>
            <span>{page.unit} · ตรงคำค้น {page.matched_ads} แอด{page.new_matched_7d?` · ใหม่ ${page.new_matched_7d}`:''} · {page.confirmed?'ทีมตรวจแล้ว':'ยังไม่ได้ตรวจ'}</span></li>)}</ul>:null}
          {rivals?<>
            <p className={styles.panelLead}>เพิ่งพบ {(rivals.week?.newAds??rivals.recentlyFound).toLocaleString('th-TH')} แอดใน 7 วัน · เก็บล่าสุด {thaiDate(rivals.lastCollectedAt)} · “เพิ่งพบ” คือระบบเห็นครั้งแรก แอดอาจยิงมาก่อนแล้ว</p>
            <ul className={styles.rivalList}>{recent.map(ad=><li key={`${ad.dataset_id}:${ad.ad_archive_id}`}>
              <AdThumb ad={ad}/>
              <div><b>{ad.page_name??ad.page_id}</b><p>{(ad.title||ad.body_text||'ไม่มีข้อความที่บันทึกไว้').slice(0,90)}</p>
                <span className={styles.note}>ยิงมา {ad.ad_age_days.toLocaleString('th-TH')} วัน · <Link href={`/pages/${encodeURIComponent(ad.page_id)}?scope=dataset:${ad.dataset_id}`}>เปิดหลักฐาน</Link></span></div>
            </li>)}{!recent.length?<li className={styles.note}>สัปดาห์นี้ยังไม่พบแอดใหม่</li>:null}</ul>
          </>:<p className={styles.panelLead}>ข้อมูลคู่แข่งเปิดไม่ได้ในขณะนี้</p>}
        </section>
      </div>
    </div>:null}
  </div>;
}
