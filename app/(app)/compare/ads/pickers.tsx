'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Creative } from '../../owned-ads/owned-client';
import { AdCard } from '@/components/AdCard';
import type { OwnedPerformanceData, OwnedPerformanceRow } from '@/lib/owned-ads/performance';
import type { CommandAd } from '@/lib/owned-ads/command-center';
import { summarizeOwnedReport } from '@/lib/owned-ads/model';
import { ownedName, type Rival } from './selection';
import styles from './comparison.module.css';

const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
export const ownKey = (ad: { account_id: string; ad_id: string }) => ad.account_id + ':' + ad.ad_id;
/** Ads that run the same video or creative are one choice: the team compares pictures, not ad ids. */
export const creativeKey = (ad: { account_id: string; ad_id: string; video_id?: string | null; creative_id?: string | null }) => ad.video_id || ad.creative_id || ownKey(ad);

export type OwnedChoice = OwnedPerformanceRow & { group_size?: number };

/** A side panel over the compare screen; picking closes it and the screen stays put. */
function Panel({ title, note, open, onClose, children }: { title: string; note: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className={styles.picker} aria-labelledby="picker-title" onClose={onClose}>
    <header className={styles.pickerHead}>
      <div><h2 id="picker-title">{title}</h2><p>{note}</p></div>
      <button type="button" onClick={onClose}>ปิด</button>
    </header>
    {open ? children : null}
  </dialog>;
}

/** Group the rows on screen by creative; the biggest spender stands for the group. */
function groupRows(rows: OwnedPerformanceRow[]): OwnedChoice[] {
  const groups = new Map<string, OwnedPerformanceRow[]>();
  for (const row of rows) groups.set(creativeKey(row), [...(groups.get(creativeKey(row)) ?? []), row]);
  return [...groups.values()].map(list => ({ ...list[0], group_size: list.length }));
}

type OwnedPickerProps = {
  onPick: (ad: OwnedChoice) => void;
  /** Period and any library filters the compare screen was opened with. */
  base: URLSearchParams;
  units: { id: string; name: string }[];
  falling: CommandAd[];
  worseFirst: boolean;
  selected: string | null;
};

// The body mounts each time the panel opens, so every opening starts from its own defaults.
export function OwnedPicker({ open, onClose, ...props }: OwnedPickerProps & { open: boolean; onClose: () => void }) {
  return <Panel open={open} onClose={onClose} title="เลือกแอดของเรา" note="แอดที่ใช้ภาพหรือวิดีโอเดียวกันรวมเป็นการ์ดเดียว · เรียงตามค่าแอด"><OwnedPickerBody {...props} /></Panel>;
}

function OwnedPickerBody({ onPick, base, units, falling, worseFirst, selected }: OwnedPickerProps) {

  const [unit, setUnit] = useState(base.get('unit') ?? '');
  const [worse, setWorse] = useState(worseFirst);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ key: string; data: OwnedPerformanceData } | null>(null);
  const [problem, setProblem] = useState('');
  const [media, setMedia] = useState<Record<string, string | null>>({});

  const params = new URLSearchParams(base);
  params.set('sort', 'spend'); params.set('page', String(page)); params.delete('compare');
  if (unit) params.set('unit', unit); else params.delete('unit');
  if (query) params.set('q', query); else params.delete('q');
  const key = params.toString();

  useEffect(() => {
    if (worse) return;
    const controller = new AbortController();
    fetch('/api/owned-ads/performance?' + key, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'เปิดแอดของเราไม่สำเร็จ');
        if (!controller.signal.aborted) { setResult({ key, data: body }); setProblem(''); }
      }).catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setProblem(error.message); });
    return () => controller.abort();
  }, [worse, key]);

  const fallingRows = falling
    .filter(ad => !unit || ad.unit_ids.includes(unit))
    .filter(ad => !query || (ad.ad_name + ' ' + (ad.title ?? '') + ' ' + (ad.campaign_name ?? '') + ' ' + ad.ad_id).toLowerCase().includes(query.toLowerCase())) as unknown as OwnedPerformanceRow[];
  const loading = !worse && result?.key !== key && !problem;
  const rows = groupRows(worse ? fallingRows : result?.key === key ? result.data.rows : []);
  const total = worse ? rows.length : result?.data.total ?? 0;
  const pageSize = result?.data.pageSize ?? 24;
  const fallingBy = new Map(falling.map(ad => [ownKey(ad), ad]));

  // Fresh thumbnails, four at a time, like the library.
  useEffect(() => {
    const missing = rows.filter(row => !Object.hasOwn(media, ownKey(row))).map(({ account_id, ad_id }) => ({ account_id, ad_id }));
    if (!missing.length) return;
    const controller = new AbortController();
    (async () => {
      for (let offset = 0; offset < missing.length && !controller.signal.aborted; offset += 4) {
        const items = missing.slice(offset, offset + 4);
        try {
          const response = await fetch('/api/owned-ads/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }), signal: controller.signal });
          if (!response.ok) throw new Error();
          const body = await response.json();
          if (!controller.signal.aborted) setMedia(previous => ({ ...previous, ...Object.fromEntries(body.items.map((item: { account_id: string; ad_id: string; url: string | null }) => [ownKey(item), item.url])) }));
        } catch { if (!controller.signal.aborted) setMedia(previous => ({ ...previous, ...Object.fromEntries(items.map(item => [ownKey(item), null])) })); }
      }
    })();
    return () => controller.abort();
    // The rows on screen decide what to load; cached entries do not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map(ownKey).join('|')]);

  return <>
    <div className={styles.pickerTools}>
      <div className={styles.chips} role="group" aria-label="ยูนิต">
        {[{ id: '', name: 'ทุกยูนิต' }, ...units].map(item => <button type="button" key={item.id || 'all'} aria-pressed={unit === item.id} onClick={() => { setUnit(item.id); setPage(0); }}>{item.name}</button>)}
      </div>
      <label className={styles.check}><input type="checkbox" checked={worse} onChange={event => { setWorse(event.target.checked); setPage(0); }} />เฉพาะแอดที่ผลแย่ลง ({number(new Set(falling.map(creativeKey)).size)} ครีเอทีฟ)</label>
      <form className={styles.search} onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(0); }}>
        <label htmlFor="picker-own-search">ค้นหาแอดเรา<input id="picker-own-search" type="search" value={search} maxLength={160} onChange={event => setSearch(event.target.value)} placeholder="ชื่อแอด สินค้า แคมเปญ หรือ Ad ID" /></label>
        <button type="submit">ค้นหา</button>
      </form>
    </div>
    {problem ? <p role="alert">{problem}</p> : loading ? <p role="status" className={styles.loading}>กำลังเปิดแอดของเรา…</p> : <>
      <p className={styles.resultCount}>{worse ? `${number(rows.length)} ครีเอทีฟที่ ROAS ลดลง` : `${number(total)} แอด · หน้านี้ ${number(rows.length)} ครีเอทีฟ`}</p>
      <div className={styles.pickList}>{rows.map(ad => {
        const drop = fallingBy.get(ownKey(ad));
        const roas = summarizeOwnedReport([ad]).roas.value;
        return <button type="button" key={ownKey(ad)} className={styles.pickRow} aria-pressed={selected === ownKey(ad)} onClick={() => onPick(ad)} data-testid={'pick-own-' + ad.ad_id}>
          <span className={styles.pickThumb}><Creative url={media[ownKey(ad)] ?? ad.creative_url} name={ad.ad_name} sizes="64px" /></span>
          <span className={styles.pickBody}>
            <strong>{ownedName(ad)}</strong>
            <span className={styles.muted}>{ad.unit_names?.[0] ?? 'ยังไม่ผูกยูนิต'} · {(ad.group_size ?? 1) > 1 ? `${ad.group_size} แอดใช้ภาพนี้` : ad.page_name ?? ad.account_name}</span>
            <span>ค่าแอด {number(ad.spend)} {ad.currency} · ROAS {number(roas)}</span>
            {drop ? <span className={styles.badgeWarn}>ROAS {number(drop.previous_roas)} → {number(drop.recent_roas)}</span> : null}
          </span>
          <span className={styles.pickAction}>{selected === ownKey(ad) ? 'เลือกอยู่' : 'เลือก'}</span>
        </button>;
      })}</div>
      {!rows.length ? <p className={styles.empty}>{worse ? 'ไม่มีแอดที่ผลแย่ลงตามตัวกรองนี้' : 'ไม่พบแอดตามตัวกรองนี้ · ลองเลือกทุกยูนิต'}</p> : null}
      {!worse && total > pageSize ? <div className={styles.pager}><button type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>ก่อนหน้า</button><span>หน้า {number(page + 1)} / {number(Math.ceil(total / pageSize))}</span><button type="button" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(value => value + 1)}>ถัดไป</button></div> : null}
    </>}
  </>;
}

