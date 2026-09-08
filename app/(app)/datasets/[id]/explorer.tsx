"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdDrawer } from "./drawer";
import { AdCard, type AdCardData } from "@/components/AdCard";
import { AdThumb } from "@/components/AdThumb";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingSkeleton } from "@/components/states/LoadingSkeleton";
import {
  ADVANCED_KEYS, PRESENCE_SOURCE, SORTS,
  appliedFilters, chipLabel, filterLabel, fromQuery, toQuery,
  type FilterKey, type Filters,
} from "@/lib/explorer/filters";
import type { Media } from "@/lib/media";
import { thaiDate } from "@/lib/format/date";
import styles from "./explorer.module.css";

type Row = AdCardData & {
  cta_text: string | null; page_id: string; page_categories: string[] | null;
  first_seen_at: string; last_seen_at: string; media: Media;
  archive_url?: string | null; archive_status?: string | null;
};
type Facet = { facet: string; value: string; label: string; n: number };
type Coverage = { field: string; present_count: number; total_count: number };

const PAGE_SIZE = 30;

/** Unknown is a state of its own, so it is always on the menu. */
const ACTIVE_OPTIONS: [string, string][] = [
  ["active", "Active"], ["inactive", "Inactive"], ["unknown", "ไม่ทราบ"],
];

