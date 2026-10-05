'use client';

import { useEffect, useState } from 'react';
import { Creative } from '../../owned-ads/owned-client';
import type { CompanyAd } from '@/lib/owned-ads/source-rows';
import { resolveMedia } from '@/lib/media/resolve';
import { summarizeOwnedReport } from '@/lib/owned-ads/model';
import { AI_DIMS, AI_DIM_LABEL, adRefId, type AdReading, type AdRef, type AiEstimate, type AiRun } from '@/lib/ai/compare-shared';
import type { Rival } from './selection';
import styles from './comparison.module.css';
import { UsageBars } from '@/components/UsageBars';

export type CompareAd = { kind: 'own'; ad: CompanyAd } | { kind: 'rival'; ad: Rival };
export const MAX_COMPARE = 5;

const refOf = (item: CompareAd): AdRef => item.kind === 'own'
  ? { kind: 'own', account: item.ad.account_id, ad: item.ad.ad_id }
  : { kind: 'rival', dataset: item.ad.dataset_id ?? '', ad: item.ad.ad_archive_id };
export const compareId = (item: CompareAd) => adRefId(refOf(item));
const nameOf = (item: CompareAd) => item.kind === 'own' ? (item.ad.ad_name.length <= 5 ? item.ad.title ?? item.ad.ad_name : item.ad.ad_name) : item.ad.page_name ?? item.ad.page_id;
const usd = (value: number) => value < 0.01 ? '< 0.01' : value.toFixed(2);
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

