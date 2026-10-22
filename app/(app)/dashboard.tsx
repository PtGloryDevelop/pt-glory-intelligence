'use client';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useEffect,useMemo,useState} from 'react';
import {AdThumb} from '@/components/AdThumb';
import {AdImage} from '@/components/AdImage';
import {AdDrawer} from '@/components/AdDrawer';
import {HomeChoiceButton} from '@/components/HomeChoice';
import {PageHeader} from '@/components/shell/PageHeader';
import {Icon} from '@/components/shell/icons';
import {Tile} from '@/components/shell/Tile';
import type {DashboardData} from '@/lib/dashboard/read';
import type {DailySpend} from '@/lib/dashboard/daily-read';
import type {OwnedPerformanceRow,OwnedPerformanceSummary} from '@/lib/owned-ads/performance';
import {FALL_MIN_SPEND,FALL_ROAS,type CommandAd,type CommandCenterData} from '@/lib/owned-ads/command-center';
import type {UnitSummary} from '@/lib/owned-ads/unit-summary';
import {ownedPageChoices} from '@/lib/owned-ads/page-names';
import {reviewChange} from '@/lib/dashboard/review-model';
import {reviewAdKey} from '@/lib/dashboard/series';
import {buildUpdates} from '@/lib/dashboard/updates';
import type {HomeChoice} from '@/lib/home-choice';
import {daysBehind,ownedLate,rivalsLate} from '@/lib/shell/stale';
import {CompanyDetail} from './owned-ads/company-library';
import {useJson} from './owned-ads/use-json';
import styles from './dashboard.module.css';

const WINDOWS=[7,14,30] as const;
const UNIT_ROWS=6;
const num=(value:number|null|undefined,digits=2)=>value==null?'—':value.toLocaleString('th-TH',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const whole=(value:number|null|undefined)=>value==null?'—':Math.round(value).toLocaleString('th-TH');
const day=(value:string)=>new Date(`${value.slice(0,10)}T12:00:00+07:00`);
const thaiDate=(value:string|null|undefined,year=true)=>value?day(value).toLocaleDateString('th-TH',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),timeZone:'Asia/Bangkok'}):'—';
const stamp=(value:string|null|undefined)=>value?new Date(value).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Bangkok'}):'—';
const bangkokDay=(value:string)=>new Date(Date.parse(value)+7*3600000).toISOString().slice(0,10);
const adKey=(ad:{account_id:string;ad_id:string})=>`${ad.account_id}:${ad.ad_id}`;

function Delta({value,goodUp}:{value:number|null;goodUp:boolean|null}){
  if(value==null)return <span className={styles.statNote}>ไม่มีช่วงเทียบ</span>;
  const tone=goodUp==null||Math.abs(value)<1?'':(value>0)===goodUp?styles.better:styles.worse;
  return <span className={`${styles.statNote} ${tone}`}>{value>0?'▲':'▼'} {Math.abs(value).toFixed(1)}%</span>;
}

function Stat({label,value,unit,children}:{label:string;value:string;unit?:string;children?:React.ReactNode}){
  return <div className={styles.stat}><span className={styles.statLabel}>{label}</span><span className={styles.statValue}>{value}{unit?<small>{unit}</small>:null}</span>{children}</div>;
}

function Thumb({url}:{url:string|null|undefined}){
  // No picture in the report reads as an image icon, not as an empty tinted box.
  return <span className={styles.thumb} data-empty={url?undefined:true}>{url?<AdImage src={url} alt="" sizes="48px" referrerPolicy="no-referrer"/>:<Icon name="image" size={18}/>}</span>;
}

