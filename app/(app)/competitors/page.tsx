import Link from 'next/link';
import {requireActorOrRedirect,satisfies} from '@/lib/auth/roles';
import {listDatasets,getDatasetQuality} from '@/lib/read/queries';
import {thaiDateTime} from '@/lib/format/date';
import {Explorer} from '../datasets/[id]/explorer';
import {CatalogLibrary} from './catalog-library';
import {Icon} from '@/components/shell/icons';
import styles from './competitors.module.css';
export const dynamic='force-dynamic';
export default async function AdLibrary({searchParams}:{searchParams:Promise<{dataset?:string;search?:string;period?:string}>}){
 const actor=await requireActorOrRedirect();
 const {dataset}=await searchParams;
 const datasets=(await listDatasets()).sort((a,b)=>b.collected_at.localeCompare(a.collected_at));
 const selected=dataset?datasets.find(row=>row.dataset_id===dataset):undefined;
 const quality=selected?await getDatasetQuality(selected.dataset_id):[];
 const canAnalyze=satisfies(actor.role,'analyst');
 return <>
  <header className={styles.hero}><div><h1>ส่องคู่แข่ง</h1><p>ค้นภาพ ข้อความ และข้อเสนอที่เกี่ยวข้อง แล้วเลือกเทียบกับแอดของเรา</p></div>{canAnalyze?<Link href="/collect" className={styles.newSearch}><Icon name="search"/>ค้นและเก็บแอดเพิ่ม</Link>:null}</header>
  <nav className={styles.tabs} aria-label="สำรวจแอดคู่แข่ง"><Link href="/competitors" aria-current={!selected?'page':undefined}><Icon name="grid"/>คลังแอดทั้งหมด</Link><Link href="/competitors?period=week">เพิ่งพบใน 7 วัน</Link><Link href="/pages?scope=all" data-testid="competitor-all-pages"><Icon name="building"/>สำรวจเพจ</Link></nav>
  {dataset&&!selected?<p role="alert">ไม่พบรอบที่เลือก กำลังแสดงคลังทั้งหมด</p>:null}
  <details className={styles.sourceOptions} data-testid="competitor-source-options"><summary>เลือกดูข้อมูลเฉพาะรอบ</summary><div className={styles.collection}><form method="get" action="/competitors"><label htmlFor="competitor-dataset">รอบที่เก็บ</label><select id="competitor-dataset" name="dataset" defaultValue={selected?.dataset_id??''}><option value="">ทั้งหมด</option>{datasets.map(row=><option key={row.dataset_id} value={row.dataset_id}>{row.dataset_name} · {thaiDateTime(row.collected_at)}</option>)}</select><button type="submit">เปิดข้อมูล</button></form></div></details>
  {selected?<><p className={styles.provenance}>รอบที่เลือก {selected.dataset_name} · เก็บเมื่อ {thaiDateTime(selected.collected_at)} · {selected.ads_in_dataset.toLocaleString('th-TH')} แอด</p><Explorer key={selected.dataset_id} datasetId={selected.dataset_id} canAnalyze={canAnalyze} preserveDatasetInUrl simple coverage={quality.map(({field,present_count,total_count})=>({field,present_count,total_count}))}/></>:<CatalogLibrary canAnalyze={canAnalyze}/>}
 </>;
}

