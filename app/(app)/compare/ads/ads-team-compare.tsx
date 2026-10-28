'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ADS_DIMS, ADS_DIM_HINT, ADS_DIM_LABEL, adRefId, fdaWatch, type AdsDim, type AdsReading, type AdsRun, type AiCell, type AiEstimate } from '@/lib/ai/compare-shared';
import { thaiCodes } from '@/lib/ad-labels';
import { UsageBars } from '@/components/UsageBars';
import { Watch, compareId, nameOf, post, refOf, type CompareAd } from './ai-compare';
import styles from './comparison.module.css';

/** What the source itself says for a topic, shown beside AI's reading: the copy is a fact, the reading is not. */
function fact(item: CompareAd, dim: AdsDim): ReactNode {
  const { title, body_text: body } = item.ad;
  if (dim === 'caption') return body?.trim()
    ? <details className={styles.adsFact}><summary>{body.trim().split('\n')[0].slice(0, 120)}</summary><p>{body}</p></details>
    : <span className={styles.muted}>ไม่มีแคปชั่น</span>;
  if (dim === 'headline') return title?.trim() ? <strong className={styles.adsFactLine}>{title}</strong>
    : <span className={styles.muted}>แอดนี้ไม่มีพาดหัวจาก Meta</span>;
  return null;
}

const absent = (cell: AiCell) => cell.source === 'ไม่พบ';

/**
 * ทีมยิงแอด: the pair read only for caption, headline, content style and cover (what the ad team asked
 * for). Each row puts the ad's own words beside AI's reading, then what differs, what to try in our ad,
 * and new headlines or cover words to test. It starts by itself like the general view; a pair read
 * before comes back from the cache at no cost, and the server enforces the caps.
 */
