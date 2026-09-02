"use client";

import { useEffect, useState } from "react";
import { AdDrawer } from "./drawer";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/states/EmptyState";
import { LoadingSkeleton } from "@/components/states/LoadingSkeleton";

type Row = {
  ad_archive_id: string; is_active: boolean | null; display_format: string | null;
  publisher_platform: string[]; cta_type: string | null; cta_text: string | null;
  title: string | null; body_text: string | null; page_id: string;
  page_name: string | null; page_categories: string[] | null;
  start_date: string; collation_count: number | null;
};
type Facet = { facet: string; value: string; n: number };
type Filters = {
  active: string; format: string; cta: string; platform: string; category: string; search: string;
};

const EMPTY: Filters = { active: "", format: "", cta: "", platform: "", category: "", search: "" };
const PAGE_SIZE = 30;

/** `—` is the honest rendering of a field the collector never provided. */
export function dash(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

export function Explorer({ datasetId }: { datasetId: string }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [offset, setOffset] = useState(0);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; rows: Row[]; total: number } | null>(null);

  // The query string doubles as the identity of the result on screen, so
  // "loading" is derived rather than a second state that can drift out of sync.
  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset), facets: "1" });
  for (const [name, value] of Object.entries(filters)) if (value) query.set(name, value);
  const key = query.toString();

  useEffect(() => {
    let live = true;
    fetch(`/api/datasets/${datasetId}/ads?${key}`)
      .then((response) => response.json())
      .then((payload) => {
        if (!live) return;
        setResult({ key, rows: payload.rows ?? [], total: payload.total ?? 0 });
        if (payload.facets) setFacets(payload.facets);
      });
    return () => { live = false; };
  }, [datasetId, key]);

  const loading = result?.key !== key;
  const rows = result?.rows ?? [];
  const total = result?.total ?? 0;

  const set = (key: keyof Filters, value: string) => {
    setOffset(0);
    setFilters((current) => ({ ...current, [key]: value }));
  };
  const options = (facet: string) => facets.filter((row) => row.facet === facet);

  return (
    <section data-testid="explorer">
      <h2>Ads Explorer</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Select id="f-active" label="สถานะ" value={filters.active} onChange={(v) => set("active", v)}
          options={[["active", "Active"], ["inactive", "Inactive"], ["unknown", "ไม่ทราบ"]]} />
        <Select id="f-format" label="รูปแบบ" value={filters.format} onChange={(v) => set("format", v)}
          options={options("display_format").map((row) => [row.value, `${row.value} (${row.n})`])} />
        <Select id="f-cta" label="CTA" value={filters.cta} onChange={(v) => set("cta", v)}
          options={options("cta_type").map((row) => [row.value, `${row.value} (${row.n})`])} />
        <Select id="f-platform" label="แพลตฟอร์ม" value={filters.platform} onChange={(v) => set("platform", v)}
          options={options("publisher_platform").map((row) => [row.value, `${row.value} (${row.n})`])} />
        <Select id="f-category" label="หมวดเพจ" value={filters.category} onChange={(v) => set("category", v)}
          options={options("page_category").map((row) => [row.value, `${row.value} (${row.n})`])} />
        <label htmlFor="f-search" style={{ display: "grid", gap: 4 }}>
          ค้นข้อความ
          <input
            id="f-search" data-testid="filter-search" value={filters.search}
            onChange={(event) => set("search", event.target.value)} style={{ minHeight: 40 }}
          />
        </label>
      </div>

      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        แพลตฟอร์มและหมวดเพจเป็นฟิลด์หลายค่า — โฆษณาหนึ่งชิ้นนับได้มากกว่าหนึ่งค่า ผลรวมจึงไม่เท่ากับ 100%
      </p>
      <p data-testid="explorer-total">
        พบ {total} จาก {total === 0 ? 0 : offset + 1}
        {rows.length ? `–${offset + rows.length}` : ""} รายการที่แสดง
      </p>

      {loading ? <LoadingSkeleton rows={4} /> : null}

      {!loading && rows.length === 0 ? (
        <EmptyState
          testId="explorer-empty"
          title="ไม่พบโฆษณาที่ตรงกับตัวกรองนี้"
          action={
            <button type="button" data-testid="reset-filters"
              onClick={() => { setFilters(EMPTY); setOffset(0); }}>
              ล้างตัวกรองทั้งหมด
            </button>
          }
        />
      ) : null}

      {rows.length ? (
        <table data-testid="ads-table">
          <thead>
            <tr>
              <th>Ad</th><th>เพจ</th><th>สถานะ</th><th>รูปแบบ</th>
              <th>CTA</th><th>แพลตฟอร์ม</th><th>เริ่มแสดง</th><th>ชุดครีเอทีฟ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ad_archive_id} data-testid={`ad-row-${row.ad_archive_id}`}>
                <td>
                  <button type="button" data-testid={`open-ad-${row.ad_archive_id}`}
                    onClick={() => setSelected(row.ad_archive_id)}>
                    {row.ad_archive_id}
                  </button>
                </td>
                <td>{dash(row.page_name)}</td>
                <td data-testid={`active-${row.ad_archive_id}`}>
                  <StatusBadge isActive={row.is_active} />
                </td>
                <td>{dash(row.display_format)}</td>
                <td>{dash(row.cta_type)}</td>
                <td>{dash(row.publisher_platform)}</td>
                <td>{dash(row.start_date)}</td>
                <td>{dash(row.collation_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" data-testid="prev-page" disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} style={{ minHeight: 44 }}>
          ก่อนหน้า
        </button>
        <button type="button" data-testid="next-page" disabled={offset + PAGE_SIZE >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)} style={{ minHeight: 44 }}>
          ถัดไป
        </button>
      </div>

      {selected ? (
        <AdDrawer adArchiveId={selected} datasetId={datasetId} onClose={() => setSelected(null)} />
      ) : null}
    </section>
  );
}

function Select({ id, label, value, onChange, options }: {
  id: string; label: string; value: string;
  onChange: (value: string) => void; options: [string, string][];
}) {
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 4 }}>
      {label}
      <select id={id} data-testid={id} value={value}
        onChange={(event) => onChange(event.target.value)} style={{ minHeight: 40 }}>
        <option value="">ทั้งหมด</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}
