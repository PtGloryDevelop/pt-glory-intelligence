'use client';

import { useEffect, useRef, useState } from 'react';
import { Creative } from '../../owned-ads/owned-client';
import type { CompanyAd } from '@/lib/owned-ads/source-rows';
import { resolveMedia } from '@/lib/media/resolve';
import { summarizeOwnedReport } from '@/lib/owned-ads/model';
import { AI_DIMS, AI_DIM_LABEL, adRefId, type AdReading, type AdRef, type AiEstimate, type AiRun } from '@/lib/ai/compare-shared';
import { ownedName, type Rival } from './selection';
import styles from './comparison.module.css';
import { UsageBars } from '@/components/UsageBars';

export type CompareAd = { kind: 'own'; ad: CompanyAd } | { kind: 'rival'; ad: Rival };

const refOf = (item: CompareAd): AdRef => item.kind === 'own'
  ? { kind: 'own', account: item.ad.account_id, ad: item.ad.ad_id }
  : { kind: 'rival', dataset: item.ad.dataset_id ?? '', ad: item.ad.ad_archive_id };
export const compareId = (item: CompareAd) => adRefId(refOf(item));
const nameOf = (item: CompareAd) => item.kind === 'own' ? ownedName(item.ad) : item.ad.page_name ?? item.ad.page_id;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

