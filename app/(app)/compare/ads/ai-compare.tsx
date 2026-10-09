'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { CompanyAd } from '@/lib/owned-ads/source-rows';
import { AI_DIMS, AI_DIM_LABEL, HOOK_REWRITE_BELOW, SCORE_DIMS, SCORE_HINT, SCORE_LABEL, SCORE_LEVELS, adRefId, biggestGap, fdaWatch, scoreLead, scoreLevel, scoreTotal, type AdReading, type AdRef, type AiEstimate, type AiRun, type ScoreCell, type ScoreDim } from '@/lib/ai/compare-shared';
import { ownedName, type Rival } from './selection';
import { ownedStatus } from './labels';
import styles from './comparison.module.css';
import { UsageBars } from '@/components/UsageBars';

export type CompareAd = { kind: 'own'; ad: CompanyAd & { delivery_days?: number | null } } | { kind: 'rival'; ad: Rival };

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
 * any wording in our ad that may break FDA rules, then a strict creative
 * scorecard (the claude-ads "/ads creative" rubric), the one fix to make first,
 * and three hooks to test. The evidence stays one click away. "Age" is our own
 * data, never AI; scores are AI's judgement of the creative, not results.
 */
export function AiCompare({ ads, ourThrough, onCopyLink, linkLabel }: {
  ads: CompareAd[]; ourThrough: string | null;
  onCopyLink: () => void; linkLabel: string;
}) {
  // The table's evidence quotes: one switch for all of them instead of a toggle in every cell.
  const [quotes, setQuotes] = useState(false);
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
  const own = ads.find(item => item.kind === 'own');
  const ownReading = own ? readingOf(own) : undefined;
  const rivalReading = ads.filter(item => item.kind === 'rival').map(readingOf).find(Boolean);
  const gap = ownReading && rivalReading ? biggestGap(ownReading.scores, rivalReading.scores) : null;
  const hookScore = ownReading?.scores.hook.score ?? null;
  const totalText = (reading: AdReading | undefined) => {
    if (!reading) return '—';
    const total = scoreTotal(reading.scores);
    return `${total.got}/${total.max}`;
  };

  const staleRivals = ads.filter((item): item is { kind: 'rival'; ad: Rival } => item.kind === 'rival')
    .filter(item => !item.ad.collected_at && !item.ad.last_seen_at || ourThrough && days((item.ad.collected_at ?? item.ad.last_seen_at).slice(0, 10), ourThrough) > 14);

  async function copySummary() {
    if (!result) return;
    const lines = [
      `เทียบแอด: ${ads.map(nameOf).join(' กับ ')}`, '',
      ...(risky.length ? ['คำเสี่ยง อย. ในแอดเรา', ...risky.map(item => `• ${item.text}`), ''] : []),
      `คะแนนครีเอทีฟจาก AI: ${ads.map(item => `${item.kind === 'own' ? 'แอดเรา' : 'คู่แข่ง'} ${totalText(readingOf(item))}`).join(' · ')}`,
      ...(ownReading?.fix ? [`แก้ก่อน: ${ownReading.fix}`] : []), '',
      'ต่างกันตรงไหน', ...result.summary.diffs.map(item => `• ${item.text}`), '',
      'แอดเราลองทำอะไร', ...result.summary.ideas.map(item => `• ${item.text}`), '',
      'คำเปิดใหม่ให้ลองยิง', ...result.summary.hooks.map(item => {
        const words = fdaWatch(item.text);
        return `• ${item.text}${words.length ? ` (⚠ ตรวจคำ: ${words.join(', ')})` : ''}`;
      }),
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(key); } catch { setCopied(null); }
  }
  async function copyHook(index: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(`${key}#${index}`); } catch { setCopied(null); }
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
      <div className={styles.score} data-testid="compare-ai-score">
        <div className={styles.scoreHead}>
          <h3>คะแนนครีเอทีฟ</h3>
          <span className={styles.muted}>AI ให้คะแนนแบบเข้มงวด จากภาพและข้อความ · เป็นความเห็นของ AI ไม่ใช่ผลขายจริง ดูคู่กับตัวเลขด้านบน</span>
        </div>
        {ownReading && rivalReading ? <p className={styles.scoreLead} data-testid="compare-ai-score-lead">{scoreLead(ownReading.scores, rivalReading.scores)}</p> : null}
        <p className={styles.scoreScale}>อ่านคะแนน (เต็ม 10): {SCORE_LEVELS.map(([from, to, word]) => `${from}–${to} ${word}`).join(' · ')}</p>
        <div className={styles.scoreGrid} style={{ '--score-cols': ads.length } as CSSProperties}>
          <span className={styles.scoreCorner} />
          {ads.map(item => <span key={compareId(item)} className={styles.scoreWho}>
            <span className={item.kind === 'own' ? styles.kindOurs : styles.kindRival}>{item.kind === 'own' ? 'แอดเรา' : 'คู่แข่ง'}</span>
            <strong>{totalText(readingOf(item))}</strong>
          </span>)}
          {SCORE_DIMS.map(dim => <ScoreRow key={dim} dim={dim} gap={gap?.dim === dim} cells={ads.map(item => ({ id: compareId(item), own: item.kind === 'own', cell: readingOf(item)?.scores[dim] }))} />)}
        </div>
      </div>
      {ownReading?.fix || hookScore !== null && hookScore < HOOK_REWRITE_BELOW ? <div className={styles.fix} data-testid="compare-ai-fix">
        <h3>แก้ตรงนี้ก่อน (แอดเรา)</h3>
        {ownReading?.fix ? <p>{ownReading.fix}<Watch text={ownReading.fix} /></p> : null}
        {hookScore !== null && hookScore < HOOK_REWRITE_BELOW ? <p className={styles.fixHook}>Hook ได้ {hookScore}/10 ต่ำกว่า {HOOK_REWRITE_BELOW} · ถ้าจะทำแอดใหม่จากตัวนี้ ควรเขียนคำเปิดใหม่ก่อนเพิ่มงบ</p> : null}
      </div> : null}
      <div><h3>ต่างกันตรงไหน</h3><ul>{result.summary.diffs.map((item, index) => <li key={index}>{item.text}</li>)}</ul></div>
      <div><h3>แอดเราลองทำอะไร</h3><ul>{result.summary.ideas.map((item, index) => <li key={index}>{item.text}<Watch text={item.text} /></li>)}</ul></div>
      {result.summary.hooks.length ? <div className={styles.hooks} data-testid="compare-ai-hooks">
        <h3>คำเปิดใหม่ให้ลองยิง</h3>
        <p className={styles.muted}>AI ถูกสั่งให้เลี่ยงคำเสี่ยง และระบบเตือนคำที่มักผิดเกณฑ์ อย. ให้ด้วย แต่ยังต้องตรวจก่อนใช้จริง</p>
        <ol>{result.summary.hooks.map((item, index) => <li key={index}>
          <strong>{item.text}</strong>
          <span className={styles.muted}>{item.why}</span>
          <Watch text={item.text} />
          <button type="button" className={styles.linkish} onClick={() => void copyHook(index, item.text)}>{copied === `${key}#${index}` ? 'คัดลอกแล้ว' : 'คัดลอก'}</button>
        </li>)}</ol>
      </div> : null}
      {!risky.length ? <p className={styles.aiOk} data-testid="compare-ai-risk">✓ ไม่พบคำเสี่ยงผิดเกณฑ์ อย. ในแอดเรา</p> : null}
    </div>}

    <div className={styles.aiActions}>
      <button type="button" data-variant="primary" disabled={!result} onClick={() => void copySummary()} data-testid="compare-copy-summary">{copied === key ? 'คัดลอกแล้ว · วางใน LINE ได้เลย' : 'คัดลอกสรุปไปวาง LINE'}</button>
      <button type="button" onClick={onCopyLink} data-testid="compare-copy-link">{linkLabel}</button>
      {result ? <button type="button" className={styles.linkish} aria-expanded={detail} onClick={() => setDetail(value => !value)} data-testid="compare-ai-detail">{detail ? 'ซ่อนเทียบทีละหัวข้อ' : 'เทียบทีละหัวข้อ'}</button> : null}
    </div>

    {/* Pictures and numbers are already in the cards above; the table holds only what AI read, side by side. */}
    {result && detail ? <div className={styles.aiDetail}>
      <label className={styles.aiQuoteSwitch}><input type="checkbox" checked={quotes} onChange={event => setQuotes(event.target.checked)} />แสดงข้อความที่ AI ใช้เป็นหลักฐาน</label>
      <div className={styles.aiScroll}>
      <table className={styles.aiTable}>
        <thead><tr><th scope="col" className={styles.aiDim}><span className={styles.srOnly}>หัวข้อ</span></th>{ads.map(item => <th scope="col" key={adRefId(refOf(item))}>
          <span className={item.kind === 'own' ? styles.kindOurs : styles.kindRival}>{item.kind === 'own' ? 'แอดของเรา' : 'คู่แข่ง'}</span>
          <strong className={styles.aiName}>{nameOf(item)}</strong>
        </th>)}</tr></thead>
        <tbody>
          {AI_DIMS.map(dim => <tr key={dim}><th scope="row" className={styles.aiDim}>{AI_DIM_LABEL[dim]}</th>{ads.map(item => {
            const cell = readingOf(item)?.[dim];
            return <td key={adRefId(refOf(item))}>{cell ? <>
              <span className={cell.source === 'ไม่พบ' ? styles.muted : undefined}>{cell.value}</span>
              {quotes && cell.quote ? <q className={styles.aiQuote}>{cell.quote}<small> · จาก{cell.source}</small></q> : null}
            </> : <span className={styles.muted}>—</span>}</td>;
          })}</tr>)}
          <tr><th scope="row" className={styles.aiDim}>{AI_DIM_LABEL.claims}</th>{ads.map(item => {
            const claims = readingOf(item)?.claims;
            return <td key={adRefId(refOf(item))}>{claims ? claims.items.length ? <ul className={styles.aiClaims}>{claims.items.map((claim, index) => <li key={index} className={claim.risky ? styles.aiRisk : undefined}>{claim.risky ? '⚠ ' : ''}{claim.text}</li>)}</ul> : <span className={styles.muted}>ไม่พบคำอ้าง</span> : <span className={styles.muted}>—</span>}</td>;
          })}</tr>
          {/* Our own data, never AI: days running for both sides, in the same words. */}
          <tr><th scope="row" className={styles.aiDim}>{AI_DIM_LABEL.age}</th>{ads.map(item => <td key={adRefId(refOf(item))}>
            {item.kind === 'own'
              ? `${item.ad.delivery_days != null ? `ยิงมา ${item.ad.delivery_days.toLocaleString('th-TH')} วัน · ` : ''}${ownedStatus(item.ad.status)}`
              : `ยิงมา ${item.ad.ad_age_days.toLocaleString('th-TH')} วัน · ${item.ad.is_active === null ? 'ไม่ทราบสถานะ' : item.ad.is_active ? 'กำลังแสดง' : 'หยุดแล้ว'}`}
            <span className={styles.aiSrc}>ข้อมูลจริง ไม่ใช่ AI</span>
          </td>)}</tr>
        </tbody>
      </table>
      </div>
    </div> : null}

    {/* Cost is the analyst's concern, not the ad team's: kept, but folded away. */}
    <details className={styles.aiUsage}>
      <summary>ค่าใช้ AI</summary>
      {est ? <p className={styles.muted}>แอดที่เคยวิเคราะห์ใช้ผลเดิม {est.cached} ตัว · ใช้ไปวันนี้ USD {est.spent.today.toFixed(3)} / {est.spent.dailyCap} · รวม {est.spent.total.toFixed(3)} / {est.spent.totalCap} · {est.model}{result ? ` · ครั้งนี้ USD ${result.cost.toFixed(4)}` : ''}</p> : null}
      <UsageBars show={['ai']} refresh={run ? run.data.spent.total : 0} />
    </details>
  </section>;
}

