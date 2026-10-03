import { forbidden } from 'next/navigation';
import { requireActorOrRedirect, satisfies } from '@/lib/auth/roles';
import { dbUser } from '@/lib/db/user';
import { getAdDetail, listDatasets } from '@/lib/read/queries';
import { signArchivedPreviews } from '@/lib/media/presentation';
import { cachedOwnedImage } from '@/lib/owned-ads/media-cache';
import type { CompanyAd } from '@/lib/owned-ads/source-rows';
import { getOwnedPerformance } from '@/lib/owned-ads/performance-read';
import { isPerformanceReturn } from '@/lib/owned-ads/performance-navigation';
import { AdComparison } from './comparison';
import { comparisonReturnHref, parseComparisonSelection, rivalFromDetail, type Rival } from './selection';

export const dynamic = 'force-dynamic';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActorOrRedirect();
  if (!satisfies(actor.role, 'analyst')) forbidden();
  const [datasets, params] = await Promise.all([listDatasets(), searchParams]);
  const seed = parseComparisonSelection(params);
  const returnHref=comparisonReturnHref(params.returnTo);
  const returnUrl=new URL(returnHref,'https://pt-glory.invalid');
  const performanceSource=typeof params.returnTo==='string'&&isPerformanceReturn(returnHref);
  const invalid = ['account', 'owned', 'dataset', 'rival'].some(key => params[key] !== undefined && params[key] !== seed[key as keyof typeof seed]);
  let error = invalid ? 'ลิงก์เลือกแอดไม่ถูกต้อง กรุณาเลือกจากรายการด้านล่าง' : '';
  let initialOwned: CompanyAd | null = null;
  let initialPeriod: { date_start: string; date_end: string } | null = null;
  let initialRival: Rival | null = null;
  const db = await dbUser();

  if (seed.owned) {
    if(performanceSource){
      try{
        const filters=new URLSearchParams(returnUrl.search);
        filters.set('q',seed.owned);filters.set('page','0');filters.delete('compare');
        const result=await getOwnedPerformance(filters);
        initialOwned=result.rows.find(row=>row.account_id===seed.account&&row.ad_id===seed.owned)??null;
        if(initialOwned)initialPeriod={date_start:result.period.from,date_end:result.period.to};
        else error='แอดที่เลือกไม่มีผลลัพธ์ตามช่วงวันที่และตัวกรองนี้ กรุณากลับไปเลือกจากคลัง';
      }catch{error='เปิดผลลัพธ์แอดตามช่วงวันที่ที่เลือกไม่สำเร็จ กรุณากลับไปเลือกจากคลัง';}
    }else{
    const snapshot = await db.from('owned_library_syncs').select('id,date_start,date_end').eq('status', 'completed').order('finished_at', { ascending: false }).limit(1).maybeSingle();
    let unavailable = Boolean(snapshot.error);
    if (snapshot.data) {
      const row = await db.from('owned_library_ads').select('data').eq('sync_id', snapshot.data.id).eq('account_id', seed.account).eq('ad_id', seed.owned).maybeSingle();
      unavailable = Boolean(row.error);
      if (row.data) {
        initialOwned = { ...row.data.data, creative_url: cachedOwnedImage(row.data.data) };
        initialPeriod = { date_start: snapshot.data.date_start, date_end: snapshot.data.date_end };
      }
    }
    if (unavailable) error = 'เปิดข้อมูลแอดของเราไม่สำเร็จ กรุณาลองเปิดอีกครั้ง';
    else if (!initialOwned) error = 'แอดที่เลือกไม่อยู่ในข้อมูลล่าสุด กรุณาเลือกแอดของเราอีกครั้ง';
    }
  }
  if (seed.rival) {
    if (!datasets.some(item => item.dataset_id === seed.dataset)) error = 'เปิดข้อมูลคู่แข่งที่เลือกไม่ได้ กรุณาเลือกจากรายการด้านล่าง';
    else {
      try {
        const detail = await getAdDetail(seed.rival, seed.dataset);
        if (detail) {
          const signed = await signArchivedPreviews([detail]);
          initialRival = rivalFromDetail({ ...detail, archive_url: detail.archive_path ? signed.get(detail.archive_path) ?? null : null });
        } else error = 'ไม่พบแอดคู่แข่งนี้ในข้อมูลที่เลือก กรุณาเลือกอีกครั้ง';
      } catch { error = 'เปิดแอดคู่แข่งไม่สำเร็จ กรุณาลองเลือกอีกครั้ง'; }
    }
  }
  return <AdComparison
    userNamespace={actor.userId}
    returnHref={returnHref}
    performanceSource={performanceSource}
    datasets={[...datasets].sort((a, b) => Date.parse(b.collected_at) - Date.parse(a.collected_at)).map(item => ({ id: item.dataset_id, name: item.dataset_name, source: item.source_product, collected: item.collected_at, count: item.ads_in_dataset }))}
    seed={seed} initialOwned={initialOwned} initialPeriod={initialPeriod} initialRival={initialRival} initialError={error}
  />;
}
