'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Creative } from '../../owned-ads/owned-client';
import { OwnedVideoPlayer } from '../../owned-ads/owned-video-player';
import { AdCreative } from '@/components/AdDrawer';
import type { CompanyAd } from '@/lib/owned-ads/source-rows';
import type { OwnedPerformanceData, OwnedPerformanceRow } from '@/lib/owned-ads/performance';
import type { CommandAd, CommandCenterData } from '@/lib/owned-ads/command-center';
import type { RivalBoard } from '@/lib/rivals/board';
import type { CatalogPage } from '@/lib/read/catalog';
import { resolveMedia } from '@/lib/media/resolve';
import { summarizeOwnedReport } from '@/lib/owned-ads/model';
import { comparisonSelectionKey, mergeComparisonSelection, ownedName, parseComparisonSelection, rivalCopy, rivalFromDetail, type ComparisonSelection, type Rival } from './selection';
import { AiCompare } from './ai-compare';
import { OwnedPicker, RivalPicker, creativeKey, ownKey, type OwnedChoice } from './pickers';
import styles from './comparison.module.css';

type Dataset = { id: string; name: string; source: string; collected: string; count: number };
type Period = { date_start: string; date_end: string };
type Owned = CompanyAd & Partial<Pick<OwnedPerformanceRow, 'unit_ids' | 'unit_names' | 'delivery_days' | 'video_id' | 'creative_id'>> & { group_size?: number };
type UnitAverage = { name: string; roas: number | null; cpc: number | null };
type Tone = 'good' | 'bad' | '';

const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
const thaiDay = (value: string | null | undefined) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '—';
const rivalImage = (ad: Rival) => {
  const resolved = resolveMedia(ad.display_format, ad.media, { archivePath: ad.archive_path, archiveStatus: ad.archive_status, presentationUrl: ad.archive_url });
  return 'src' in resolved ? resolved.src : null;
};
/** Against the unit's own figure: ±10% is "about the same", which is what most ads are. */
function versus(value: number | null, average: number | null | undefined, goodUp: boolean, unit: string): { text: string; tone: Tone } {
  if (value == null || !average) return { text: '', tone: '' };
  const ratio = value / average;
  if (ratio > 0.9 && ratio < 1.1) return { text: `ใกล้ค่าเฉลี่ย ${unit} (${number(average)})`, tone: '' };
  const higher = ratio >= 1.1;
  return { text: `${higher ? 'สูง' : 'ต่ำ'}กว่าค่าเฉลี่ย ${unit} (${number(average)})`, tone: higher === goodUp ? 'good' : 'bad' };
}

async function json<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'เปิดข้อมูลไม่สำเร็จ');
  return body as T;
}

/**
 * Our ad next to a competitor's, on one screen.
 *
 * Either side can be chosen first, from a panel that slides over this screen;
 * once one side is set, the other offers matches from the same unit. Both
 * creatives sit side by side at the same size with the few numbers each side
 * really has, and AI sums up the pair as soon as both are there.
 */