async function post<T>(ads: AdRef[], dryRun: boolean): Promise<T> {
  const response = await fetch('/api/compare/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ads, dryRun }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'วิเคราะห์ไม่สำเร็จ');
  return data as T;
}

/**
 * The pair, read by AI, summed up in a few lines.
 *
 * It starts by itself once both sides are chosen (a pair read before comes
 * back from the cache at no cost; caps are enforced by the server), leads with
 * any wording in our ad that may break FDA rules, and keeps the 8-dimension
 * evidence one click away. "Age" is our own data, never AI.
 */
export function AiCompare({ ads, images, ourThrough, onCopyLink, linkLabel }: {
  ads: CompareAd[]; images: Record<string, string>; ourThrough: string | null;
  onCopyLink: () => void; linkLabel: string;
}) {
  const refs = ads.map(refOf);
  const key = refs.map(adRefId).join('|');
  const ready = ads.some(item => item.kind === 'own') && ads.some(item => item.kind === 'rival');
  const [estimate, setEstimate] = useState<{ key: string; data: AiEstimate | null; error: string }>({ key: '', data: null, error: '' });
  const [run, setRun] = useState<{ key: string; data: AiRun } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [detail, setDetail] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const tried = useRef<string | null>(null);

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
    setBusy(true); setError(null);
    try {
      const data = await post<AiRun>(refs, false);
      setRun({ key, data });
      setEstimate({ key, data: { model: data.model, cached: ads.length, missing: 0, setCached: true, estimate: 0, spent: data.spent }, error: '' });
    } catch (reason) { setError({ key, message: (reason as Error).message }); }
    finally { setBusy(false); }
  }

  // Once per pair, as soon as the server has answered the estimate.
  const est = estimate.key === key ? estimate.data : null;
  useEffect(() => {
    if (!ready || !est || tried.current === key) return;
    tried.current = key;
    void analyze();
    // analyze reads the current pair; key is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, est]);

  const result = run?.key === key ? run.data : null;
  const failure = error?.key === key ? error.message : estimate.key === key && estimate.error ? estimate.error : null;
  const readingOf = (item: CompareAd): AdReading | undefined => result?.ads[adRefId(refOf(item))];
  const risky = ads.flatMap(item => item.kind === 'own'
    ? (readingOf(item)?.claims.items ?? []).filter(claim => claim.risky).map(claim => ({ text: claim.text, name: nameOf(item) }))
    : []);
  const staleRivals = ads.filter((item): item is { kind: 'rival'; ad: Rival } => item.kind === 'rival')
    .filter(item => !item.ad.collected_at && !item.ad.last_seen_at || ourThrough && days((item.ad.collected_at ?? item.ad.last_seen_at).slice(0, 10), ourThrough) > 14);

  async function copySummary() {
    if (!result) return;
    const lines = [
      `เทียบแอด: ${ads.map(nameOf).join(' กับ ')}`, '',
      ...(risky.length ? ['คำเสี่ยง อย. ในแอดเรา', ...risky.map(item => `• ${item.text}`), ''] : []),
      'ต่างกันตรงไหน', ...result.summary.diffs.map(item => `• ${item.text}`), '',
      'แอดเราลองทำอะไร', ...result.summary.ideas.map(item => `• ${item.text}`),
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(key); } catch { setCopied(null); }
  }

  return <section className={styles.panel} aria-labelledby="compare-ai-heading" data-testid="compare-ai">
    <div className={styles.aiHeadRow}>
      <h2 id="compare-ai-heading">AI สรุปคู่นี้</h2>
      <span className={styles.muted}>อ่านจากภาพและข้อความ · ไม่รู้งบหรือยอดขายของคู่แข่ง</span>
    </div>

    {staleRivals.length ? <p className={styles.aiWarn}>ข้อมูลคู่แข่งเก่ากว่าข้อมูลแอดเราเกิน 14 วัน คู่แข่งอาจเปลี่ยนข้อเสนอไปแล้ว</p> : null}

    {!result ? <div className={styles.aiPending} role="status" data-testid="compare-ai-pending">
      {failure ? <><span>{failure}</span><button type="button" onClick={() => { tried.current = null; void analyze(); }} disabled={busy}>ลองอีกครั้ง</button></>
        : <span>{busy ? 'AI กำลังอ่านภาพและข้อความของทั้งสองฝั่ง…' : 'กำลังเตรียมสรุป…'}</span>}
    </div> : <div className={styles.aiSummary} data-testid="compare-ai-summary">
      {risky.length ? <div className={`${styles.aiRiskBox} ${styles.aiRiskFound}`} data-testid="compare-ai-risk">
        <h3>คำในแอดเราที่อาจผิดเกณฑ์ อย. ({risky.length})</h3>
        <ul>{risky.map((claim, index) => <li key={index}>{claim.text}</li>)}</ul>
      </div> : null}
      <div><h3>ต่างกันตรงไหน</h3><ul>{result.summary.diffs.map((item, index) => <li key={index}>{item.text}</li>)}</ul></div>
      <div><h3>แอดเราลองทำอะไร</h3><ul>{result.summary.ideas.map((item, index) => <li key={index}>{item.text}</li>)}</ul></div>
      {!risky.length ? <p className={styles.aiOk} data-testid="compare-ai-risk">✓ ไม่พบคำเสี่ยงผิดเกณฑ์ อย. ในแอดเรา</p> : null}
    </div>}

    <div className={styles.aiActions}>
      <button type="button" data-variant="primary" disabled={!result} onClick={() => void copySummary()} data-testid="compare-copy-summary">{copied === key ? 'คัดลอกแล้ว · วางใน LINE ได้เลย' : 'คัดลอกสรุปไปวาง LINE'}</button>
      <button type="button" onClick={onCopyLink} data-testid="compare-copy-link">{linkLabel}</button>
      {result ? <button type="button" className={styles.linkish} aria-expanded={detail} onClick={() => setDetail(value => !value)} data-testid="compare-ai-detail">{detail ? 'ซ่อนเทียบทีละหัวข้อ' : 'เทียบทีละหัวข้อ'}</button> : null}
    </div>

    {result && detail ? <div className={styles.aiScroll}>
      <table className={styles.aiTable}>
        <thead><tr><th scope="col" className={styles.aiDim}><span className={styles.srOnly}>หัวข้อ</span></th>{ads.map(item => {
          const own = item.kind === 'own';
          const image = own ? images[item.ad.account_id + ':' + item.ad.ad_id] ?? item.ad.creative_url : (() => { const media = resolveMedia(item.ad.display_format, item.ad.media, { archivePath: item.ad.archive_path, archiveStatus: item.ad.archive_status, presentationUrl: item.ad.archive_url }); return 'src' in media ? media.src : null; })();
          const roas = own ? summarizeOwnedReport([item.ad]).roas.value : null;
          return <th scope="col" key={adRefId(refOf(item))} className={own ? styles.aiOurs : undefined}>
            <div className={styles.aiHead}><span className={own ? styles.kindOurs : styles.kindRival}>{own ? 'แอดของเรา' : 'คู่แข่ง'}</span></div>
            <div className={styles.aiThumb}><Creative url={image} name={nameOf(item)} sizes="160px" /></div>
            <strong className={styles.aiName}>{nameOf(item)}</strong>
            <span className={styles.aiMeta}>{own
              ? `ค่าแอด ${item.ad.spend?.toLocaleString('th-TH', { maximumFractionDigits: 0 }) ?? '—'} · ROAS ${roas == null ? '—' : roas.toFixed(2)} · ทัก ${item.ad.conversations ?? '—'}`
              : `${item.ad.cta_text ?? item.ad.cta_type ?? 'ไม่มีปุ่ม'} · ${(item.ad.publisher_platform ?? []).length} ช่องทาง · ไม่มีข้อมูลงบคู่แข่ง`}</span>
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
    </div> : null}

    {/* Cost is the analyst's concern, not the ad team's: kept, but folded away. */}
    <details className={styles.aiUsage}>
      <summary>ค่าใช้ AI</summary>
      {est ? <p className={styles.muted}>แอดที่เคยวิเคราะห์ใช้ผลเดิม {est.cached} ตัว · ใช้ไปวันนี้ USD {est.spent.today.toFixed(3)} / {est.spent.dailyCap} · รวม {est.spent.total.toFixed(3)} / {est.spent.totalCap} · {est.model}{result ? ` · ครั้งนี้ USD ${result.cost.toFixed(4)}` : ''}</p> : null}
      <UsageBars show={['ai']} refresh={run ? run.data.spent.total : 0} />
    </details>
  </section>;
}
