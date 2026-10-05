'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PageHeader } from '@/components/shell/PageHeader';
import { Creative } from '../../owned-ads/owned-client';
import { OwnedVideoPlayer } from '../../owned-ads/owned-video-player';
import { AdCreative } from '@/components/AdDrawer';
import type { CompanyAd } from '@/lib/owned-ads/source-rows';
import type { OwnedPerformanceData } from '@/lib/owned-ads/performance';
import { resolveMedia } from '@/lib/media/resolve';
import { summarizeOwnedReport } from '@/lib/owned-ads/model';
import { COMPARISON_DECISIONS, comparisonDraftKey, comparisonSelectionKey, mergeComparisonSelection, parseComparisonDraft, parseComparisonSelection, rivalFromDetail, type ComparisonDraft, type ComparisonSelection, type Rival } from './selection';
import { AiCompare, MAX_COMPARE, compareId, type CompareAd } from './ai-compare';
import styles from './comparison.module.css';

type Dataset = { id: string; name: string; source: string; collected: string; count: number };
type OwnedResult = { rows: CompanyAd[]; total: number; snapshot: { id: string; date_start: string; date_end: string; finished_at: string; accounts: { id: string; name: string }[] } | null };
type Step = 'owned' | 'rival' | 'review';
type Period = { date_start: string; date_end: string };
const DRAFT_CHANGED = 'pt-glory-comparison-draft-changed';
function subscribeDraft(listener: () => void) {
  window.addEventListener(DRAFT_CHANGED, listener);
  window.addEventListener('storage', listener);
  return () => { window.removeEventListener(DRAFT_CHANGED, listener); window.removeEventListener('storage', listener); };
}
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
const ownId = (ad: CompanyAd) => ad.account_id + ':' + ad.ad_id;
const ownName = (ad: CompanyAd) => ad.ad_name.length <= 5 ? ad.title ?? ad.campaign_name ?? ad.ad_name : ad.ad_name;
const rivalImage = (ad: Rival) => {
  const resolved = resolveMedia(ad.display_format, ad.media, { archivePath: ad.archive_path, archiveStatus: ad.archive_status, presentationUrl: ad.archive_url });
  return 'src' in resolved ? resolved.src : null;
};