export function AdComparison({ datasets, seed, initialOwned, initialPeriod, initialRival, initialError, userNamespace, returnHref = '/', performanceSource = false }: {
  datasets: Dataset[]; seed: ComparisonSelection; initialOwned: CompanyAd | null; initialPeriod: Period | null; initialRival: Rival | null; initialError: string; userNamespace: string; returnHref?: string; performanceSource?: boolean;
}) {
  const storageKey = comparisonSelectionKey(userNamespace);
  const [a, setA] = useState<Owned | null>(initialOwned);
  const [b, setB] = useState<Rival | null>(initialRival ? { ...initialRival, dataset_id: seed.dataset } : null);
  const [period, setPeriod] = useState<Period | null>(initialPeriod);
  const [picker, setPicker] = useState<'own' | 'rival' | null>(null);
  const [worseFirst, setWorseFirst] = useState(false);
  const [restoreError, setRestoreError] = useState(initialError);
  const [restoring, setRestoring] = useState(true);
  const [images, setImages] = useState<Record<string, string>>({});
  const [videoIds, setVideoIds] = useState<Record<string, string | null>>({});
  const [units, setUnits] = useState<{ id: string; name: string }[]>([]);
  const [falling, setFalling] = useState<CommandAd[]>([]);
  const [board, setBoard] = useState<RivalBoard | null>(null);
  const [average, setAverage] = useState<{ key: string; value: UnitAverage | null } | null>(null);
  const [rivalSuggest, setRivalSuggest] = useState<{ key: string; rows: Rival[] } | null>(null);
  const [ownSuggest, setOwnSuggest] = useState<{ key: string; rows: OwnedChoice[] } | null>(null);
  const [shared, setShared] = useState<string | null>(null);

  // The period and filters our numbers are read with: the library's when we came from it.
  const base = useMemo(() => {
    const next = performanceSource ? new URLSearchParams(new URL(returnHref, 'https://pt-glory.invalid').search) : new URLSearchParams();
    for (const key of ['q', 'page', 'compare', 'sort', 'dir']) next.delete(key);
    if (!next.get('period')) next.set('period', 'all');
    return next;
  }, [performanceSource, returnHref]);
  const periodParams = useMemo(() => new URLSearchParams(['period', 'from', 'to'].flatMap(key => base.get(key) ? [[key, base.get(key)!]] : [])), [base]);

  // Reference data, once: units for the picker, falling ads for the badges, competitor pages per unit.
  useEffect(() => {
    const controller = new AbortController();
    json<OwnedPerformanceData>(`/api/owned-ads/performance?${base}`, controller.signal).then(data => { setUnits(data.filters.units); if (!period) setPeriod({ date_start: data.period.from, date_end: data.period.to }); }).catch(() => {});
    json<CommandCenterData>(`/api/owned-ads/command-center?${periodParams}`, controller.signal).then(data => setFalling(data.falling)).catch(() => {});
    json<RivalBoard>('/api/rivals', controller.signal).then(setBoard).catch(() => {});
    return () => controller.abort();
    // Loaded once per screen; period only fills in when nothing set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, periodParams]);

  // A selection kept from earlier in this session, or from a shared link.
  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      let saved = parseComparisonSelection({});
      try { if (storageKey) saved = parseComparisonSelection(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')); } catch { /* A blocked store does not prevent comparison. */ }
      const next = mergeComparisonSelection(saved, seed);
      try {
        const [own, rival] = await Promise.all([
          !initialOwned && !seed.owned && next.owned ? json<OwnedPerformanceData>(`/api/owned-ads/performance?${new URLSearchParams({ ...Object.fromEntries(base), q: next.owned })}`, controller.signal)
            .then(data => data.rows.find(row => row.account_id === next.account && row.ad_id === next.owned) ?? null) : Promise.resolve(initialOwned),
          !initialRival && !seed.rival && next.rival && datasets.some(item => item.id === next.dataset) ? json<{ detail: Parameters<typeof rivalFromDetail>[0] }>(`/api/ads/${next.rival}?datasetId=${next.dataset}`, controller.signal)
            .then(result => ({ ...rivalFromDetail(result.detail), dataset_id: next.dataset })) : Promise.resolve(initialRival ? { ...initialRival, dataset_id: seed.dataset } : null),
        ]);
        if (!controller.signal.aborted) { setA(own); setB(rival); }
      } catch { if (!controller.signal.aborted) setRestoreError('เปิดแอดที่เลือกไว้ไม่สำเร็จ สามารถเลือกใหม่ได้'); }
      finally { if (!controller.signal.aborted) setRestoring(false); }
    }
    void restore();
    return () => controller.abort();
  }, [datasets, seed, initialOwned, initialRival, storageKey, base]);

  // The pair lives in the address and this session, so a link or a refresh brings it back.
  useEffect(() => {
    if (restoring) return;
    const ids = { account: a?.account_id ?? '', owned: a?.ad_id ?? '', dataset: b?.dataset_id ?? '', rival: b?.ad_archive_id ?? '' };
    try { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify(ids)); } catch { /* Optional browsing convenience. */ }
    const url = new URL(window.location.href);
    if (url.pathname !== '/compare/ads') return;
    for (const [key, value] of Object.entries(ids)) { if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); }
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [a, b, storageKey, restoring]);

  // Our ad with its unit, read over the same period as the unit's average.
  const aKey = a ? ownKey(a) : '';
  useEffect(() => {
    if (!a || a.unit_ids) return;
    const controller = new AbortController();
    json<OwnedPerformanceData>(`/api/owned-ads/performance?${new URLSearchParams({ ...Object.fromEntries(base), q: a.ad_id })}`, controller.signal)
      .then(data => {
        const row = data.rows.find(item => item.account_id === a.account_id && item.ad_id === a.ad_id);
        setA(current => current && ownKey(current) === ownKey(a) ? (row ? { ...row, group_size: current.group_size } : { ...current, unit_ids: [], unit_names: [] }) : current);
        setPeriod({ date_start: data.period.from, date_end: data.period.to });
      }).catch(() => { setA(current => current && ownKey(current) === ownKey(a) ? { ...current, unit_ids: [], unit_names: [] } : current); });
    return () => controller.abort();
  }, [a, base]);

  const unitId = a?.unit_ids?.[0] ?? null;
  const unitName = a?.unit_names?.[0] ?? null;
  useEffect(() => {
    if (!unitId || !unitName) return;
    const controller = new AbortController();
    json<OwnedPerformanceData>(`/api/owned-ads/performance?${new URLSearchParams({ ...Object.fromEntries(base), unit: unitId })}`, controller.signal)
      .then(data => {
        const summary = data.summary.find(item => item.currency === a?.currency) ?? data.summary[0];
        setAverage({ key: unitId, value: summary ? { name: unitName, roas: summary.roas, cpc: summary.cost_per_conversation } : null });
      }).catch(() => setAverage({ key: unitId, value: null }));
    return () => controller.abort();
    // Currency belongs to the ad of this unit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId, unitName, base]);

  // Fresh picture and video for our ad.
  useEffect(() => {
    if (!a) return;
    const controller = new AbortController();
    fetch('/api/owned-ads/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ items: [{ account_id: a.account_id, ad_id: a.ad_id }] }) })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        const item = data?.items?.[0];
        if (!item || controller.signal.aborted) return;
        if (item.url) setImages(previous => ({ ...previous, [aKey]: item.url }));
        setVideoIds(previous => ({ ...previous, [aKey]: item.video_id ?? null }));
      }).catch(() => { /* Keep the source thumbnail when Meta is unavailable. */ });
    return () => controller.abort();
    // One fetch per chosen ad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aKey]);

  // Competitor pages of our unit (from the team's unit keywords), and the unit of a competitor page.
  const unitPages = useMemo(() => {
    const unit = board?.units.find(item => unitId && item.id === unitId) ?? null;
    return unit ? { unitName: unit.name, pageIds: unit.pages.map(page => page.page_id) } : null;
  }, [board, unitId]);
  const rivalUnit = useMemo(() => b ? board?.units.find(unit => unit.pages.some(page => page.page_id === b.page_id)) ?? null : null, [board, b]);

  useEffect(() => {
    if (!a || b || !unitPages?.pageIds.length) return;
    const key = unitPages.pageIds.slice(0, 60).join(',');
    const controller = new AbortController();
    json<CatalogPage>(`/api/catalog/ads?${new URLSearchParams({ pages: key, active: 'active', sort: 'age', limit: '3' })}`, controller.signal)
      .then(data => setRivalSuggest({ key, rows: data.rows as unknown as Rival[] })).catch(() => setRivalSuggest({ key, rows: [] }));
    return () => controller.abort();
  }, [a, b, unitPages]);

  useEffect(() => {
    if (a || !b || !rivalUnit) return;
    const controller = new AbortController();
    json<OwnedPerformanceData>(`/api/owned-ads/performance?${new URLSearchParams({ ...Object.fromEntries(base), unit: rivalUnit.id, sort: 'spend' })}`, controller.signal)
      .then(data => {
        const seen = new Set<string>();
        const fallingKeys = new Set(falling.map(ownKey));
        const rows = data.rows.filter(row => !seen.has(creativeKey(row)) && seen.add(creativeKey(row)))
          .sort((left, right) => Number(fallingKeys.has(ownKey(right))) - Number(fallingKeys.has(ownKey(left))));
        setOwnSuggest({ key: rivalUnit.id, rows: rows.slice(0, 3) });
      }).catch(() => setOwnSuggest({ key: rivalUnit.id, rows: [] }));
    return () => controller.abort();
  }, [a, b, rivalUnit, base, falling]);

  const fallingBy = useMemo(() => new Map(falling.map(ad => [ownKey(ad), ad])), [falling]);
  const worseCount = useMemo(() => new Set(falling.map(creativeKey)).size, [falling]);

  // A pick from the falling list carries that list's window; drop its unit so it is read again over ours.
  const chooseOwn = useCallback((ad: OwnedChoice) => { setA(ad.delivery_days === undefined ? { ...ad, unit_ids: undefined, unit_names: undefined } : ad); setPicker(null); setShared(null); }, []);
  const chooseRival = useCallback((ad: Rival) => { setB(ad); setPicker(null); setShared(null); }, []);
  function openOwn(worse = false) { setWorseFirst(worse); setPicker('own'); }

  async function copyLink() {
    if (!a || !b) return;
    const link = `${window.location.origin}/compare/ads?${new URLSearchParams({ account: a.account_id, owned: a.ad_id, dataset: b.dataset_id ?? '', rival: b.ad_archive_id })}`;
    try { await navigator.clipboard.writeText(link); setShared('copied'); } catch { setShared(link); }
  }

  const unitAvg = average?.key === unitId ? average.value : null;
  const metrics = a ? summarizeOwnedReport([a]) : null;
  const roas = metrics?.roas.value ?? null;
  const cpc = a && a.spend != null && a.conversations ? a.spend / a.conversations : null;
  const drop = a ? fallingBy.get(ownKey(a)) : undefined;
  const selectedDataset = datasets.find(item => item.id === b?.dataset_id);
  const copy = rivalCopy(b?.body_text);
  const outsideUnit = Boolean(a && b && unitPages?.pageIds.length && !unitPages.pageIds.includes(b.page_id));
  const returnLabel = ['/', '/market-overview'].includes(new URL(returnHref, 'https://pt-glory.invalid').pathname) ? 'กลับภาพรวม' : 'กลับคลังที่เลือกแอด';

  const signal = (label: string, value: string, context: { text: string; tone: Tone }) => <div className={styles.signal}>
    <span>{label}</span><strong>{value}</strong><small className={context.tone === 'good' ? styles.good : context.tone === 'bad' ? styles.bad : undefined}>{context.text || ' '}</small>
  </div>;

  return <div className={styles.workspace}>
    <PageHeader title="เทียบกับคู่แข่ง" description="วางแอดเราคู่กับแอดคู่แข่ง ดูภาพข้างกัน แล้วให้ AI สรุปว่าต่างกันตรงไหน · เริ่มฝั่งไหนก่อนก็ได้"
      actions={<span className={styles.headActions}>
        {a || b ? <button type="button" onClick={() => { setA(null); setB(null); setShared(null); }} data-testid="compare-reset">เริ่มคู่ใหม่</button> : null}
        <Link data-testid="comparison-return" href={returnHref}>{returnLabel}</Link>
      </span>} />
    {restoreError ? <p className={styles.notice} role="alert">{restoreError} <button type="button" onClick={() => setRestoreError('')}>ปิด</button></p> : null}
    {restoring ? <p role="status" className={styles.muted}>กำลังเปิดแอดที่เลือกไว้…</p> : null}

    {!a && !b && !restoring ? <div className={styles.shortcuts}>
      <button type="button" onClick={() => openOwn(true)} disabled={!worseCount} data-testid="compare-start-worse">
        <strong>แอดเราที่ผลแย่ลง <span className={styles.badgeWarn}>{number(worseCount)} ครีเอทีฟ</span></strong>
        <span>ROAS ลดลงเทียบกับช่วงก่อน · เริ่มตรงนี้ถ้าอยากรู้ว่าตัวไหนต้องแก้ด่วน</span>
      </button>
      <button type="button" onClick={() => setPicker('rival')} data-testid="compare-start-rival">
        <strong>เริ่มจากแอดคู่แข่ง</strong>
        <span>เลือกแอดคู่แข่งที่น่าสนใจก่อน แล้วระบบจะแนะนำแอดเราของยูนิตเดียวกัน</span>
      </button>
    </div> : null}

    <div className={styles.board}>
      <section className={`${styles.slot} ${!a && b ? styles.slotNext : ''}`} aria-labelledby="slot-own" data-testid="compare-owned-evidence">
        <div className={styles.slotHead}><h2 id="slot-own" className={styles.ours}>แอดของเรา</h2>{a ? <button type="button" disabled={restoring} onClick={() => openOwn()} data-testid="compare-change-own">เปลี่ยน</button> : null}</div>
        {a ? <>
          <div className={styles.evidenceMedia}><OwnedVideoPlayer key={aKey} ad={{ ...a, video_id: videoIds[aKey] ?? a.video_id ?? null }} url={images[aKey] ?? a.creative_url} /></div>
          <div><h3 className={styles.evidenceTitle}>{ownedName(a)}</h3><p className={styles.muted}>{unitName ?? 'ยังไม่ผูกยูนิต'} · {a.page_name ?? a.account_name}{(a.group_size ?? 1) > 1 ? ` · ${a.group_size} แอดใช้ภาพนี้` : ''}</p></div>
          <div className={styles.signals}>
            {signal('ROAS (Meta)', number(roas), versus(roas, unitAvg?.roas, true, unitAvg?.name ?? ''))}
            {signal(`ค่าแอด (${a.currency})`, number(a.spend), { text: period ? `${thaiDay(period.date_start)} – ${thaiDay(period.date_end)}` : '', tone: '' })}
            {signal(`ค่าทัก (${a.currency})`, number(cpc), versus(cpc, unitAvg?.cpc, false, unitAvg?.name ?? ''))}
          </div>
          <p className={styles.metaLine}>ทัก {number(a.conversations)}{a.delivery_days != null ? ` · ยิงมา ${number(a.delivery_days)} วัน` : ''} · {drop ? <span className={styles.badgeWarn}>ROAS ลดลง {number(drop.previous_roas)} → {number(drop.recent_roas)}</span> : a.status ?? 'ไม่ทราบสถานะ'}</p>
          <details className={styles.copyBox}><summary>อ่านข้อความในแอด</summary>{a.title ? <p className={styles.copyTitle}>{a.title}</p> : null}<p className={styles.copy} data-testid="compare-owned-copy">{a.body_text ?? 'ไม่มีข้อความในต้นทาง'}</p></details>
        </> : <div className={styles.emptySlot}>
          <strong>{b ? 'ขั้นต่อไป: เลือกแอดเรามาเทียบ' : 'ยังไม่ได้เลือกแอดเรา'}</strong>
          <span className={styles.muted}>{b && rivalUnit ? `แอดเราของ ${rivalUnit.name} ซึ่งมีเพจนี้เป็นคู่แข่ง · กดเพื่อเทียบทันที` : 'เลือกยูนิตหรือสินค้า แล้วเลือกแอด · แอดที่ใช้ภาพเดียวกันรวมเป็นการ์ดเดียว'}</span>
          {b && rivalUnit && ownSuggest?.key === rivalUnit.id ? <div className={styles.suggest}>{ownSuggest.rows.map(row => <button type="button" key={ownKey(row)} onClick={() => chooseOwn(row)} data-testid={'suggest-own-' + row.ad_id}>
            <span className={styles.suggestThumb}><Creative url={row.creative_url} name={row.ad_name} sizes="48px" /></span>
            <span><strong>{ownedName(row)}</strong><small className={fallingBy.has(ownKey(row)) ? styles.bad : undefined}>{fallingBy.has(ownKey(row)) ? `ROAS ลดลง ${number(fallingBy.get(ownKey(row))!.previous_roas)} → ${number(fallingBy.get(ownKey(row))!.recent_roas)}` : `ค่าแอด ${number(row.spend)} · ROAS ${number(summarizeOwnedReport([row]).roas.value)}`}</small></span>
            <span className={styles.suggestAction}>เทียบ</span>
          </button>)}</div> : null}
          <button type="button" data-variant={b && rivalUnit && ownSuggest?.rows.length ? undefined : 'primary'} disabled={restoring} onClick={() => openOwn()} data-testid="compare-pick-own">{b && rivalUnit && ownSuggest?.rows.length ? 'ดูแอดเราทั้งหมด' : 'เลือกแอดของเรา'}</button>
        </div>}
      </section>

      <section className={`${styles.slot} ${a && !b ? styles.slotNext : ''}`} aria-labelledby="slot-rival" data-testid="compare-rival-evidence">
        <div className={styles.slotHead}><h2 id="slot-rival">แอดคู่แข่ง</h2>{b ? <button type="button" disabled={restoring} onClick={() => setPicker('rival')} data-testid="compare-change-rival">เปลี่ยน</button> : null}</div>
        {b ? <>
          <div className={styles.evidenceMedia} data-testid="compare-rival-media"><AdCreative detail={b} /></div>
          <div><h3 className={styles.evidenceTitle}>{b.page_name ?? b.page_id}</h3><p className={styles.muted}>{rivalUnit ? `คู่แข่งของ ${rivalUnit.name} · ` : ''}{b.display_format ?? 'ไม่ระบุรูปแบบ'}{copy.template ? ' · แอดแคตตาล็อก' : ''}</p></div>
          <div className={styles.signals}>
            {signal('ยิงมา', `${number(b.ad_age_days)} วัน`, b.ad_age_days >= 45 ? { text: 'ยิงนาน มักเป็นแอดที่ได้ผล', tone: 'good' } : { text: b.ad_age_days <= 10 ? 'เพิ่งเริ่ม อาจยังทดสอบอยู่' : '', tone: '' })}
            {signal('สถานะ', b.is_active === null ? 'ไม่ทราบ' : b.is_active ? 'กำลังแสดง' : 'หยุดแล้ว', { text: `เจอล่าสุด ${thaiDay(b.last_seen_at ?? b.collected_at ?? selectedDataset?.collected)}`, tone: '' })}
            {signal('ช่องทาง', (b.publisher_platform ?? []).join(' · ') || '—', { text: b.cta_text ?? b.cta_type ?? '', tone: '' })}
          </div>
          <p className={styles.metaLine}>ไม่มีข้อมูลงบหรือยอดขายของคู่แข่ง · จำนวนวันที่ยิงคือสัญญาณที่ดีที่สุดที่มี · Library ID {b.ad_archive_id}</p>
          <details className={styles.copyBox}><summary>อ่านข้อความในแอด</summary>{b.title ? <p className={styles.copyTitle}>{b.title}</p> : null}<p className={copy.template ? `${styles.copy} ${styles.muted}` : styles.copy} data-testid="compare-rival-copy">{copy.text}</p>
            <Link href={'/pages/' + b.page_id + '?scope=dataset:' + b.dataset_id}>ดูเพจนี้ ↗</Link></details>
        </> : <div className={styles.emptySlot}>
          <strong>{a ? 'ขั้นต่อไป: เลือกแอดคู่แข่ง' : 'ยังไม่ได้เลือกแอดคู่แข่ง'}</strong>
          <span className={styles.muted}>{a && unitPages?.pageIds.length ? `คู่แข่งของ ${unitPages.unitName} ที่ยิงนานที่สุด · กดเพื่อเทียบทันที` : a && unitName ? `ยังไม่มีรายชื่อคู่แข่งของ ${unitName} · เลือกจากคลังคู่แข่งทั้งหมดได้` : 'ค้นจากคลังคู่แข่งทั้งหมด'}</span>
          {a && unitPages && rivalSuggest?.key === unitPages.pageIds.slice(0, 60).join(',') ? <div className={styles.suggest}>{rivalSuggest.rows.map(ad => <button type="button" key={ad.ad_archive_id} onClick={() => chooseRival(ad)} data-testid={'suggest-rival-' + ad.ad_archive_id}>
            <span className={styles.suggestThumb}><Creative url={rivalImage(ad)} name={ad.page_name ?? ad.ad_archive_id} sizes="48px" /></span>
            <span><strong>{ad.page_name ?? ad.page_id}</strong><small>ยิงมา {number(ad.ad_age_days)} วัน · {ad.display_format ?? 'ไม่ระบุรูปแบบ'}</small></span>
            <span className={styles.suggestAction}>เทียบ</span>
          </button>)}</div> : null}
          <button type="button" data-variant={a && rivalSuggest?.rows.length ? undefined : 'primary'} disabled={restoring} onClick={() => setPicker('rival')} data-testid="compare-pick-rival">{a && rivalSuggest?.rows.length ? 'ดูแอดคู่แข่งทั้งหมด' : 'เลือกแอดคู่แข่ง'}</button>
        </div>}
      </section>
    </div>

    {a && b ? <>
      {outsideUnit ? <p className={styles.aiWarn}>เพจนี้ยังไม่อยู่ในรายชื่อคู่แข่งของ {unitPages?.unitName} · ใช้ผลนี้ดูวิธีเล่าได้ แต่ข้อเสนอและราคาอาจเทียบกันไม่ได้</p> : null}
      <AiCompare ads={[{ kind: 'own', ad: a }, { kind: 'rival', ad: b }]} images={images} ourThrough={period?.date_end ?? null}
        onCopyLink={() => void copyLink()} linkLabel={shared === 'copied' ? 'คัดลอกลิงก์แล้ว' : 'คัดลอกลิงก์ส่งทีม'} />
      {shared && shared !== 'copied' ? <p className={styles.muted}>คัดลอกอัตโนมัติไม่ได้ · คัดลอกเอง: <span className={styles.shareLink}>{shared}</span></p> : null}
    </> : null}

    <OwnedPicker open={picker === 'own'} onClose={() => setPicker(null)} onPick={chooseOwn} base={base} units={units} falling={falling} worseFirst={worseFirst} selected={a ? ownKey(a) : null} />
    <RivalPicker open={picker === 'rival'} onClose={() => setPicker(null)} onPick={chooseRival} datasets={datasets} match={unitPages} selected={b?.ad_archive_id ?? null} />
  </div>;
}