/** Daily spend from the Ads Management reports; a day without complete figures is drawn as missing, never as zero. */
function DailyBars({days}:{days:DailySpend}){
  const max=Math.max(0,...days.map(item=>item.spend??0));
  const every=days.length>20?5:days.length>10?2:1;
  const spoken=days.map(item=>`${thaiDate(item.date,false)} ${item.spend==null?'ไม่มีข้อมูลครบ':`${whole(item.spend)} บาท`}`).join(', ');
  return <div className={styles.bars} role="img" aria-label={`ค่าแอดรายวัน: ${spoken}`}>
    {days.map((item,index)=><div key={item.date} className={styles.barCol} title={`${thaiDate(item.date)} · ${item.spend==null?'ข้อมูลวันนี้ไม่ครบ':`${whole(item.spend)} บาท`}`}>
      <span className={styles.barTrack}>{item.spend==null?<span className={styles.barMissing}/>:<span className={styles.bar} data-last={index===days.length-1||undefined} style={{height:`${max?Math.max(3,item.spend/max*100):3}%`}}/>}</span>
      <span className={styles.barLabel}>{index%every===0||index===days.length-1?(index===0?thaiDate(item.date,false):String(day(item.date).getDate())):' '}</span>
    </div>)}
  </div>;
}

export function Dashboard({canAnalyze,home='overview'}:{canAnalyze:boolean;home?:HomeChoice}){
  const params=useSearchParams(),router=useRouter(),pathname=usePathname();
  const days=WINDOWS.find(value=>String(value)===params.get('window'))??7;
  const query=`window=${days}`;
  const [result,setResult]=useState<{query:string;data:DashboardData}|null>(null);
  const [problem,setProblem]=useState<{query:string;message:string}|null>(null);
  const [retry,setRetry]=useState(0);
  const [allUnits,setAllUnits]=useState(false);
  const [names,setNames]=useState<{loading:boolean;message:string}>({loading:false,message:''});
  // Ads open beside the overview instead of sending the reader to another page.
  const [selected,setSelected]=useState<OwnedPerformanceRow|CommandAd|null>(null);
  const [rivalAd,setRivalAd]=useState<{ad_archive_id:string;dataset_id:string}|null>(null);
  const data=result?.query===query?result.data:null,error=problem?.query===query?problem.message:null;

  useEffect(()=>{
    const controller=new AbortController();
    // A section that timed out on a cold database cache usually passes on a second try, so the first failure retries quietly.
    const load=(attempt:number):Promise<void>=>fetch(`/api/dashboard?${query}`,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      const body=await response.json().catch(()=>({}));if(!response.ok)throw Object.assign(new Error(body.error??'เปิดภาพรวมไม่สำเร็จ'),{status:response.status});
      if(controller.signal.aborted)return;
      if(attempt===0&&canAnalyze&&(body as DashboardData).errors?.includes('review')){await new Promise(resolve=>setTimeout(resolve,1500));if(!controller.signal.aborted)return load(1);return;}
      setResult({query,data:body});setProblem(null);
    }).catch(async(failure:Error&{status?:number})=>{
      if(controller.signal.aborted||failure.name==='AbortError')return;
      if(attempt===0&&(failure.status==null||failure.status>=500)){await new Promise(resolve=>setTimeout(resolve,1500));if(!controller.signal.aborted)return load(1);return;}
      setProblem({query,message:failure.message});
    });
    void load(0);
    return ()=>controller.abort();
  },[query,retry,canAnalyze]);

  const review=data?.review??null;
  const summary:OwnedPerformanceSummary|undefined=review?.summary.find(item=>item.currency==='THB')??review?.summary[0];
  const previous=review?.previous?.summary.find(item=>item.currency===summary?.currency);
  const rows=useMemo(()=>(review?.rows??[]).filter(row=>row.currency===summary?.currency),[review,summary]);
  const rowByKey=useMemo(()=>new Map(rows.map(row=>[reviewAdKey(row),row])),[rows]);
  // The unit totals and the falling rule read the same window as the overview, so they wait for its dates.
  const period=review?new URLSearchParams({period:'custom',from:review.period.from,to:review.period.to}).toString():null;
  const units=useJson<UnitSummary>(canAnalyze&&period?`/api/owned-ads/units?${period}`:null,retry);
  const center=useJson<CommandCenterData>(canAnalyze&&period?`/api/owned-ads/command-center?${period}`:null,retry);

  const updates=useMemo(()=>data?buildUpdates({summary,rows,series:data.rowSeries,rivals:null}):[],[data,summary,rows]);
  const falling=center.data?.falling??[];
  const changes=updates.filter(item=>item.kind==='ours').slice(0,falling.length?2:3);
  const collisions=data?.collisions??null,rivals=data?.rivals??null;
  const longest=data?.longest?.rows??[];
  const pendingPages=collisions?.top.filter(page=>!page.confirmed).slice(0,2)??[];
  const periodQuery=period?`?${period}`:'';
  const returnTo=`${pathname}${params.size?`?${params}`:''}`;

  function setWindow(value:number){
    const next=new URLSearchParams(params);next.set('window',String(value));
    for(const item of ['period','from','to','dashboard','sort'])next.delete(item);
    router.replace(`${pathname}?${next}`,{scroll:false});
  }
  async function refreshPageNames(){
    setNames({loading:true,message:''});
    try{
      const response=await fetch('/api/owned-ads/page-names',{method:'POST'});const report=await response.json();
      if(!response.ok)throw new Error(report.error??'อัปเดตชื่อเพจไม่สำเร็จ');
      setNames({loading:false,message:report.unresolved?`มีชื่อแล้ว ${report.named} จาก ${report.pages} เพจ · อีก ${report.unresolved} เพจยังอ่านชื่อไม่ได้ กรุณาตรวจสิทธิ์เพจ`:`อัปเดตชื่อครบ ${report.named} เพจแล้ว`});
      setRetry(value=>value+1);
    }catch(failure){setNames({loading:false,message:failure instanceof Error?failure.message:'อัปเดตชื่อเพจไม่สำเร็จ'});}
  }

  // The units table: our units with spend in this window, most ads first, with the falling rule's count and the rival pages their keywords match.
  const fallingByUnit=new Map((center.data?.falling_counts??[]).map(row=>[row.unit_id,row.count]));
  const rivalsByUnit=new Map((collisions?.byUnit??[]).map(unit=>[unit.id,unit]));
  const unitRows=[...(units.data?.units??[])].sort((a,b)=>(b.current?.ad_count??0)-(a.current?.ad_count??0)||a.name.localeCompare(b.name,'th',{numeric:true}));
  const maxFalling=Math.max(1,...unitRows.map(unit=>fallingByUnit.get(unit.id)??0));
  const unitHref=(id:string|null)=>`/owned-ads/performance?${new URLSearchParams({...(id?{unit:id}:{}),...(review?{period:'custom',from:review.period.from,to:review.period.to}:{})})}`;

  // Upkeep: only what needs doing, each with the figure that says so.
  const unassigned=units.data?.unassigned.totals??null;
  const unnamed=review?ownedPageChoices(review.filters.pages).filter(page=>!page.name).length:0;
  const ownedTo=review?.coverage?.to??null,rivalsAt=rivals?.lastCollectedAt??null;
  const gap=ownedTo&&rivalsAt?Math.round((Date.parse(ownedTo)-Date.parse(bangkokDay(rivalsAt)))/86400000):null;
  // Late by the sidebar's rule, counted from when the server read the data. Old figures stay true for their dates; they just stop there.
  const readAt=data?Date.parse(data.generatedAt):null;
  const ownedBehind=readAt!=null&&ownedTo&&ownedLate(ownedTo,readAt)?daysBehind(ownedTo,readAt):null;
  const rivalsBehind=readAt!=null&&rivalsAt&&rivalsLate(rivalsAt,readAt)?daysBehind(rivalsAt,readAt):null;
  const late=ownedBehind!=null||rivalsBehind!=null;
  // The band already sends the reader to collect, so the upkeep list does not say it twice.
  const showGap=gap!=null&&gap>=1&&rivalsBehind==null;

  // The bridge: start from an ad of ours that is slipping and the rival ad that has run longest.
  const oursPick=falling[0]??(changes[0]?.ad?rowByKey.get(reviewAdKey(changes[0].ad))??null:null);
  const rivalPick=longest[0]??null;
  const compareHref=`/compare/ads?${new URLSearchParams({...(oursPick?{account:oursPick.account_id,owned:oursPick.ad_id}:{}),...(rivalPick?{dataset:rivalPick.dataset_id,rival:rivalPick.ad_archive_id}:{}),returnTo})}`;

  const tools=<div className={styles.tools}>
    <form action="/competitors" method="get" className={styles.search} role="search">
      <Icon name="search" size={15}/><input type="hidden" name="view" value="all"/>
      <input type="search" name="search" maxLength={160} placeholder="ค้นแอดคู่แข่ง" aria-label="ค้นแอดคู่แข่ง"/>
    </form>
    {canAnalyze?<div className={styles.seg} role="group" aria-label="ช่วงเวลา">{WINDOWS.map(value=><button key={value} type="button" aria-pressed={value===days} onClick={()=>setWindow(value)}>{value} วัน</button>)}</div>:null}
    {canAnalyze?<HomeChoiceButton target="overview" current={home}/>:null}
  </div>;

  const description=review?`${thaiDate(review.period.from)} – ${thaiDate(review.period.to)}${review.previous?` · เทียบกับ ${thaiDate(review.previous.period.from)} – ${thaiDate(review.previous.period.to)}`:''}`
    :canAnalyze?'กำลังเปิดข้อมูล…':'คู่แข่งของยูนิต และแอดคู่แข่งที่ยิงนานที่สุด';

  const oursLane=canAnalyze?<section className={styles.box} aria-labelledby="ours-heading" data-testid="overview-ours">
    <div className={styles.boxHead}><Tile icon="chart" tone="ours"/><h2 id="ours-heading" className={styles.oursTitle}>แอดของเรา</h2><span className={styles.stamp}>{ownedTo?`ข้อมูลถึง ${thaiDate(ownedTo,false)}`:''}</span></div>
    {data&&!review?<div className={styles.problem} role="alert">ผลแอดเราเปิดไม่ได้ในรอบนี้ ส่วนอื่นยังใช้ได้ <button type="button" onClick={()=>setRetry(value=>value+1)}>ลองใหม่</button></div>:null}
    {review?<>
      <div className={styles.stats} data-testid="overview-kpis">
        <Stat label="ค่าแอด (บาท)" value={whole(summary?.spend)}><Delta value={summary?reviewChange(review,summary,'spend'):null} goodUp={null}/></Stat>
        <Stat label="ROAS (Meta)" value={num(summary?.roas)}><Delta value={summary?reviewChange(review,summary,'roas'):null} goodUp={true}/></Stat>
        <Stat label="ทักจากแอด" value={num(summary?.conversations,0)}><Delta value={summary?reviewChange(review,summary,'conversations'):null} goodUp={true}/></Stat>
        <Stat label="ค่าทัก (บาท)" value={num(summary?.cost_per_conversation)}><Delta value={summary?reviewChange(review,summary,'cost_per_conversation'):null} goodUp={false}/></Stat>
      </div>
      {previous?<p className={styles.previous}>ช่วงก่อนหน้า: ค่าแอด {whole(previous.spend)} · ROAS {num(previous.roas)} · ทัก {num(previous.conversations,0)} · ค่าทัก {num(previous.cost_per_conversation)}</p>:null}
      {data?.daily?.length?<div className={`${styles.section} ${styles.chart}`}>
        <div className={styles.sectionHead}><span>ค่าแอดรายวัน (บาท)</span><span className={styles.sectionNote}>จากรายงาน Ads Management</span></div>
        <DailyBars days={data.daily}/>
      </div>:data?.errors.includes('daily')?<p className={styles.sectionNote}>กราฟค่าแอดรายวันเปิดไม่ได้ในรอบนี้</p>:null}
      <div className={styles.sectionHead} data-flush>สิ่งที่เปลี่ยน</div>
      <div className={styles.rows}>
        {center.error?<div className={styles.row}><span className={styles.rowText}><span className={styles.rowTitle}>เปิดรายการสื่อที่เริ่มตกไม่สำเร็จ</span></span><button type="button" className={styles.mini} onClick={()=>setRetry(value=>value+1)}>ลองใหม่</button></div>
          :center.loading?<div className={styles.row}><span className={styles.rowSub}>กำลังตรวจสื่อที่เริ่มตก…</span></div>
          :falling.length?<Link className={styles.row} href={`/owned-ads/performance${periodQuery}`} data-testid="overview-falling" title={`ROAS ${FALL_ROAS} ขึ้นไปใน 7 วันก่อนหน้า แต่ต่ำกว่า ${FALL_ROAS} ใน 7 วันล่าสุด และค่าแอดอย่างน้อย ${whole(FALL_MIN_SPEND)} บาททั้งสองช่วง`}>
            <span className={styles.stack}>{falling.slice(0,3).map(ad=><Thumb key={adKey(ad)} url={ad.creative_url}/>)}</span>
            <span className={styles.rowText}><span className={styles.rowTitle}>สื่อที่เริ่มตก<span className={styles.count}>{whole(center.data?.falling_total)} แอด</span></span>
              <span className={styles.rowSub}>เช่น {falling.slice(0,2).map(ad=>`${ad.ad_name} ROAS ${num(ad.previous_roas)} → ${num(ad.recent_roas)}`).join(' · ')}</span></span>
            <span className={styles.chevron}><Icon name="chevron" size={15}/></span>
          </Link>:null}
        {changes.map(item=>{const row=item.ad?rowByKey.get(reviewAdKey(item.ad)):undefined;
          return <button key={item.id} type="button" className={styles.row} onClick={()=>row?setSelected(row):undefined} disabled={!row}>
            <Thumb url={row?.creative_url}/>
            <span className={styles.rowText}><span className={styles.rowTitle}>{item.title}</span><span className={styles.rowSub}>{item.body}</span></span>
            <span className={styles.chevron}><Icon name="chevron" size={15}/></span>
          </button>;})}
        {!center.loading&&!center.error&&!falling.length&&!changes.length?<div className={styles.row}><span className={styles.rowSub}>ช่วงนี้ยังไม่มีแอดที่เข้าเกณฑ์ต้องตรวจ</span></div>:null}
      </div>
      <div className={styles.foot}><span className={styles.footNote}>ROAS และยอดซื้อเป็นตัวเลขที่ Meta รายงาน</span><Link className={styles.oursLink} href={`/owned-ads/performance${periodQuery}`}>ดูผลครีเอทีฟของเรา ›</Link></div>
    </>:!data&&!error?<p className={styles.loading} role="status">กำลังเปิดผลแอดเรา…</p>:null}
  </section>:null;

  const rivalLane=<section className={styles.box} aria-labelledby="rivals-heading" data-testid="overview-rivals">
    <div className={styles.boxHead}><Tile icon="swords" tone="rival"/><h2 id="rivals-heading" className={styles.rivalTitle}>คู่แข่ง</h2><span className={styles.stamp}>{rivalsAt?`เก็บล่าสุด ${stamp(rivalsAt)}`:''}</span></div>
    {data?<>
      <div className={styles.stats}>
        <Stat label="เพิ่งพบใน 7 วัน" value={rivals?whole(rivals.week?.newAds??rivals.recentlyFound):'—'} unit="แอด">
          <details className={styles.define}><summary aria-label="“เพิ่งพบ” หมายถึงอะไร"><Icon name="info" size={14}/></summary><span>ระบบเห็นครั้งแรกใน 7 วัน แอดอาจยิงมาก่อนแล้ว</span></details>
        </Stat>
        <Stat label="เพจคู่แข่งของยูนิต" value={collisions?whole(collisions.pages):'—'}>{collisions?<span className={styles.statNote}>{whole(collisions.units)} ยูนิตที่มีคำค้น</span>:null}</Stat>
        <Stat label="เพจรอทีมตรวจ" value={collisions?whole(collisions.pending):'—'}/>
        <Stat label="ยิงนานที่สุด" value={longest[0]?whole(longest[0].ad_age_days):'—'} unit={longest[0]?'วัน':undefined}><span className={styles.statNote}>นับจากวันเริ่มยิง</span></Stat>
      </div>
      {collisions&&!collisions.units?<Link className={styles.row} href="/competitors"><span className={styles.rowText}><span className={styles.rowTitle}>ยังไม่ได้ใส่คำค้นให้ยูนิต</span><span className={styles.rowSub}>ใส่คำที่ลูกค้าใช้หาสินค้า แล้วระบบจะเสนอเพจคู่แข่งจากแอดที่เก็บไว้</span></span><span className={styles.chevron}><Icon name="chevron" size={15}/></span></Link>:null}
      <div className={styles.section}>
        <div className={styles.sectionHead}><span>{data.longest?.scope==='library'?'แอดคู่แข่งที่ยิงนานที่สุด (ทั้งคลัง)':'แอดคู่แข่งที่ยิงนานที่สุด'}</span><Link className={styles.rivalLink} href="/competitors?view=all">ส่องแอดทั้งหมด ›</Link></div>
        {longest.length?<div className={styles.ads}>{longest.map(ad=><button key={`${ad.dataset_id}:${ad.ad_archive_id}`} type="button" className={styles.adPick} onClick={()=>setRivalAd({ad_archive_id:ad.ad_archive_id,dataset_id:ad.dataset_id})} aria-label={`ดูแอด ${ad.page_name??ad.page_id}`}>
          <AdThumb ad={ad} width={180}/>
          <span className={styles.adCaption}>{ad.page_name??ad.page_id}</span>
          <span className={styles.adMeta}>เริ่มยิง {whole(ad.ad_age_days)} วันก่อน</span>
        </button>)}</div>:<p className={styles.sectionNote}>{data.errors.includes('longest')?'แอดคู่แข่งเปิดไม่ได้ในขณะนี้':'ยังไม่มีแอดคู่แข่งที่กำลังแสดงในคลัง'}</p>}
      </div>
      {pendingPages.length?<>
        <div className={styles.sectionHead} data-flush><span>เพจที่รอทีมตรวจ</span>{collisions&&collisions.pending>pendingPages.length?<Link className={styles.rivalLink} href="/competitors">ดูทั้ง {whole(collisions.pending)} เพจ ›</Link>:null}</div>
        <div className={styles.rows}>{pendingPages.map(page=><div key={page.page_id} className={styles.row}>
          <span className={styles.rowText}><span className={styles.rowTitle}>{page.page_name??page.page_id}</span><span className={styles.rowSub}>{page.unit} · ตรงคำค้น {whole(page.matched_ads)} แอด</span></span>
          <Link className={styles.mini} href="/competitors">ตรวจเพจ</Link>
        </div>)}</div>
      </>:null}
      <div className={styles.foot}><span className={styles.footNote}>Ad Library ไม่มีข้อมูลงบหรือยอดขายของคู่แข่ง</span>{collisions?.pages?<Link className={styles.rivalLink} href="/competitors">ดูคู่แข่งทั้ง {whole(collisions.pages)} เพจ ›</Link>:<Link className={styles.rivalLink} href="/competitors">ติดตามคู่แข่ง ›</Link>}</div>
    </>:!error?<p className={styles.loading} role="status">กำลังเปิดข้อมูลคู่แข่ง…</p>:null}
  </section>;

  return <div className={styles.page} data-testid="overview">
    <PageHeader title="ภาพรวม" description={description} actions={tools}/>
    {error?<div className={styles.problem} role="alert">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>ลองใหม่</button></div>:null}

    {late?<section className={styles.late} role="status" aria-labelledby="late-heading" data-testid="overview-late">
      <span className={styles.lateIcon}><Icon name="alert" size={17}/></span>
      <div className={styles.lateText}><h2 id="late-heading">ข้อมูลไม่อัปเดต</h2><p>ตัวเลขในหน้านี้ยังถูกต้องตามวันที่ของข้อมูล แต่ยังไม่รวมช่วงหลังจากนั้น</p></div>
      <div className={styles.lateItems}>
        {ownedBehind!=null?<div className={styles.lateItem}>
          <span><b className={styles.oursTitle}>แอดของเรา</b> มีข้อมูลถึง {thaiDate(ownedTo)} · {whole(ownedBehind)} วันก่อน</span>
          <Link className={styles.mini} href="/owned-ads">อัปเดตแอดของเรา</Link>
        </div>:null}
        {rivalsBehind!=null?<div className={styles.lateItem}>
          <span><b className={styles.rivalTitle}>คู่แข่ง</b> เก็บล่าสุด {thaiDate(bangkokDay(rivalsAt!))} · {whole(rivalsBehind)} วันก่อน</span>
          {canAnalyze?<Link className={styles.mini} href="/collect">ค้นแอดคู่แข่งใหม่</Link>:null}
        </div>:null}
      </div>
    </section>:null}

    <div className={styles.lanes} data-single={canAnalyze?undefined:true}>{oursLane}{rivalLane}</div>

    {canAnalyze&&data?<section className={styles.bridge} aria-labelledby="bridge-heading">
      <Tile icon="compare" tone="compare" size={30}/>
      <div className={styles.bridgeText}><h2 id="bridge-heading">เทียบแอดเรากับคู่แข่ง</h2><p>เริ่มจากแอดเราที่ผลแย่ลง หรือแอดคู่แข่งที่ยิงนานที่สุด แล้วให้ AI สรุปว่าต่างกันตรงไหน</p></div>
      {oursPick?<span className={`${styles.token} ${styles.tokenOurs}`}><Thumb url={oursPick.creative_url}/><span className={styles.tokenText}>แอดเรา: {oursPick.ad_name}</span></span>:null}
      {oursPick&&rivalPick?<span aria-hidden className={styles.swap}>↔</span>:null}
      {rivalPick?<span className={`${styles.token} ${styles.tokenRival}`}><AdThumb ad={rivalPick} width={32}/><span className={styles.tokenText}>คู่แข่ง: {rivalPick.page_name??rivalPick.page_id}</span></span>:null}
      <Link className={styles.primary} href={compareHref} data-testid="overview-compare">เริ่มเทียบ</Link>
    </section>:null}

    {canAnalyze&&review?<section className={styles.box} aria-labelledby="units-heading" data-testid="overview-units">
      <div className={styles.boxHead}><div className={styles.headText}><h2 id="units-heading">ภาพรวมรายยูนิต</h2><span className={styles.stamp}>แอดของเรากับคู่แข่งของแต่ละยูนิตในแถวเดียว · เรียงตามจำนวนแอดที่มีค่าแอดในช่วงนี้</span></div></div>
      {units.error?<div className={styles.problem} role="alert">{units.error} <button type="button" onClick={()=>setRetry(value=>value+1)}>ลองใหม่</button></div>
        :units.loading?<p className={styles.loading} role="status">กำลังสรุปรายยูนิต…</p>
        :unitRows.length?<>
          <div className={styles.tableWrap}><table className={styles.table}>
            <thead><tr><th>ยูนิต</th><th className={styles.thOurs}>แอดของเรา</th><th className={styles.thOurs}>ค่าแอด (บาท)</th><th>สื่อที่เริ่มตก</th><th className={styles.thRival}>คู่แข่งของยูนิต</th><th><span className={styles.srOnly}>เปิด</span></th></tr></thead>
            <tbody>{unitRows.slice(0,allUnits?undefined:UNIT_ROWS).map(unit=>{
              const count=fallingByUnit.get(unit.id)??0,rival=rivalsByUnit.get(unit.id!);
              return <tr key={unit.id} onClick={()=>router.push(unitHref(unit.id))}>
                <td><Link className={styles.unitName} href={unitHref(unit.id)} onClick={event=>event.stopPropagation()}>{unit.name}</Link></td>
                <td>{whole(unit.current?.ad_count)} แอด</td>
                <td className={styles.num}>{whole(unit.current?.spend)}</td>
                <td>{center.data?<div className={styles.fall}><span className={styles.fallTrack}><span className={styles.fallFill} style={{width:`${count/maxFalling*100}%`}}/></span><b className={count?styles.fallCount:styles.zero}>{whole(count)}</b></div>:<span className={styles.zero}>—</span>}</td>
                <td>{rival?<><b className={styles.rivalCount}>{whole(rival.pages)} เพจ</b> <span className={styles.muted}>· {rival.keywords.slice(0,3).join(', ')}</span></>:<span className={styles.muted}>ยังไม่ตั้งคำค้น</span>}</td>
                <td className={styles.chevronCell} aria-hidden><Icon name="chevron" size={15}/></td>
              </tr>;})}</tbody>
          </table></div>
          {unitRows.length>UNIT_ROWS?<button type="button" className={styles.more} onClick={()=>setAllUnits(value=>!value)} aria-expanded={allUnits}>{allUnits?'แสดงเฉพาะยูนิตแรก ๆ':`ดูทุกยูนิต (${whole(unitRows.length)})`}</button>:null}
        </>:<p className={styles.loading}>ยังไม่มียูนิตที่มีค่าแอดในช่วงนี้</p>}
    </section>:null}

    {canAnalyze&&review?<section className={styles.upkeep} aria-labelledby="upkeep-heading" data-testid="overview-upkeep">
      <h2 id="upkeep-heading">งานดูแลข้อมูล · ทำแล้วตัวเลขบนหน้านี้จะครบขึ้น</h2>
      <div className={styles.list}>
        {unassigned?.ad_count?<div className={styles.row}>
          <Tile icon="layers" tone="ours"/>
          <span className={styles.rowText}><span className={styles.rowTitle}>{whole(unassigned.ad_count)} แอดที่มีค่าแอดช่วงนี้ยังไม่ผูกยูนิต</span><span className={styles.rowSub}>ค่าแอดรวม {whole(unassigned.spend)} บาท{units.data?.unassigned.share!=null?` (${num(units.data.unassigned.share,1)}% ของทั้งหมด)`:''} · ผูกเพจเข้ายูนิตใน Ads Management แล้วตารางรายยูนิตจะครบ</span></span>
        </div>:null}
        {unnamed?<div className={styles.row}>
          <Tile icon="tag" tone="neutral"/>
          <span className={styles.rowText}><span className={styles.rowTitle}>{whole(unnamed)} เพจยังไม่มีชื่อ</span><span className={styles.rowSub}>{names.message||'หลังจัดสิทธิ์เพจแล้ว กดอัปเดตชื่อให้แสดงชื่อเพจแทนรหัส'}</span></span>
          <button type="button" className={styles.mini} onClick={refreshPageNames} disabled={names.loading}>{names.loading?'กำลังอ่านชื่อเพจ…':'อัปเดตชื่อเพจ'}</button>
        </div>:null}
        {showGap?<div className={styles.row}>
          <Tile icon="alert" tone="rival"/>
          <span className={styles.rowText}><span className={styles.rowTitle}>ข้อมูลคู่แข่งเก่ากว่าแอดเรา {whole(gap)} วัน</span><span className={styles.rowSub}>คู่แข่งเก็บล่าสุด {thaiDate(bangkokDay(rivalsAt!),false)} · แอดเรามีข้อมูลถึง {thaiDate(ownedTo,false)}</span></span>
          <Link className={styles.mini} href="/collect">เก็บแอดคู่แข่งใหม่</Link>
        </div>:null}
        {!unassigned?.ad_count&&!unnamed&&!showGap?<div className={styles.row}><span className={styles.rowSub}>{units.loading?'กำลังตรวจ…':late?'นอกจากอัปเดตข้อมูลตามแถบด้านบน ไม่มีงานค้าง':'ไม่มีงานค้าง ข้อมูลพร้อมใช้'}</span></div>:null}
      </div>
    </section>:null}

    {selected?<CompanyDetail ad={selected} creativeUrl={selected.creative_url??null} mediaLoading={false}
      period={review?{date_start:review.period.from,date_end:review.period.to}:null} onClose={()=>setSelected(null)} returnTo={returnTo}/>:null}
    {rivalAd?<AdDrawer adArchiveId={rivalAd.ad_archive_id} datasetId={rivalAd.dataset_id} onClose={()=>setRivalAd(null)} canAnalyze={canAnalyze}
      compareHref={canAnalyze?`/compare/ads?${new URLSearchParams({dataset:rivalAd.dataset_id,rival:rivalAd.ad_archive_id,returnTo:pathname})}`:undefined}/>:null}
  </div>;
}