type Dataset = { id: string; name: string; collected: string };
type RivalPickerProps = {
  onPick: (ad: Rival) => void;
  datasets: Dataset[];
  /** Competitor pages of our ad's unit, when we know them: shown first. */
  match: { unitName: string; pageIds: string[] } | null;
  selected: string | null;
};

export function RivalPicker({ open, onClose, ...props }: RivalPickerProps & { open: boolean; onClose: () => void }) {
  return <Panel open={open} onClose={onClose} title="เลือกแอดคู่แข่ง" note="จำนวนวันที่ยิงบอกได้ว่าแอดไหนน่าจะได้ผล · คู่แข่งไม่มีข้อมูลงบหรือยอดขาย"><RivalPickerBody {...props} /></Panel>;
}

function RivalPickerBody({ onPick, datasets, match, selected }: RivalPickerProps) {

  const [onlyMatch, setOnlyMatch] = useState(true);
  const [sort, setSort] = useState<'age' | 'new'>('age');
  const [dataset, setDataset] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: Rival[]; total: number } | null>(null);
  const [problem, setProblem] = useState('');

  const useMatch = Boolean(match?.pageIds.length && onlyMatch && !dataset);
  const params = new URLSearchParams({ search: query, limit: '24', offset: String(offset) });
  if (!dataset) { params.set('sort', sort); if (useMatch) params.set('pages', match!.pageIds.slice(0, 60).join(',')); }
  const url = (dataset ? `/api/datasets/${dataset}/ads?` : '/api/catalog/ads?') + params;

  useEffect(() => {

    const controller = new AbortController();
    fetch(url, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'เปิดแอดคู่แข่งไม่สำเร็จ');
        const source = datasets.find(item => item.id === dataset);
        if (!controller.signal.aborted) {
          setResult({ key: url, total: body.total, rows: body.rows.map((ad: Rival) => dataset ? { ...ad, dataset_id: dataset, dataset_name: source?.name, collected_at: source?.collected } : ad) });
          setProblem('');
        }
      }).catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setProblem(error.message); });
    return () => controller.abort();
  }, [url, dataset, datasets]);

  const rows = result?.key === url ? result.rows : [];
  const loading = result?.key !== url && !problem;
  return <>
    <div className={styles.pickerTools}>
      {match?.pageIds.length && !dataset ? <p className={onlyMatch ? styles.matchOn : styles.matchOff}>
        {onlyMatch ? `แสดงคู่แข่งของ ${match.unitName} ก่อน (${number(match.pageIds.length)} เพจ)` : 'กำลังแสดงคู่แข่งทุกหมวด'}
        <button type="button" onClick={() => { setOnlyMatch(value => !value); setOffset(0); }}>{onlyMatch ? 'ดูทุกหมวด' : `เฉพาะคู่แข่งของ ${match.unitName}`}</button>
      </p> : null}
      {!dataset ? <div className={styles.chips} role="group" aria-label="เรียงตาม">
        <button type="button" aria-pressed={sort === 'age'} onClick={() => { setSort('age'); setOffset(0); }}>ยิงนานสุด</button>
        <button type="button" aria-pressed={sort === 'new'} onClick={() => { setSort('new'); setOffset(0); }}>เจอใหม่ล่าสุด</button>
      </div> : null}
      <form className={styles.search} onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setOffset(0); }}>
        <label htmlFor="picker-rival-search">ค้นหาแอดคู่แข่ง<input id="picker-rival-search" type="search" value={search} maxLength={160} onChange={event => setSearch(event.target.value)} placeholder="ชื่อสินค้า ชื่อเพจ หรือข้อความในแอด" /></label>
        <button type="submit">ค้นหา</button>
      </form>
      <details className={styles.filters}><summary>เลือกเฉพาะรอบเก็บข้อมูล{dataset ? ' · เลือกแล้ว' : ''}</summary>
        <label>รอบที่เก็บ<select value={dataset} onChange={event => { setDataset(event.target.value); setOffset(0); }}><option value="">คลังคู่แข่งทั้งหมด</option>{datasets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </details>
    </div>
    {problem ? <p role="alert">{problem}</p> : loading ? <p role="status" className={styles.loading}>กำลังเปิดแอดคู่แข่ง…</p> : <>
      <p className={styles.resultCount}>พบ {number(result?.total ?? 0)} แอด</p>
      <div className={styles.pickGrid}>{rows.map(ad => <div key={ad.dataset_id + ':' + ad.ad_archive_id} className={selected === ad.ad_archive_id ? styles.pickedCard : undefined} data-testid={'pick-rival-' + ad.ad_archive_id}>
        <AdCard ad={ad} compact onOpen={() => { if (ad.dataset_id) onPick(ad); }} />
      </div>)}</div>
      {!rows.length ? <p className={styles.empty}>{useMatch ? `ยังไม่พบแอดจากคู่แข่งของ ${match!.unitName} · กด “ดูทุกหมวด”` : 'ไม่พบแอดคู่แข่ง ลองค้นด้วยคำอื่น'}</p> : null}
      {(result?.total ?? 0) > 24 ? <div className={styles.pager}><button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 24))}>ก่อนหน้า</button><span>หน้า {number(offset / 24 + 1)} / {number(Math.ceil((result?.total ?? 0) / 24))}</span><button type="button" disabled={offset + 24 >= (result?.total ?? 0)} onClick={() => setOffset(value => value + 24)}>ถัดไป</button></div> : null}
    </>}
  </>;
}
