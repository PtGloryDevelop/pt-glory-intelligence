import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {requireActorOrRedirect,satisfies} from '@/lib/auth/roles';
import {dbUser} from '@/lib/db/user';
import {listCategories,listDatasets,getDatasetQuality} from '@/lib/read/queries';
import {listCollections} from '@/lib/collect/read';
import {collectorFormSettings} from '@/lib/collect/form-settings';
import {CollectLauncherProvider,CollectLaunchButton} from '../collect/collect-launcher';
import {thaiDateTime} from '@/lib/format/date';
import {PageHeader} from '@/components/shell/PageHeader';
import {Explorer} from '../datasets/[id]/explorer';
import {CatalogLibrary} from './catalog-library';
import {RivalBoard} from './rival-board';
import {Icon} from '@/components/shell/icons';
import styles from './competitors.module.css';
export const dynamic='force-dynamic';

/** The units' keywords, deduplicated, as shortcuts into the library search. A failed read only hides the chips. */
async function unitKeywords():Promise<string[]>{
 const db=await dbUser();
 const {data,error}=await db.from('unit_keywords').select('keyword').order('created_at');
 if(error)return [];
 return [...new Set((data??[]).map(row=>String(row.keyword).trim()).filter(Boolean))].slice(0,12);
}

/**
 * /competitors is two menu entries (UI v3): the bare URL is ติดตามคู่แข่ง (the units' rival board);
 * the library (`view=all`, a period, a search or a collection round) is ส่องแอด.
 */
export default async function AdLibrary({searchParams}:{searchParams:Promise<{dataset?:string;search?:string;period?:string;view?:string}>}){
 const actor=await requireActorOrRedirect();
 const {dataset,search,period,view}=await searchParams;
 const board=!dataset&&!search&&!period&&view!=='all';
 const canAnalyze=satisfies(actor.role,'analyst');
 const datasets=(await listDatasets()).sort((a,b)=>b.collected_at.localeCompare(a.collected_at));
 const selected=dataset?datasets.find(row=>row.dataset_id===dataset):undefined;
 let page:React.ReactNode;
 if(board){
  page=<>
   <PageHeader title="ติดตามคู่แข่ง" description="คู่แข่งของแต่ละยูนิตจากคำค้นของยูนิต · ทีมยืนยันเพจที่ใช่ แล้วเลือกเพจที่ต้องการเก็บแอดใหม่"
    actions={<div className={styles.headActions}><Link className={styles.manage} href="/pages?scope=all" data-testid="competitor-all-pages"><Icon name="building"/>สำรวจเพจ</Link><CollectLaunchButton className={styles.manage}/></div>}/>
   <RivalBoard/>
  </>;
 }else if(selected){
  const quality=await getDatasetQuality(selected.dataset_id);
  page=<>
   <PageHeader title="ส่องแอด" description={`รอบที่เลือก ${selected.dataset_name} · เก็บเมื่อ ${thaiDateTime(selected.collected_at)} · ${selected.ads_in_dataset.toLocaleString('th-TH')} แอด`}
    actions={<Link className={styles.manage} href="/competitors?view=all">ดูทั้งคลัง</Link>}/>
   <Explorer key={selected.dataset_id} datasetId={selected.dataset_id} canAnalyze={canAnalyze} preserveDatasetInUrl simple coverage={quality.map(({field,present_count,total_count})=>({field,present_count,total_count}))}/>
  </>;
 }else{
  page=<>
   {dataset?<p role="alert" className={styles.missing}>ไม่พบรอบที่เลือก กำลังแสดงคลังทั้งหมด</p>:null}
   <CatalogLibrary canAnalyze={canAnalyze} keywords={await unitKeywords()} datasets={datasets.slice(0,30).map(row=>({id:row.dataset_id,label:`${row.dataset_name} · ${thaiDateTime(row.collected_at)}`}))}/>
  </>;
 }
 if(!canAnalyze)return page;
 // Collecting happens beside the board: the same form as /collect, with its own server-made key.
 const [categories,settings,recent]=await Promise.all([listCategories(),collectorFormSettings(),listCollections(1)]);
 return <CollectLauncherProvider requestKey={randomUUID()} categories={categories} settings={settings} recent={recent}>{page}</CollectLauncherProvider>;
}