/** A plain word match, not AI: words in a suggestion that often break FDA rules. */
function Watch({ text }: { text: string }) {
  const words = fdaWatch(text);
  return words.length ? <span className={styles.watch} data-testid="compare-ai-watch">⚠ มีคำที่มักผิดเกณฑ์ อย.: {words.join(' · ')}</span> : null;
}

/** One rubric part: what it asks, then per ad a bar, the score in words, and AI's reason. */
function ScoreRow({ dim, cells, gap }: { dim: ScoreDim; gap: boolean; cells: { id: string; own: boolean; cell: ScoreCell | undefined }[] }) {
  return <>
    <span className={gap ? styles.scoreLabelGap : styles.scoreLabel}>
      <strong>{SCORE_LABEL[dim]}</strong>
      <small>{SCORE_HINT[dim]}</small>
    </span>
    {cells.map(({ id, own, cell }) => {
      const score = cell?.score ?? null;
      return <span key={id} className={styles.scoreCell}>
        <span className={styles.scoreTop}>
          <span className={styles.scoreBar} aria-hidden="true"><span className={own ? styles.scoreFillOurs : styles.scoreFill} style={{ width: `${(score ?? 0) * 10}%` }} /></span>
          <span className={styles.scoreNum}><strong>{score ?? '—'}</strong> {cell ? scoreLevel(score) : ''}</span>
        </span>
        {cell?.why ? <span className={styles.scoreWhy}>{cell.why}</span> : null}
      </span>;
    })}
  </>;
}