export function AdsTeamCompare({ ads, onCopyLink, linkLabel, viewSwitch }: {
  ads: CompareAd[]; ourThrough: string | null; onCopyLink: () => void; linkLabel: string; viewSwitch: ReactNode;
}) {
  const refs = ads.map(refOf);
  const key = refs.map(adRefId).join('|');
  const ready = ads.some(item => item.kind === 'own') && ads.some(item => item.kind === 'rival');
  const [estimate, setEstimate] = useState<{ key: string; data: AiEstimate | null; error: string }>({ key: '', data: null, error: '' });
  const [run, setRun] = useState<{ key: string; data: AdsRun } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const tried = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    post<AiEstimate>(refs, true, 'ads')
      .then(data => { if (live) setEstimate({ key, data, error: '' }); })
      .catch((reason: Error) => { if (live) setEstimate({ key, data: null, error: reason.message }); });
    return () => { live = false; };
    // refs is derived from key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  async function analyze() {
    setBusy(true); setError(null);
    try {
      const data = await post<AdsRun>(refs, false, 'ads');
      setRun({ key, data });
      setEstimate({ key, data: { model: data.model, cached: ads.length, missing: 0, setCached: true, estimate: 0, spent: data.spent }, error: '' });
    } catch (reason) { setError({ key, message: (reason as Error).message }); }
    finally { setBusy(false); }
  }

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
  const readingOf = (item: CompareAd): AdsReading | undefined => result?.ads[compareId(item)];

  async function copySummary() {
    if (!result) return;
    const lines = [
      `เทียบแอด (มุมมองทีมยิงแอด): ${ads.map(nameOf).join(' กับ ')}`, '',
      ...ads.flatMap(item => {
        const reading = readingOf(item);
        return reading ? [`${item.kind === 'own' ? 'แอดเรา' : 'คู่แข่ง'} · ${nameOf(item)}`,
          ...ADS_DIMS.map(dim => `• ${ADS_DIM_LABEL[dim]}: ${reading[dim].value}${dim === 'cover' && reading.cover.quote ? ` (คำในปก: ${reading.cover.quote})` : ''}`), ''] : [];
      }),
      'ต่างกันตรงไหน', ...result.summary.diffs.map(item => `• ${item.text}`), '',
      'ทีมยิงแอดลองแก้อะไร', ...result.summary.ideas.map(item => `• ${item.text}`), '',
      'พาดหัว / คำบนปกใหม่ให้ลองยิง', ...result.summary.hooks.map(item => {
        const words = fdaWatch(item.text);
        return `• ${item.text}${words.length ? ` (⚠ ตรวจคำ: ${words.join(', ')})` : ''}`;
      }),
    ];
    try { await navigator.clipboard.writeText(lines.join('\n')); setCopied(key); } catch { setCopied(null); }
  }
  async function copyHook(index: number, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(`${key}#${index}`); } catch { setCopied(null); }
  }

  return <section className={`${styles.panel} ${styles.aiPanel}`} aria-labelledby="compare-ai-heading" data-testid="compare-ai-ads">
    <div className={styles.aiHeadRow}>
      <h2 id="compare-ai-heading">AI สรุปคู่นี้ · ทีมยิงแอด <span className={styles.aiBadge}>AI ตีความ</span></h2>
      {viewSwitch}
      <span className={styles.muted}>แคปชั่น พาดหัว แนวคอนเทนต์ ภาพปก · วิดีโอ AI เห็นแค่ภาพปก ไม่ได้ดูทั้งคลิป</span>
    </div>

    {!result ? <div className={styles.aiPending} role="status" data-testid="compare-ai-pending">
      {failure ? <><span>{failure}</span><button type="button" onClick={() => { tried.current = null; void analyze(); }} disabled={busy}>ลองอีกครั้ง</button></>
        : <span>{busy ? 'AI กำลังอ่านแคปชั่น พาดหัว และภาพปกของทั้งสองฝั่ง…' : 'กำลังเตรียมสรุป…'}</span>}
    </div> : <>
      {/* The ad's own words first (a fact), AI's reading under them (labelled). */}
      <div className={styles.aiScroll}>
        <table className={styles.aiTable} data-testid="compare-ads-table">
          <thead><tr><th scope="col" className={styles.aiDim}><span className={styles.srOnly}>หัวข้อ</span></th>{ads.map(item => <th scope="col" key={compareId(item)}>
            <span className={item.kind === 'own' ? styles.kindOurs : styles.kindRival}>{item.kind === 'own' ? 'แอดเรา' : 'คู่แข่ง'}</span>
            <strong className={styles.aiName}>{nameOf(item)}</strong>
          </th>)}</tr></thead>
          <tbody>{ADS_DIMS.map(dim => <tr key={dim}>
            <th scope="row" className={styles.aiDim}>{ADS_DIM_LABEL[dim]}<small>{ADS_DIM_HINT[dim]}</small></th>
            {ads.map(item => {
              const cell = readingOf(item)?.[dim];
              const own = fact(item, dim);
              return <td key={compareId(item)} data-testid={`compare-ads-${dim}`}>
                {own ? <>{own}<span className={styles.aiSrc}>ข้อมูลจริงจากแอด</span></> : null}
                {cell ? <div className={own ? styles.adsAi : undefined}>
                  {absent(cell) ? <span className={styles.muted}>{thaiCodes(cell.value) || 'ไม่พบในแอด'}</span> : <span>{thaiCodes(cell.value)}</span>}
                  {dim === 'cover' && cell.quote ? <q className={styles.adsCoverText}>คำในปก: {cell.quote}</q> : null}
                  {dim === 'headline' && !absent(cell) ? <small className={styles.aiSrc}>AI อ่านจาก{cell.source}</small> : null}
                  <small className={styles.aiSrc}>AI ตีความ</small>
                </div> : null}
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>

      <div className={styles.aiSummary} data-testid="compare-ai-summary">
        <div className={styles.diffs}><h3>ต่างกันตรงไหน</h3><ul>{result.summary.diffs.map((item, index) => <li key={index}>{item.text}</li>)}</ul></div>
        <div className={styles.ideas}><h3>ทีมยิงแอดลองแก้อะไร</h3><ul>{result.summary.ideas.map((item, index) => <li key={index}>{item.text}<Watch text={item.text} /></li>)}</ul></div>
        {result.summary.hooks.length ? <div className={styles.hooks} data-testid="compare-ai-hooks">
          <h3>พาดหัว / คำบนปกใหม่ให้ลองยิง</h3>
          <p className={styles.muted}>AI ถูกสั่งให้เลี่ยงคำเสี่ยง และระบบเตือนคำที่มักผิดเกณฑ์ อย. ให้ด้วย แต่ยังต้องตรวจก่อนใช้จริง</p>
          <ol>{result.summary.hooks.map((item, index) => <li key={index}>
            <strong>{item.text}</strong>
            <span className={styles.muted}>{item.why}</span>
            <Watch text={item.text} />
            <button type="button" className={styles.linkish} onClick={() => void copyHook(index, item.text)}>{copied === `${key}#${index}` ? 'คัดลอกแล้ว' : 'คัดลอก'}</button>
          </li>)}</ol>
        </div> : null}
      </div>
    </>}

    <div className={styles.aiActions}>
      <button type="button" data-variant="primary" disabled={!result} onClick={() => void copySummary()} data-testid="compare-copy-summary">{copied === key ? 'คัดลอกแล้ว · วางใน LINE ได้เลย' : 'คัดลอกสรุปไปวาง LINE'}</button>
      <button type="button" onClick={onCopyLink} data-testid="compare-copy-link">{linkLabel}</button>
    </div>

    <details className={styles.aiUsage}>
      <summary>ค่าใช้ AI</summary>
      {est ? <p className={styles.muted}>แอดที่เคยวิเคราะห์ในมุมมองนี้ใช้ผลเดิม {est.cached} ตัว · ใช้ไปวันนี้ USD {est.spent.today.toFixed(3)} / {est.spent.dailyCap} · รวม {est.spent.total.toFixed(3)} / {est.spent.totalCap} · {est.model}{result ? ` · ครั้งนี้ USD ${result.cost.toFixed(4)}` : ''}</p> : null}
      <UsageBars show={['ai']} refresh={run ? run.data.spent.total : 0} />
    </details>
  </section>;
}