export function AdComparison({ datasets, seed, initialOwned, initialPeriod, initialRival, initialError, userNamespace, returnHref = '/', performanceSource = false }: {
  datasets: Dataset[]; seed: ComparisonSelection; initialOwned: CompanyAd | null; initialPeriod: Period | null; initialRival: Rival | null; initialError: string; userNamespace: string; returnHref?: string; performanceSource?: boolean;
}) {
  const storageKey = comparisonSelectionKey(userNamespace);
  // The catalog filter and the selected observation have different lifetimes.
  const [dataset, setDataset] = useState('');
  const [owned, setOwned] = useState<OwnedResult | null>(null);
  const [rivals, setRivals] = useState<{ rows: Rival[]; total: number } | null>(null);
  const [ownSearch, setOwnSearch] = useState('');
  const [rivalSearch, setRivalSearch] = useState('');
  const [ownQuery, setOwnQuery] = useState('');
  const [rivalQuery, setRivalQuery] = useState('');
  const [account, setAccount] = useState('');
  const [ownPage, setOwnPage] = useState(0);
  const [rivalPage, setRivalPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [a, setA] = useState<CompanyAd | null>(initialOwned);
  const [period, setPeriod] = useState<Period | null>(initialPeriod);
  const [b, setB] = useState<Rival | null>(initialRival ? { ...initialRival, dataset_id: seed.dataset } : null);
  const [step, setStep] = useState<Step>(initialOwned ? initialRival ? 'review' : 'rival' : 'owned');
  const [restoreError, setRestoreError] = useState(initialError);
  const [restoring, setRestoring] = useState(true);
  const [ownError, setOwnError] = useState('');
  const [rivalError, setRivalError] = useState('');
  const [ownLoadedKey, setOwnLoadedKey] = useState('');
  const [rivalLoadedKey, setRivalLoadedKey] = useState('');
  const ownKey = JSON.stringify([ownQuery, account, ownPage]);
  const rivalKey = JSON.stringify([dataset, rivalQuery, rivalPage]);
  const ownLoading = ownLoadedKey !== ownKey;
  const rivalLoading = rivalLoadedKey !== rivalKey;
  const [extras, setExtras] = useState<CompareAd[]>([]);
  const [adding, setAdding] = useState<'own' | 'rival' | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const [videoIds, setVideoIds] = useState<Record<string, string | null>>({});
  const selection = { account: a?.account_id ?? '', owned: a?.ad_id ?? '', dataset: b?.dataset_id ?? '', rival: b?.ad_archive_id ?? '' };
  const draftKey = comparisonDraftKey(userNamespace, selection);
  const [draft, setDraft] = useState<{ key: string | null; values: ComparisonDraft; unsaved: boolean }>({ key: null, values: parseComparisonDraft(null), unsaved: false });
  const serializedDraft = useSyncExternalStore(subscribeDraft, useCallback(() => {
    try { return draftKey ? sessionStorage.getItem(draftKey) ?? '' : ''; }
    catch { return null; }
  }, [draftKey]), () => '');
  let draftValues = draft.key === draftKey ? draft.values : parseComparisonDraft(null);
  const memoryDraft = draft.key === draftKey && draft.unsaved;
  let draftUnavailable = serializedDraft === null || memoryDraft;
  if (serializedDraft !== null && !memoryDraft) {
    try { draftValues = parseComparisonDraft(JSON.parse(serializedDraft || '{}')); }
    catch { draftUnavailable = true; }
  }
  const { product, ourOffer, theirOffer, decision, hypothesis, success } = draftValues;
  const focusStep = useRef<Step | null>(null);
  const ownHeading = useRef<HTMLHeadingElement>(null);
  const rivalHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  const readOwned = useCallback(async (q: string, accountId: string, page: number, signal: AbortSignal): Promise<OwnedResult> => {
    const filters = performanceSource ? new URLSearchParams(new URL(returnHref, 'https://pt-glory.invalid').search) : new URLSearchParams({ account: accountId, spend: 'reported' });
    filters.set('q', q); filters.set('page', String(page)); filters.delete('compare');
    const response = await fetch((performanceSource ? '/api/owned-ads/performance?' : '/api/owned-ads/library?') + filters, { signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'เปิดแอดของเราไม่สำเร็จ');
    if (!performanceSource) return result;
    const data = result as OwnedPerformanceData;
    return { rows: data.rows, total: data.total, snapshot: data.snapshot ? { ...data.snapshot, date_start: data.period.from, date_end: data.period.to, accounts: [] } : null };
  }, [performanceSource, returnHref]);

  function openStep(next: Step) { focusStep.current = next; setStep(next); }
  // The pair (a, b) anchors the page; extras ride along for the AI table only (not kept in the URL).
  const compareAds: CompareAd[] = a && b ? [{ kind: 'own', ad: a }, ...extras.filter(item => item.kind === 'own'), { kind: 'rival', ad: b }, ...extras.filter(item => item.kind === 'rival')] : [];
  function addCompare(item: CompareAd) {
    if (compareAds.length < MAX_COMPARE && !compareAds.some(other => compareId(other) === compareId(item))) setExtras([...extras, item]);
    setAdding(null); openStep('review');
  }
  function removeCompare(item: CompareAd) {
    const next = extras.find(other => other.kind === item.kind);
    if (a && item.kind === 'own' && compareId(item) === compareId({ kind: 'own', ad: a })) { if (next?.kind === 'own') { setA(next.ad); setExtras(extras.filter(other => other !== next)); } return; }
    if (b && item.kind === 'rival' && compareId(item) === compareId({ kind: 'rival', ad: b })) { if (next?.kind === 'rival') { setB(next.ad); setExtras(extras.filter(other => other !== next)); } return; }
    setExtras(extras.filter(other => compareId(other) !== compareId(item)));
  }

  useEffect(() => {
    if (focusStep.current !== step) return;
    focusStep.current = null;
    const heading = step === 'owned' ? ownHeading.current : step === 'rival' ? rivalHeading.current : reviewHeading.current;
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [step]);

  function updateDraft(field: keyof ComparisonDraft, value: string) {
    if (!draftKey) return;
    const values = parseComparisonDraft({ ...draftValues, [field]: value });
    let unsaved = false;
    try { sessionStorage.setItem(draftKey, JSON.stringify(values)); }
    catch { unsaved = true; }
    setDraft({ key: draftKey, values, unsaved });
    window.dispatchEvent(new Event(DRAFT_CHANGED));
  }

  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      let saved = parseComparisonSelection({});
      try { if (storageKey) saved = parseComparisonSelection(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')); } catch { /* A blocked store does not prevent comparison. */ }
      const next = mergeComparisonSelection(saved, seed);
      let own = initialOwned;
      let ownPeriod = initialPeriod;
      let rival = initialRival ? { ...initialRival, dataset_id: seed.dataset } : null;
      try {
        await Promise.all([
          !own && !seed.owned && next.owned ? readOwned(next.owned, next.account, 0, controller.signal)
            .then(result => { own = result.rows.find(row => row.account_id === next.account && row.ad_id === next.owned) ?? null; ownPeriod = own ? result.snapshot : null; }) : null,
          !rival && !seed.rival && next.rival && datasets.some(item => item.id === next.dataset) ? fetch('/api/ads/' + next.rival + '?datasetId=' + next.dataset, { signal: controller.signal })
            .then(async response => { if (!response.ok) throw new Error(); const result = await response.json(); rival = { ...rivalFromDetail(result.detail), dataset_id: next.dataset }; }) : null,
        ]);
        if (!controller.signal.aborted) {
          setA(own); setPeriod(ownPeriod); setB(rival);
          setStep(own ? rival ? 'review' : 'rival' : 'owned');
        }
      } catch { if (!controller.signal.aborted) setRestoreError('เปิดแอดที่เลือกไว้ไม่สำเร็จ สามารถเลือกใหม่จากรายการได้'); }
      finally { if (!controller.signal.aborted) setRestoring(false); }
    }
    void restore();
    return () => controller.abort();
  }, [datasets, seed, initialOwned, initialPeriod, initialRival, storageKey, readOwned]);

  useEffect(() => {
    if (restoring) return;
    // Keep identifiers only; the authenticated APIs recheck access on return.
    try { if (storageKey) sessionStorage.setItem(storageKey, JSON.stringify({ account: a?.account_id ?? '', owned: a?.ad_id ?? '', dataset: b?.dataset_id ?? '', rival: b?.ad_archive_id ?? '' })); } catch { /* Optional browsing convenience. */ }
    const url = new URL(window.location.href);
    if (url.pathname === '/compare/ads') {
      for (const [key, value] of Object.entries({ account: a?.account_id ?? '', owned: a?.ad_id ?? '', dataset: b?.dataset_id ?? '', rival: b?.ad_archive_id ?? '' })) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
  }, [a, b, storageKey, restoring]);

  useEffect(() => {
    const controller = new AbortController();
    readOwned(ownQuery, account, ownPage, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) { setOwned(data); setOwnError(''); }
      }).catch(error => { if (!controller.signal.aborted) setOwnError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setOwnLoadedKey(ownKey); });
    return () => controller.abort();
  }, [ownQuery, account, ownPage, ownKey, refresh, readOwned]);

  useEffect(() => {
    const controller = new AbortController();
    const url = dataset ? '/api/datasets/' + dataset + '/ads' : '/api/catalog/ads';
    fetch(url + '?' + new URLSearchParams({ search: rivalQuery, offset: String(rivalPage * 24), limit: '24' }), { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'เปิดแอดคู่แข่งไม่สำเร็จ');
        if (!controller.signal.aborted) {
          const source = datasets.find(item => item.id === dataset);
          setRivals({ ...data, rows: data.rows.map((ad: Rival) => dataset ? { ...ad, dataset_id: dataset, dataset_name: source?.name, collected_at: source?.collected } : ad) });
          setRivalError('');
        }
      }).catch(error => { if (!controller.signal.aborted) setRivalError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setRivalLoadedKey(rivalKey); });
    return () => controller.abort();
  }, [dataset, datasets, rivalQuery, rivalPage, rivalKey, refresh]);

  useEffect(() => {
    const rows = [...new Map([...(a ? [a] : []), ...(step === 'owned' ? owned?.rows ?? [] : [])].map(row => [ownId(row), row])).values()];
    if (!rows.length) return;
    const controller = new AbortController();
    async function load() {
      for (let offset = 0; offset < rows.length && !controller.signal.aborted; offset += 4) {
        try {
          const response = await fetch('/api/owned-ads/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ items: rows.slice(offset, offset + 4).map(({ account_id, ad_id }) => ({ account_id, ad_id })) }) });
          if (!response.ok) continue;
          const data = await response.json();
          if (!controller.signal.aborted) {
            setImages(previous => ({ ...previous, ...Object.fromEntries(data.items.filter((item: { url: string | null }) => item.url).map((item: { account_id: string; ad_id: string; url: string }) => [item.account_id + ':' + item.ad_id, item.url])) }));
            setVideoIds(previous => ({ ...previous, ...Object.fromEntries(data.items.map((item: { account_id: string; ad_id: string; video_id?: string | null }) => [item.account_id + ':' + item.ad_id, item.video_id ?? null])) }));
          }
        } catch { /* Keep the source thumbnail when Meta is unavailable. */ }
      }
    }
    void load();
    return () => controller.abort();
  }, [owned?.rows, a, step]);

  const selectedDataset = datasets.find(item => item.id === b?.dataset_id);
  const selectedCollected = b?.collected_at ?? selectedDataset?.collected;
  const metrics = a ? summarizeOwnedReport([a]) : null;
  function download() {
    if (!a || !b) return;
    const text = [
      '# เปรียบเทียบแอด: ' + a.ad_name + ' / ' + (b.page_name ?? b.page_id), 'บันทึกเมื่อ ' + new Date().toISOString(),
      'แอดเรา: ' + a.account_id + ' / ' + a.ad_id, 'ผลลัพธ์: ' + (period?.date_start ?? '—') + ' — ' + (period?.date_end ?? '—'),
      'ค่าแอด: ' + number(a.spend) + ' ' + a.currency + '; ROAS (Meta): ' + number(metrics?.roas.value),
      'คู่แข่ง: ' + b.ad_archive_id + '; dataset: ' + b.dataset_id + '; เก็บเมื่อ: ' + (selectedCollected ?? '—'),
      'ข้อความเรา: ' + (a.body_text ?? 'ไม่มีข้อมูล'), 'ข้อความคู่แข่ง: ' + (b.body_text ?? 'ไม่มีข้อมูล'),
      'สินค้าหรือความต้องการ (ทีมระบุ): ' + product, 'ข้อเสนอเรา (ทีมระบุ): ' + ourOffer, 'ข้อเสนอคู่แข่ง (ทีมระบุ): ' + theirOffer,
      'แนวทางที่เลือก: ' + decision, 'สมมติฐานและเหตุผล: ' + hypothesis, 'เกณฑ์ประเมิน: ' + success,
      'ยังไม่มีข้อมูลค่าแอด ยอดขาย หรือ ROAS ของคู่แข่ง; บันทึกนี้ไม่เปลี่ยนแอดจริง',
    ].join('\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'ad-comparison.md'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={styles.workspace}>
    <PageHeader title="พื้นที่เปรียบเทียบแอด" description="ดูภาพ ข้อความ และข้อเสนอของสองฝั่ง แล้วเขียนสิ่งที่จะทดลองกับแอดเรา" actions={<Link data-testid="comparison-return" href={returnHref}>{['/','/market-overview'].includes(new URL(returnHref,'https://pt-glory.invalid').pathname)?'กลับภาพรวม':'กลับคลังที่เลือกแอด'}</Link>} />
    <nav className={styles.steps} aria-label="ขั้นตอนเปรียบเทียบ">
      {(['owned', 'rival', 'review'] as const).map((value, index) => <button type="button" key={value} data-testid={'compare-step-' + value} aria-current={step === value ? 'step' : undefined} disabled={restoring || value === 'review' && (!a || !b)} onClick={() => openStep(value)}>
        <span className={styles.stepNumber}>{index < 2 && (index === 0 ? a : b) ? '✓' : index + 1}</span>
        <span>{['เลือกแอดเรา', 'เลือกแอดคู่แข่ง', 'สรุปและวางแผน'][index]}</span>
      </button>)}
    </nav>
    {restoreError ? <p className={styles.notice} role="alert">{restoreError} <button type="button" onClick={() => setRestoreError('')}>ปิด</button></p> : null}
    {restoring ? <p role="status" className={styles.muted}>กำลังเปิดแอดที่เลือกไว้…</p> : null}
    {adding && step !== 'review' ? <p className={styles.notice} role="status">กำลังเลือก{adding === 'own' ? 'แอดของเรา' : 'แอดคู่แข่ง'}เพิ่มเพื่อเทียบด้วย AI ({compareAds.length}/{MAX_COMPARE}) <button type="button" onClick={() => { setAdding(null); openStep('review'); }}>ยกเลิก</button></p> : null}

    {step !== 'review' ? <aside className={styles.context} aria-label="แอดที่เลือกเปรียบเทียบ" data-testid="compare-selection-tray">
      <div className={styles.contextPair}>
        <div className={styles.contextAd}>
          <div className={styles.contextImage}>{a ? <Creative url={images[ownId(a)] ?? a.creative_url} name={a.ad_name} sizes="90px" /> : <span aria-hidden>1</span>}</div>
          <div><span className={styles.sideLabel}>แอดของเรา</span><strong>{a ? ownName(a) : 'เลือกแอดที่ต้องการวิเคราะห์'}</strong><p>{a?.body_text ?? a?.page_name ?? 'ค้นจากชื่อสินค้า แคมเปญ หรือเพจ'}</p><button type="button" disabled={restoring} onClick={() => openStep('owned')}>{a ? 'เปลี่ยนแอดเรา' : 'เลือกแอดเรา'}</button></div>
        </div>
        <div className={styles.contextAd}>
          <div className={styles.contextImage}>{b ? <Creative url={rivalImage(b)} name={b.page_name ?? b.ad_archive_id} sizes="90px" /> : <span aria-hidden>2</span>}</div>
          <div><span className={styles.sideLabel}>แอดคู่แข่ง</span><strong>{b?.page_name ?? 'เลือกแอดที่อยากนำมาเทียบ'}</strong><p>{b?.body_text ?? 'ค้นจากคลังคู่แข่งทั้งหมดได้เลย'}</p><button type="button" disabled={restoring} onClick={() => openStep('rival')}>{b ? 'เปลี่ยนแอดคู่แข่ง' : 'เลือกแอดคู่แข่ง'}</button></div>
        </div>
      </div>
      {a && b ? <div className={styles.contextActions}><span>คู่แอดที่เลือกและร่างการทดลองยังอยู่</span><button type="button" data-variant="primary" disabled={restoring} onClick={() => openStep('review')}>ดูคู่แอดและเขียนแผนทดลอง →</button></div> : null}
    </aside> : null}

    {step === 'owned' ? <section className={styles.panel} aria-labelledby="compare-own-heading">
      <div className={styles.sectionHead}><div><h2 id="compare-own-heading" ref={ownHeading} tabIndex={-1}>เลือกแอดของเราที่อยากวิเคราะห์</h2><p>{performanceSource ? 'ใช้ช่วงวันที่ ยูนิต เพจ และสถานะจากคลังที่เลือก' : 'แอดที่มีค่าใช้จ่ายในช่วงผลลัพธ์ · เรียงตามค่าโฆษณา'}{owned?.snapshot ? ` · ${owned.snapshot.date_start} — ${owned.snapshot.date_end}` : ''}</p></div><Link href={performanceSource ? returnHref : '/owned-ads'}>เปิดคลังแอดของเรา ↗</Link></div>
      <form className={styles.search} onSubmit={event => { event.preventDefault(); setOwnQuery(ownSearch); setOwnPage(0); }}>
        <label htmlFor="compare-own-search">ค้นหาแอดเรา<input id="compare-own-search" type="search" data-testid="compare-owned-search" value={ownSearch} maxLength={160} onChange={event => setOwnSearch(event.target.value)} placeholder="ชื่อสินค้า ชื่อแอด แคมเปญ หรือเพจ" /></label>
        <button type="submit">ค้นหาแอดเรา</button>
      </form>
      {!performanceSource ? <details className={styles.filters}><summary>ตัวกรองเพิ่มเติม{account ? ' · เลือกบัญชีแล้ว' : ''}</summary><label>บัญชีโฆษณา<select value={account} onChange={event => { setAccount(event.target.value); setOwnPage(0); }}><option value="">ทุกบัญชี</option>{owned?.snapshot?.accounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></details> : null}
      {ownError ? <p role="alert">{ownError} <button type="button" onClick={() => setRefresh(value => value + 1)}>ลองใหม่</button></p> : ownLoading ? <p role="status" className={styles.loading}>กำลังเปิดแอดของเรา…</p> : <>
        <p className={styles.resultCount}>พบ {number(owned?.total ?? 0)} แอด{a ? ' · แอดที่เลือกยังอยู่ แม้เปลี่ยนคำค้น' : ''}</p>
        <div className={styles.grid} data-testid="compare-owned-grid">{owned?.rows.map(ad => <button type="button" key={ownId(ad)} className={styles.choice} data-testid={'compare-own-' + ad.ad_id} disabled={restoring} aria-pressed={a ? ownId(a) === ownId(ad) : false} onClick={() => { if (adding === 'own') { addCompare({ kind: 'own', ad }); return; } setA(ad); setPeriod(owned.snapshot); openStep(b ? 'review' : 'rival'); }}>
          <Creative url={images[ownId(ad)] ?? ad.creative_url} name={ad.ad_name} />
          <span className={styles.cardBody}><strong>{ownName(ad)}</strong><span className={styles.cardMeta}>{ad.page_name ?? ad.account_name}</span><span className={styles.cardCopy}>{ad.body_text ?? ad.campaign_name}</span><span className={styles.cardStats}><span>ค่าแอด<strong>{number(ad.spend)} {ad.currency}</strong></span><span>ROAS (Meta)<strong>{number(summarizeOwnedReport([ad]).roas.value)}</strong></span></span><span className={styles.choose}>{a && ownId(a) === ownId(ad) ? '✓ เลือกไว้แล้ว' : 'เลือกแอดนี้ →'}</span></span>
        </button>)}</div>
        {owned?.snapshot && owned.total === 0 ? <p className={styles.empty} data-testid="compare-owned-empty">ไม่พบแอด ลองค้นด้วยชื่อสินค้าหรือเลือกทุกบัญชี</p> : null}
        {!owned?.snapshot ? <p className={styles.empty}>ยังไม่มีข้อมูลแอดของเรา <Link href="/owned-ads">เชื่อมข้อมูลแอดของเรา</Link></p> : null}
        <Pager page={ownPage} total={owned?.total ?? 0} change={setOwnPage} name="owned" />
      </>}
    </section> : null}

    {step === 'rival' ? <section className={styles.panel} aria-labelledby="compare-rival-heading">
      <div className={styles.sectionHead}><div><h2 id="compare-rival-heading" ref={rivalHeading} tabIndex={-1}>เลือกแอดคู่แข่งที่น่าสนใจ</h2><p>ค้นจากคู่แข่งทั้งหมด · มองหาสินค้า ข้อเสนอ หรือวิธีเล่าที่ใกล้เคียงกับแอดเรา</p></div><Link href="/competitors">ส่องคู่แข่งเพิ่มเติม ↗</Link></div>
      <form className={styles.search} onSubmit={event => { event.preventDefault(); setRivalQuery(rivalSearch); setRivalPage(0); }}>
        <label htmlFor="compare-rival-search">ค้นหาแอดคู่แข่ง<input id="compare-rival-search" type="search" data-testid="compare-rival-search" value={rivalSearch} maxLength={160} onChange={event => setRivalSearch(event.target.value)} placeholder="ชื่อสินค้า ชื่อเพจ หรือข้อความในแอด" /></label><button type="submit">ค้นหาแอดคู่แข่ง</button>
      </form>
      <details className={styles.filters}><summary>ตัวกรองเพิ่มเติม{dataset ? ' · จำกัดแหล่งข้อมูลแล้ว' : ''}</summary><label>แหล่งข้อมูลที่ต้องการค้น<select data-testid="compare-dataset" value={dataset} onChange={event => { setDataset(event.target.value); setRivalPage(0); }}><option value="">คลังคู่แข่งทั้งหมด</option>{datasets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p className={styles.muted}>การเปลี่ยนตัวกรองจะไม่เปลี่ยนแอดที่เลือกเปรียบเทียบไว้</p></details>
      {rivalError ? <p role="alert">{rivalError} <button type="button" onClick={() => setRefresh(value => value + 1)}>ลองใหม่</button></p> : rivalLoading ? <p role="status" className={styles.loading}>กำลังเปิดแอดคู่แข่ง…</p> : <>
        <p className={styles.resultCount} data-testid="compare-rival-scope">{dataset ? 'ค้นในแหล่งข้อมูลที่เลือก' : 'ค้นในคลังคู่แข่งทั้งหมด'} · พบ {number(rivals?.total ?? 0)} แอด</p>
        <div className={styles.grid} data-testid="compare-rival-grid">{rivals?.rows.map(ad => <button type="button" key={ad.dataset_id + ':' + ad.ad_archive_id} className={styles.choice} data-testid={'compare-rival-' + ad.ad_archive_id} disabled={restoring || !ad.dataset_id} aria-pressed={b?.ad_archive_id === ad.ad_archive_id && b?.dataset_id === ad.dataset_id} onClick={() => { if (adding === 'rival') { addCompare({ kind: 'rival', ad }); return; } setB(ad); openStep(a ? 'review' : 'owned'); }}>
          <Creative url={rivalImage(ad)} name={ad.page_name ?? ad.ad_archive_id} />
          <span className={styles.cardBody}><strong>{ad.page_name ?? 'ไม่ทราบชื่อเพจ'}</strong><span className={styles.cardCopy}>{ad.title ?? ad.body_text ?? 'ไม่มีข้อความที่บันทึกไว้'}</span><span className={styles.cardMeta}>{ad.is_active === null ? 'ไม่ทราบสถานะ' : ad.is_active ? 'กำลังใช้งาน' : 'ไม่ใช้งาน'} · {ad.display_format ?? 'ไม่ระบุรูปแบบ'}</span><span className={styles.choose}>{b?.ad_archive_id === ad.ad_archive_id && b?.dataset_id === ad.dataset_id ? '✓ เลือกไว้แล้ว' : 'เลือกแอดนี้ →'}</span></span>
        </button>)}</div>
        {rivals?.total === 0 ? <p className={styles.empty} data-testid="compare-rival-empty">{rivalQuery || dataset ? 'ไม่พบแอดคู่แข่ง ลองค้นด้วยคำอื่นหรือเลือกคลังคู่แข่งทั้งหมด' : <>ยังไม่มีข้อมูลคู่แข่ง <Link href="/competitors">เปิดคลังคู่แข่ง</Link></>}</p> : null}
        <Pager page={rivalPage} total={rivals?.total ?? 0} change={setRivalPage} name="rival" />
      </>}
    </section> : null}

    {step === 'review' && a && b ? <>
      <section className={styles.panel} aria-labelledby="compare-review-heading">
        <div className={styles.reviewHead}><div><h2 id="compare-review-heading" ref={reviewHeading} tabIndex={-1}>ภาพและข้อความของคู่แอดที่เลือก</h2><p>ดูหลักฐานของสองฝั่ง แล้วระบุสิ่งที่ต้องการนำมาเทียบและทดลอง</p></div><button type="button" onClick={() => { const heading = document.getElementById('compare-plan-heading'); heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'start' }); }}>ไปเขียนแผนทดลอง ↓</button></div>
        <label>สิ่งที่ต้องการนำมาเทียบ <span className={styles.manual}>ทีมระบุ</span><input data-testid="compare-product" maxLength={200} value={product} onChange={event => updateDraft('product', event.target.value)} placeholder="เช่น ความต้องการลูกค้า ข้อเสนอ หรือวิธีเล่าเรื่อง แม้เป็นคนละกลุ่มสินค้า" /></label>
      </section>
      <div className={styles.columns}>
        <section className={styles.panel} data-testid="compare-owned-evidence">
          <div className={styles.sectionHead}><div><span className={styles.sideLabel}>01 · แอดของเรา</span><h3 className={styles.evidenceTitle}>{ownName(a)}</h3><p>{a.page_name ?? a.account_name}</p></div><button type="button" onClick={() => openStep('owned')}>เปลี่ยนแอด</button></div>
          <div className={styles.evidenceMedia}><OwnedVideoPlayer key={ownId(a)} ad={{...a,video_id:videoIds[ownId(a)]??a.video_id}} url={images[ownId(a)] ?? a.creative_url} /></div>
          <div className={styles.message}><h3>ข้อความในแอด</h3>{a.title ? <p className={styles.copyTitle}>{a.title}</p> : null}<p className={styles.copy} tabIndex={0} aria-label="ข้อความแอดของเราฉบับเต็ม เลื่อนอ่านได้" data-testid="compare-owned-copy">{a.body_text ?? 'ไม่มีข้อความในต้นทาง'}</p></div>
          <label>ข้อเสนอของเรา <span className={styles.manual}>ทีมระบุ</span><textarea data-testid="compare-our-offer" maxLength={2000} value={ourOffer} onChange={event => updateDraft('ourOffer', event.target.value)} placeholder="เช่น ราคา จำนวนสินค้า ของแถม หรือเงื่อนไขที่เห็นในแอด" /></label>
          <div className={styles.metricsLabel}>ผลลัพธ์แอดของเรา · {period?.date_start ?? '—'} — {period?.date_end ?? '—'}</div>
          <dl className={styles.facts}><div><dt>ค่าแอด ({a.currency})</dt><dd>{number(a.spend)}</dd></div><div><dt>ROAS (Meta)</dt><dd>{number(metrics?.roas.value)}</dd></div><div><dt>บทสนทนา</dt><dd>{number(a.conversations)}</dd></div><div><dt>ต้นทุนต่อบทสนทนา ({a.currency})</dt><dd>{a.spend != null && a.conversations ? number(a.spend / a.conversations) : '—'}</dd></div></dl>
          <p className={styles.source}>{a.account_name} · Ad {a.ad_id} · {a.status ?? 'ไม่ทราบสถานะ'}</p>
        </section>
        <section className={styles.panel} data-testid="compare-rival-evidence">
          <div className={styles.sectionHead}><div><span className={styles.sideLabel}>02 · แอดคู่แข่ง</span><h3 className={styles.evidenceTitle}>{b.page_name ?? b.page_id}</h3><p>{b.is_active === null ? 'ไม่ทราบสถานะ' : b.is_active ? 'พบว่ากำลังใช้งาน' : 'พบว่าไม่ใช้งาน'} · {b.display_format ?? 'ไม่ระบุรูปแบบ'}</p></div><button type="button" onClick={() => openStep('rival')}>เปลี่ยนแอด</button></div>
          <div className={styles.evidenceMedia} data-testid="compare-rival-media"><AdCreative detail={b} /></div>
          <div className={styles.message}><h3>ข้อความในแอด</h3>{b.title ? <p className={styles.copyTitle}>{b.title}</p> : null}<p className={styles.copy} tabIndex={0} aria-label="ข้อความแอดคู่แข่งฉบับเต็ม เลื่อนอ่านได้" data-testid="compare-rival-copy">{b.body_text ?? 'ไม่มีข้อความที่บันทึกไว้'}</p></div>
          <label>ข้อเสนอคู่แข่ง <span className={styles.manual}>ทีมระบุ</span><textarea data-testid="compare-their-offer" maxLength={2000} value={theirOffer} onChange={event => updateDraft('theirOffer', event.target.value)} placeholder="ระบุเฉพาะข้อเสนอหรือเงื่อนไขที่พบในแอดนี้" /></label>
          <dl className={styles.facts}><div><dt>คำชวนให้ทำต่อ (CTA)</dt><dd>{b.cta_text ?? b.cta_type ?? '—'}</dd></div><div><dt>ช่องทางที่พบ</dt><dd>{b.publisher_platform.join(' · ') || '—'}</dd></div></dl>
          <p className={styles.muted}>ค่าแอด ยอดขาย และ ROAS คู่แข่งยังไม่มีข้อมูล</p>
          <p className={styles.source}>เก็บเมื่อ {selectedCollected ? new Date(selectedCollected).toLocaleString('th-TH') : '—'} · Library ID {b.ad_archive_id}<br />{b.dataset_name ?? selectedDataset?.name ?? 'ไม่ทราบชื่อแหล่งข้อมูล'}</p>
          <Link href={'/pages/' + b.page_id + '?scope=dataset:' + b.dataset_id}>ดูเพจและติดตามคู่แข่ง ↗</Link>
        </section>
      </div>
      <AiCompare ads={compareAds} images={images} ourThrough={period?.date_end ?? null}
        onAdd={kind => { setAdding(kind); openStep(kind === 'own' ? 'owned' : 'rival'); }} onRemove={removeCompare}
        onIdea={text => { updateDraft('hypothesis', hypothesis ? hypothesis + '\n' + text : text); const heading = document.getElementById('compare-plan-heading'); heading?.focus({ preventScroll: true }); heading?.scrollIntoView({ block: 'start' }); }} />
      <section id="compare-plan" className={styles.panel} data-testid="compare-business">
        <div className={styles.sectionHead}><div><span className={styles.sideLabel}>03 · แผนทดลองของทีม</span><h2 id="compare-plan-heading" tabIndex={-1}>เราจะทดลองอะไรต่อ?</h2><p>ระบุเหตุผลจากคู่แอดนี้ แล้วกำหนดสิ่งที่จะวัดด้วยข้อมูลของเรา</p></div><span className={styles.draftState} data-testid="compare-draft-status">{draftUnavailable ? 'บันทึกร่างในเบราว์เซอร์ไม่ได้ · ดาวน์โหลดแผนเก็บไว้ได้' : 'เก็บร่างอัตโนมัติในเบราว์เซอร์นี้ · แยกตามคู่แอด'}</span></div>
        <label>สิ่งที่จะทำกับแอดเรา<select data-testid="compare-decision" value={decision} onChange={event => updateDraft('decision', event.target.value)}><option value="">เลือกแนวทางที่ทีมต้องการทดลอง</option>{COMPARISON_DECISIONS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>เหตุผลหรือสมมติฐานที่จะทดสอบ<textarea data-testid="compare-hypothesis" maxLength={4000} value={hypothesis} onChange={event => updateDraft('hypothesis', event.target.value)} placeholder="เช่น คู่แข่งเล่าปัญหาลูกค้าชัดกว่า จึงทดลองข้อความเปิดใหม่ โดยคงข้อเสนอและกลุ่มเป้าหมายเดิม" /></label>
        <label>วัดผลด้วยอะไรและเมื่อไร<textarea data-testid="compare-success" maxLength={1000} value={success} onChange={event => updateDraft('success', event.target.value)} placeholder="เช่น เปรียบเทียบต้นทุนต่อบทสนทนาและ ROAS ของเรา หลังทดลอง 7 วัน" /></label>
        <div className={styles.saveRow}><button type="button" data-variant="primary" data-testid="compare-download" onClick={download}>ดาวน์โหลดแผนทดลอง</button><p className={styles.muted}>ส่งให้ทีมพิจารณาต่อได้ · บันทึกนี้ไม่เปลี่ยนแอดหรืองบจริง</p></div>
      </section>
    </> : null}
  </div>;
}

function Pager({ page, total, change, name }: { page: number; total: number; change: (page: number) => void; name: string }) {
  return <div className={styles.pager}><button type="button" data-testid={'compare-' + name + '-prev'} disabled={page === 0} onClick={() => change(page - 1)}>ก่อนหน้า</button><span>หน้า {number(page + 1)} / {number(Math.max(1, Math.ceil(total / 24)))}</span><button type="button" data-testid={'compare-' + name + '-next'} disabled={(page + 1) * 24 >= total} onClick={() => change(page + 1)}>ถัดไป</button></div>;
}