async function post<T>(ads: AdRef[], dryRun: boolean): Promise<T> {
  const response = await fetch('/api/compare/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ads, dryRun }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'วิเคราะห์ไม่สำเร็จ');
  return data as T;
}

/** Up to five ads (ours first) read by AI on eight dimensions; "age" is our own data, never AI. */
export function AiCompare({ ads, images, ourThrough, onAdd, onRemove, onIdea }: {
  ads: CompareAd[]; images: Record<string, string>; ourThrough: string | null;
  onAdd: (kind: 'own' | 'rival') => void; onRemove: (item: CompareAd) => void; onIdea: (text: string) => void;
}) {
  const refs = ads.map(refOf);
  const key = refs.map(adRefId).join('|');
  const ready = ads.length >= 2 && ads.some(item => item.kind === 'own') && ads.some(item => item.kind === 'rival');
  const [estimate, setEstimate] = useState<{ key: string; data: AiEstimate | null; error: string }>({ key: '', data: null, error: '' });
  const [run, setRun] = useState<{ key: string; data: AiRun } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!ready) return;
    let live = true;
    post<AiEstimate>(refs, true)
      .then(data => { if (live) setEstimate({ key, data, error: '' }); })
      .catch((reason: Error) => { if (live) setEstimate({ key, data: null, error: reason.message }); });
    return () => { live = false; };
    // refs is derived from key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  async function analyze() {
    setBusy(true); setError('');
    try {
      const data = await post<AiRun>(refs, false);
      setRun({ key, data });
      setEstimate({ key, data: { model: data.model, cached: ads.length, missing: 0, setCached: true, estimate: 0, spent: data.spent }, error: '' });
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  const result = run?.key === key ? run.data : null;
  const est = estimate.key === key ? estimate.data : null;
  const readingOf = (item: CompareAd): AdReading | undefined => result?.ads[adRefId(refOf(item))];
  const staleRivals = ads.filter((item): item is { kind: 'rival'; ad: Rival } => item.kind === 'rival')
    .filter(item => !item.ad.collected_at && !item.ad.last_seen_at || ourThrough && days((item.ad.collected_at ?? item.ad.last_seen_at).slice(0, 10), ourThrough) > 14);

  return <section className={styles.panel} aria-labelledby="compare-ai-heading" data-testid="compare-ai">
    <div className={styles.sectionHead}>
      <div><span className={styles.sideLabel}>เทียบด้วย AI</span><h2 id="compare-ai-heading">อ่านแอด {ads.length}/{MAX_COMPARE} ตัว ใน 8 มิติ</h2>
        <p>AI อ่านจากข้อความและภาพของแต่ละแอด · กด “หลักฐาน” เพื่อดูคำที่ AI ใช้ · ช่อง “ยิงมานานแค่ไหน” มาจากข้อมูลจริง</p></div>
      <div className={styles.aiAdd}>
        <button type="button" disabled={ads.length >= MAX_COMPARE} onClick={() => onAdd('own')}>+ แอดของเรา</button>
        <button type="button" disabled={ads.length >= MAX_COMPARE} onClick={() => onAdd('rival')}>+ แอดคู่แข่ง</button>
      </div>
    </div>

    {staleRivals.length ? <p className={styles.aiWarn}>ข้อมูลคู่แข่ง {staleRivals.length} แอดเก่ากว่าข้อมูลแอดเราเกิน 14 วัน คู่แข่งอาจเปลี่ยนข้อเสนอไปแล้ว · เก็บข้อมูลใหม่ได้ที่หน้า “เก็บข้อมูลใหม่”</p> : null}

    <div className={styles.aiScroll}>
      <table className={styles.aiTable}>
        <thead><tr><th scope="col" className={styles.aiDim}><span className={styles.srOnly}>มิติ</span></th>{ads.map(item => {
          const own = item.kind === 'own';
          const image = own ? images[item.ad.account_id + ':' + item.ad.ad_id] ?? item.ad.creative_url : (() => { const media = resolveMedia(item.ad.display_format, item.ad.media, { archivePath: item.ad.archive_path, archiveStatus: item.ad.archive_status, presentationUrl: item.ad.archive_url }); return 'src' in media ? media.src : null; })();
          const roas = own ? summarizeOwnedReport([item.ad]).roas.value : null;
          return <th scope="col" key={adRefId(refOf(item))} className={own ? styles.aiOurs : undefined}>
            <div className={styles.aiHead}>
              <span className={own ? styles.kindOurs : styles.kindRival}>{own ? 'แอดของเรา' : 'คู่แข่ง'}</span>
              <button type="button" className={styles.aiRemove} aria-label={'เอา ' + nameOf(item) + ' ออก'} disabled={ads.length <= 2 || ads.filter(other => other.kind === item.kind).length <= 1} onClick={() => onRemove(item)}>×</button>
            </div>
            <div className={styles.aiThumb}><Creative url={image} name={nameOf(item)} sizes="160px" /></div>
            <strong className={styles.aiName}>{nameOf(item)}</strong>
            <span className={styles.aiMeta}>{own
              ? `ค่าแอด ${item.ad.spend?.toLocaleString('th-TH', { maximumFractionDigits: 0 }) ?? '—'} · ROAS ${roas == null ? '—' : roas.toFixed(2)} · ทัก ${item.ad.conversations ?? '—'}`
              : `${item.ad.cta_text ?? item.ad.cta_type ?? 'ไม่มีปุ่ม'} · ${item.ad.publisher_platform.length} ช่องทาง · ไม่มีข้อมูลงบคู่แข่ง`}</span>
          </th>;
        })}</tr></thead>
        <tbody>
          {AI_DIMS.map(dim => <tr key={dim}><th scope="row" className={styles.aiDim}>{AI_DIM_LABEL[dim]}</th>{ads.map(item => {
            const cell = readingOf(item)?.[dim];
            return <td key={adRefId(refOf(item))} className={item.kind === 'own' ? styles.aiOurs : undefined}>{cell ? <>
              <span className={cell.source === 'ไม่พบ' ? styles.muted : undefined}>{cell.value}</span>
              {cell.quote ? <details className={styles.aiEvidence}><summary>หลักฐาน · {cell.source}</summary><q>{cell.quote}</q></details> : null}
            </> : <span className={styles.muted}>—</span>}</td>;
          })}</tr>)}
          <tr><th scope="row" className={styles.aiDim}>{AI_DIM_LABEL.claims}</th>{ads.map(item => {
            const claims = readingOf(item)?.claims;
            return <td key={adRefId(refOf(item))} className={item.kind === 'own' ? styles.aiOurs : undefined}>{claims ? claims.items.length ? <ul className={styles.aiClaims}>{claims.items.map((claim, index) => <li key={index} className={claim.risky ? styles.aiRisk : undefined}>{claim.risky ? '⚠ ' : ''}{claim.text}</li>)}</ul> : <span className={styles.muted}>ไม่พบคำอ้าง</span> : <span className={styles.muted}>—</span>}</td>;
          })}</tr>
          <tr><th scope="row" className={styles.aiDim}>{AI_DIM_LABEL.age}</th>{ads.map(item => <td key={adRefId(refOf(item))} className={item.kind === 'own' ? styles.aiOurs : undefined}>
            {item.kind === 'own' ? `${item.ad.status ?? 'ไม่ทราบสถานะ'}` : `${item.ad.is_active === null ? 'ไม่ทราบสถานะ' : item.ad.is_active ? 'กำลังแสดง' : 'ไม่แสดงแล้ว'} · ยิงมา ${item.ad.ad_age_days} วัน`}
            <span className={styles.aiSrc}>ข้อมูลจริง</span>
          </td>)}</tr>
        </tbody>
      </table>
    </div>

    <div className={styles.saveRow}>
      <button type="button" data-variant="primary" data-testid="compare-ai-run" disabled={!ready || busy || !est && !estimate.error} onClick={analyze}>
        {busy ? 'กำลังวิเคราะห์…' : result ? 'วิเคราะห์ครบแล้ว' : est && !est.missing && est.setCached ? 'เปิดผลวิเคราะห์เดิม (ไม่มีค่าใช้จ่าย)' : `วิเคราะห์ด้วย AI${est ? ` (${est.missing} แอดใหม่) · ประมาณ USD ${usd(est.estimate)}` : ''}`}
      </button>
      <p className={styles.muted}>
        {!ready ? 'ต้องมีแอดของเราอย่างน้อย 1 ตัว และคู่แข่งอย่างน้อย 1 ตัว'
          : estimate.key === key && estimate.error ? estimate.error
          : est ? `แอดที่เคยวิเคราะห์ใช้ผลเดิม ${est.cached} ตัว · ใช้ไปวันนี้ USD ${est.spent.today.toFixed(3)} / ${est.spent.dailyCap} · รวม ${est.spent.total.toFixed(3)} / ${est.spent.totalCap} · ${est.model}`
          : 'กำลังคำนวณค่าใช้จ่าย…'}
        {result ? ` · ครั้งนี้ USD ${result.cost.toFixed(4)}` : ''}
      </p>
    </div>
    <UsageBars show={['ai']} refresh={run ? run.data.spent.total : 0} />
    {error ? <p className={styles.aiWarn} role="alert">{error}</p> : null}

    {result ? <div className={styles.aiSummary} data-testid="compare-ai-summary">
      <div><h3>จุดที่ต่างกันจริง</h3><ol>{result.summary.diffs.map((item, index) => <li key={index}>{item.text}<Refs ids={item.ads} ads={ads} /></li>)}</ol></div>
      <div><h3>ไอเดียทดลองสำหรับแอดเรา</h3><ul>{result.summary.ideas.map((item, index) => <li key={index}>{item.text}<Refs ids={item.ads} ads={ads} />
        <button type="button" className={styles.aiUse} onClick={() => onIdea(item.text)}>ใช้ในแผนทดลอง ↓</button></li>)}</ul></div>
      <p className={styles.muted}>AI สรุปจากข้อความและภาพเท่านั้น ไม่รู้ยอดขายหรืองบของคู่แข่ง · ตรวจหลักฐานก่อนนำไปใช้</p>
    </div> : null}
  </section>;
}

function Refs({ ids, ads }: { ids: number[]; ads: CompareAd[] }) {
  const names = ids.filter(id => ads[id]).map(id => nameOf(ads[id]));
  return names.length ? <span className={styles.aiRefs}>{names.map(name => <span key={name}>{name}</span>)}</span> : null;
}