/** `—` is the honest rendering of a field the collector never provided. */
export function dash(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

export function Explorer({ datasetId, coverage = [] }: {
  datasetId: string;
  /** Dataset quality rows, used to say how readable a presence filter is. */
  coverage?: Coverage[];
}) {
  // The URL is the state. A research view someone shares, reloads or navigates
  // back to must be the same view.
  const initial = useMemo(
    () => fromQuery(new URLSearchParams(typeof window === "undefined" ? "" : window.location.search)),
    [],
  );
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [sort, setSort] = useState(initial.sort);
  const [offset, setOffset] = useState(initial.offset);
  const [view, setView] = useState<"grid" | "table">("grid");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; rows: Row[]; total: number } | null>(null);

  const query = toQuery(filters, sort, offset);
  const key = query.toString();

  // Back and forward move between research states rather than leaving the page.
  useEffect(() => {
    const onPop = () => {
      const state = fromQuery(new URLSearchParams(window.location.search));
      setFilters(state.filters);
      setSort(state.sort);
      setOffset(state.offset);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const url = `${window.location.pathname}${key ? `?${key}` : ""}`;
    if (url !== `${window.location.pathname}${window.location.search}`) {
      window.history.pushState(null, "", url);
    }
  }, [key]);

  useEffect(() => {
    let live = true;
    const request = new URLSearchParams(key);
    request.set("limit", String(PAGE_SIZE));
    request.set("offset", String(offset));
    request.set("facets", "1");
    fetch(`/api/datasets/${datasetId}/ads?${request.toString()}`)
      .then((response) => response.json())
      .then((payload) => {
        if (!live) return;
        setResult({ key, rows: payload.rows ?? [], total: payload.total ?? 0 });
        if (payload.facets) setFacets(payload.facets);
      });
    return () => { live = false; };
  }, [datasetId, key, offset]);

  const loading = result?.key !== key;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;
  const applied = appliedFilters(filters);

  const set = useCallback((name: FilterKey, value: string) => {
    setOffset(0);
    setFilters((current) => {
      const next = { ...current };
      if (value === "") delete next[name];
      else next[name] = value;
      return next;
    });
  }, []);

  const clearAll = () => { setFilters({}); setOffset(0); };
  const options = (facet: string) => facets.filter((row) => row.facet === facet);
  const facetLabel = (facet: string, value: string) =>
    facets.find((row) => row.facet === facet && row.value === value)?.label;

  return (
    <section data-testid="explorer">
      <h2>Ads Explorer</h2>

      <div className={styles.toolbar} data-testid="filter-toolbar">
        <label className={styles.search} htmlFor="f-search">
          <span className={styles.label}>ค้นข้อความ</span>
          <input
            id="f-search" data-testid="filter-search" value={filters.search ?? ""}
            placeholder="ค้นในข้อความโฆษณาและหัวเรื่อง"
            onChange={(event) => set("search", event.target.value)}
          />
        </label>

        {/* The three states are always offered, even when the snapshot happens
            to contain none of one of them: "no inactive ads here" is an answer,
            and a missing Unknown option would quietly fold it into Inactive. */}
        <Select id="f-active" label="สถานะ" value={filters.active ?? ""} onChange={(v) => set("active", v)}
          options={ACTIVE_OPTIONS.map(([value, label]) => {
            const facet = facets.find((row) => row.facet === "active" && row.value === value);
            return [value, facet ? `${label} (${facet.n})` : `${label} (0)`];
          })} />
        <Select id="f-format" label="รูปแบบ" value={filters.format ?? ""} onChange={(v) => set("format", v)}
          options={options("display_format").map((row) => [row.value, `${row.label} (${row.n})`])} />
        <Select id="f-cta" label="CTA" value={filters.cta ?? ""} onChange={(v) => set("cta", v)}
          options={options("cta_type").map((row) => [row.value, `${row.label} (${row.n})`])} />
        <Select id="f-platform" label="แพลตฟอร์ม" value={filters.platform ?? ""} onChange={(v) => set("platform", v)}
          options={options("publisher_platform").map((row) => [row.value, `${row.label} (${row.n})`])} />
        <PageFilter
          value={filters.page ?? ""}
          onChange={(v) => set("page", v)}
          options={options("page")}
        />

        <button type="button" data-testid="advanced-toggle" className={styles.advancedButton}
          aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>
          ตัวกรองขั้นสูง{advancedCount(filters) ? ` (${advancedCount(filters)})` : ""}
        </button>

        <label className={styles.sort} htmlFor="f-sort">
          <span className={styles.label}>เรียงตาม</span>
          <select id="f-sort" data-testid="sort-select" value={sort}
            onChange={(event) => { setOffset(0); setSort(event.target.value); }}>
            {SORTS.map((option) => (
              <option key={option.key} value={option.key}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className={styles.viewToggle} role="group" aria-label="รูปแบบการแสดงผล">
          <button type="button" data-testid="view-grid" aria-pressed={view === "grid"}
            className={view === "grid" ? styles.viewOn : ""} onClick={() => setView("grid")}>
            การ์ด
          </button>
          <button type="button" data-testid="view-table" aria-pressed={view === "table"}
            className={view === "table" ? styles.viewOn : ""} onClick={() => setView("table")}>
            ตาราง
          </button>
        </div>
      </div>

      {applied.length ? (
        <div className={styles.chips} data-testid="filter-chips">
          {applied.map(({ key: name, value }) => (
            <button key={name} type="button" className={styles.chip}
              data-testid={`chip-${name}`} onClick={() => set(name, "")}>
              {chipLabel(name, value, name === "page" ? facetLabel("page", value) : undefined)}
              <span aria-hidden> ×</span>
              <span className={styles.sr}> ล้างตัวกรองนี้</span>
            </button>
          ))}
          <button type="button" className={styles.clearAll} data-testid="clear-all" onClick={clearAll}>
            ล้างตัวกรองทั้งหมด
          </button>
        </div>
      ) : null}

      {advancedOpen ? (
        <AdvancedPanel
          filters={filters} set={set} coverage={coverage}
          categories={options("page_category")}
        />
      ) : null}

      {/* Count, position and view mode read as one line so the results start
          immediately rather than after a stack of separate paragraphs. */}
      <div className={styles.resultBar}>
        <p className={styles.resultCount} data-testid="explorer-total">
          พบ <strong>{total}</strong> รายการ
          {total > 0 ? ` · แสดง ${offset + 1}–${offset + rows.length}` : ""}
        </p>
        <p className={styles.note}>
          แพลตฟอร์มและหมวดเพจเป็นฟิลด์หลายค่า — ผลรวมจึงเกิน 100% ได้
        </p>
      </div>

      {loading ? <LoadingSkeleton rows={4} /> : null}

      {/* "This dataset is empty" and "your filters matched nothing" are
          different answers. Showing the filter version for an empty dataset
          would send someone hunting for a filter they never set. */}
      {!loading && rows.length === 0 ? (
        applied.length === 0 ? (
          <EmptyState
            testId="explorer-empty"
            title="ชุดข้อมูลนี้ยังไม่มีโฆษณา"
            body="รอบเก็บนี้ไม่ได้บันทึกโฆษณาไว้เลย"
          />
        ) : (
          <EmptyState
            testId="explorer-empty"
            title="ไม่พบโฆษณาที่ตรงกับตัวกรองนี้"
            body={`ตัวกรองที่ใช้อยู่: ${applied.map(({ key: name, value }) => chipLabel(name, value, name === "page" ? facetLabel("page", value) : undefined)).join(" · ")}`}
            action={
              <button type="button" data-testid="reset-filters" data-variant="primary" onClick={clearAll}>
                ล้างตัวกรองทั้งหมด
              </button>
            }
          />
        )
      ) : null}

      {!loading && rows.length && view === "grid" ? (
        <div className={styles.grid} data-testid="ads-grid">
          {rows.map((row) => (
            <AdCard key={row.ad_archive_id} ad={row} onOpen={() => setSelected(row.ad_archive_id)} />
          ))}
        </div>
      ) : null}

      {!loading && rows.length && view === "table" ? (
        // Nine columns do not fit a phone; the table scrolls inside itself
        // rather than dragging the page sideways.
        <div className={styles.tableScroll}>
          <table data-testid="ads-table">
            <thead>
              <tr>
                <th className={styles.thCreative}>ครีเอทีฟ</th>
                <th>เพจ</th><th>ข้อความ</th><th>รูปแบบ</th>
                <th>CTA</th><th>แพลตฟอร์ม</th>
                <th className={styles.thNum}>เริ่มแสดง</th>
                <th className={styles.thNum}>อายุ (วัน)</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ad_archive_id} data-testid={`ad-row-${row.ad_archive_id}`}>
                  {/* The creative leads the row: an analyst scans by picture,
                      not by a 16-digit id. The id lives in the drawer. */}
                  <td className={styles.creativeCell}>
                    <button type="button" className={styles.thumbButton}
                      data-testid={`open-ad-${row.ad_archive_id}`}
                      aria-label={`เปิดรายละเอียดโฆษณาของ ${row.page_name ?? "เพจที่ไม่ทราบชื่อ"}`}
                      onClick={() => setSelected(row.ad_archive_id)}>
                      <AdThumb ad={row} />
                    </button>
                  </td>
                  <td className={styles.pageCell}>{dash(row.page_name)}</td>
                  <td className={styles.copyCell}>{dash(row.body_text)}</td>
                  <td>{dash(row.display_format)}</td>
                  <td>{dash(row.cta_type)}</td>
                  <td className={styles.platformCell}>{dash(row.publisher_platform)}</td>
                  <td className={styles.numCell}>
                    {thaiDate(row.start_date)}
                  </td>
                  <td className={styles.numCell}>{dash(row.ad_age_days)}</td>
                  <td data-testid={`active-${row.ad_archive_id}`}>
                    <StatusBadge isActive={row.is_active} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className={styles.pager}>
        <button type="button" data-testid="prev-page" disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
          ก่อนหน้า
        </button>
        <button type="button" data-testid="next-page" disabled={offset + PAGE_SIZE >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)}>
          ถัดไป
        </button>
      </div>

      {selected ? (
        <AdDrawer adArchiveId={selected} datasetId={datasetId} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}

function advancedCount(filters: Filters): number {
  return ADVANCED_KEYS.filter((key) => (filters[key] ?? "") !== "").length;
}

/**
 * Advanced filters. Every control here maps to a server-side parameter — none
 * of it filters the page that was already fetched.
 */
function AdvancedPanel({ filters, set, coverage, categories }: {
  filters: Filters;
  set: (key: FilterKey, value: string) => void;
  coverage: Coverage[];
  categories: Facet[];
}) {
  const readable = (key: FilterKey) => {
    const field = PRESENCE_SOURCE[key];
    const row = field ? coverage.find((entry) => entry.field === field) : undefined;
    if (!row) return null;
    return `${row.present_count} / ${row.total_count} อ่านค่าได้`;
  };

  return (
    <div className={styles.advanced} data-testid="advanced-panel">
      <div className={styles.advancedGrid}>
        <DateRange label="เริ่มแสดง" from="startedFrom" to="startedTo" filters={filters} set={set} />
        {/* first_seen_at is when PT Glory observed the ad, which is not when
            Meta says it started running. The two are separate filters. */}
        <DateRange label="พบครั้งแรก" from="firstSeenFrom" to="firstSeenTo" filters={filters} set={set} />
        <DateRange label="พบครั้งล่าสุด" from="lastSeenFrom" to="lastSeenTo" filters={filters} set={set} />

        <fieldset className={styles.group}>
          <legend>อายุโฆษณา (วัน)</legend>
          <Number id="f-age-min" label="ตั้งแต่" value={filters.ageMin ?? ""} onChange={(v) => set("ageMin", v)} />
          <Number id="f-age-max" label="ถึง" value={filters.ageMax ?? ""} onChange={(v) => set("ageMax", v)} />
        </fieldset>

        <fieldset className={styles.group}>
          <legend>การใช้ซ้ำของครีเอทีฟ</legend>
          <Number id="f-reuse" label="collation อย่างน้อย" value={filters.reuseMin ?? ""}
            onChange={(v) => set("reuseMin", v)} />
          <p className={styles.hint}>นับจาก collation_count ที่บันทึกไว้ในรอบเก็บนี้</p>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>หมวดเพจ</legend>
          <select data-testid="f-category" value={filters.category ?? ""}
            onChange={(event) => set("category", event.target.value)}>
            <option value="">ทั้งหมด</option>
            {categories.map((row) => (
              <option key={row.value} value={row.value}>{row.label} ({row.n})</option>
            ))}
          </select>
        </fieldset>

        <fieldset className={styles.group}>
          <legend>เงื่อนไขอื่น</legend>
          <Toggle id="f-evergreen" label="Evergreen (ยังแสดงอยู่ และอายุถึงเกณฑ์ที่ตั้งไว้)"
            value={filters.evergreen ?? ""} onChange={(v) => set("evergreen", v)} />
          <Toggle id="f-has-video" label="มีวิดีโอ" hint={readable("hasVideo")}
            value={filters.hasVideo ?? ""} onChange={(v) => set("hasVideo", v)} />
          <Toggle id="f-has-image" label="มีภาพ" hint={readable("hasImage")}
            value={filters.hasImage ?? ""} onChange={(v) => set("hasImage", v)} />
          <Toggle id="f-has-title" label="มีหัวเรื่อง" hint={readable("hasTitle")}
            value={filters.hasTitle ?? ""} onChange={(v) => set("hasTitle", v)} />
          <Toggle id="f-has-destination" label="มีลิงก์ปลายทาง" hint={readable("hasDestination")}
            value={filters.hasDestination ?? ""} onChange={(v) => set("hasDestination", v)} />
        </fieldset>
      </div>

      <p className={styles.hint}>
        ตัวกรอง “มี…” ใช้กับเฉพาะโฆษณาที่อ่านค่าฟิลด์นั้นได้ — ฟิลด์ที่อ่านไม่ได้แปลว่าไม่ทราบ ไม่ได้แปลว่าไม่มี
      </p>
    </div>
  );
}

function DateRange({ label, from, to, filters, set }: {
  label: string; from: FilterKey; to: FilterKey;
  filters: Filters; set: (key: FilterKey, value: string) => void;
}) {
  return (
    <fieldset className={styles.group}>
      <legend>{label}</legend>
      <label htmlFor={`f-${from}`}>
        <span className={styles.label}>{filterLabel(from)}</span>
        <input id={`f-${from}`} data-testid={`f-${from}`} type="date" value={filters[from] ?? ""}
          onChange={(event) => set(from, event.target.value)} />
      </label>
      <label htmlFor={`f-${to}`}>
        <span className={styles.label}>{filterLabel(to)}</span>
        <input id={`f-${to}`} data-testid={`f-${to}`} type="date" value={filters[to] ?? ""}
          onChange={(event) => set(to, event.target.value)} />
      </label>
    </fieldset>
  );
}

function Number({ id, label, value, onChange }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id}>
      <span className={styles.label}>{label}</span>
      <input id={id} data-testid={id} type="number" min={0} value={value}
        onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

/** Three states, because "any" is not the same as "no". */
function Toggle({ id, label, hint, value, onChange }: {
  id: string; label: string; hint?: string | null; value: string; onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className={styles.toggle}>
      <span>
        {label}
        {hint ? <span className={styles.hint}> · {hint}</span> : null}
      </span>
      <select id={id} data-testid={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">ทั้งหมด</option>
        <option value="true">ใช่</option>
        <option value="false">ไม่ใช่</option>
      </select>
    </label>
  );
}

/**
 * The page list can be long — the golden export carries 309 pages — so it gets
 * its own search. The filter still matches on page_id: two pages may share a
 * name, and a name is not an identity in this product.
 */
function PageFilter({ value, onChange, options }: {
  value: string; onChange: (value: string) => void; options: Facet[];
}) {
  const [search, setSearch] = useState("");
  const matching = search
    ? options.filter((row) => row.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  return (
    <div className={styles.pageFilter}>
      <span className={styles.label}>เพจ</span>
      <input
        data-testid="f-page-search" value={search} placeholder="ค้นชื่อเพจ"
        onChange={(event) => setSearch(event.target.value)}
      />
      <select data-testid="f-page" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">ทั้งหมด ({options.length})</option>
        {matching.slice(0, 200).map((row) => (
          <option key={row.value} value={row.value}>{row.label} ({row.n})</option>
        ))}
      </select>
    </div>
  );
}

function Select({ id, label, value, onChange, options }: {
  id: string; label: string; value: string;
  onChange: (value: string) => void; options: [string, string][];
}) {
  return (
    <label htmlFor={id} className={styles.field}>
      <span className={styles.label}>{label}</span>
      <select id={id} data-testid={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">ทั้งหมด</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
