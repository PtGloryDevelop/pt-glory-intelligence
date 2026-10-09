import Link from 'next/link';
import {randomUUID} from 'node:crypto';
import {requireActorOrRedirect,satisfies} from '@/lib/auth/roles';
import {listCategories,listDatasets,getDatasetQuality} from '@/lib/read/queries';
import {listCollections} from '@/lib/collect/read';
import {collectorFormSettings} from '@/lib/collect/form-settings';
import {CollectLauncherProvider,CollectLaunchButton} from '../collect/collect-launcher';
import {thaiDateTime} from '@/lib/format/date';
import {Explorer} from '../datasets/[id]/explorer';
import {CatalogLibrary} from './catalog-library';
import {RivalBoard} from './rival-board';
import {Icon} from '@/components/shell/icons';
import styles from './competitors.module.css';
export const dynamic='force-dynamic';
export default async function AdLibrary({searchParams}:{searchParams:Promise<{dataset?:string;search?:string;period?:string;view?:string}>}){
 const actor=await requireActorOrRedirect();
 const {dataset,search,period,view}=await searchParams;
 // UI v2: the default view answers "which competitors collide with our units"; the full library is one tab away.
 const board=!dataset&&!search&&!period&&view!=='all';
 const datasets=(await listDatasets()).sort((a,b)=>b.collected_at.localeCompare(a.collected_at));
 const selected=dataset?datasets.find(row=>row.dataset_id===dataset):undefined;
 const quality=selected?await getDatasetQuality(selected.dataset_id):[];
 const canAnalyze=satisfies(actor.role,'analyst');
 const page=<>
  <section className={styles.heroBox}>
  <header className={styles.hero}><div><h1>ส่องคู่แข่ง</h1><p>ดูแอดใหม่และแอดที่ยิงนานของคู่แข่งแต่ละยูนิต แล้วเลือกเทียบกับแอดของเรา</p></div><CollectLaunchButton className={styles.manage}/></header>
  {board?<form className={styles.heroSearch} action="/competitors" method="get"><input type="hidden" name="view" value="all"/><input name="search" type="search" maxLength={160} aria-label="ค้นแอดคู่แข่ง" placeholder="ค้นแอดคู่แข่ง: ชื่อสินค้า ชื่อเพจ หรือข้อความในแอด…" data-testid="competitor-search"/><button type="submit">ค้นหา</button></form>:null}
  <nav className={styles.tabs} aria-label="สำรวจแอดคู่แข่ง"><Link href="/competitors" aria-current={board?'page':undefined} data-testid="competitor-board-tab">คู่แข่งของยูนิต</Link><Link href="/competitors?view=all" aria-current={!board&&!selected&&period!=='week'?'page':undefined}><Icon name="grid"/>คลังแอดทั้งหมด</Link><Link href="/competitors?view=all&period=week" aria-current={!board&&period==='week'?'page':undefined}>เพิ่งพบใน 7 วัน</Link><Link href="/pages?scope=all" data-testid="competitor-all-pages"><Icon name="building"/>สำรวจเพจ</Link></nav>
  </section>
  {dataset&&!selected?<p role="alert">ไม่พบรอบที่เลือก กำลังแสดงคลังทั้งหมด</p>:null}
  {board?<RivalBoard/>:<>
  <details className={styles.sourceOptions} data-testid="competitor-source-options"><summary>เลือกดูข้อมูลเฉพาะรอบ</summary><div className={styles.collection}><form method="get" action="/competitors"><label htmlFor="competitor-dataset">รอบที่เก็บ</label><select id="competitor-dataset" name="dataset" defaultValue={selected?.dataset_id??''}><option value="">ทั้งหมด</option>{datasets.map(row=><option key={row.dataset_id} value={row.dataset_id}>{row.dataset_name} · {thaiDateTime(row.collected_at)}</option>)}</select><button type="submit">เปิดข้อมูล</button></form></div></details>
  {selected?<><p className={styles.provenance}>รอบที่เลือก {selected.dataset_name} · เก็บเมื่อ {thaiDateTime(selected.collected_at)} · {selected.ads_in_dataset.toLocaleString('th-TH')} แอด</p><Explorer key={selected.dataset_id} datasetId={selected.dataset_id} canAnalyze={canAnalyze} preserveDatasetInUrl simple coverage={quality.map(({field,present_count,total_count})=>({field,present_count,total_count}))}/></>:<CatalogLibrary canAnalyze={canAnalyze}/>}</>}
 </>;
 if(!canAnalyze)return page;
 // Collecting happens beside the board: the same form as /collect, with its own server-made key.
 const [categories,settings,recent]=await Promise.all([listCategories(),collectorFormSettings(),listCollections(1)]);
 return <CollectLauncherProvider requestKey={randomUUID()} categories={categories} settings={settings} recent={recent}>{page}</CollectLauncherProvider>;
}

