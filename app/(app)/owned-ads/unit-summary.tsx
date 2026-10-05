"use client";

import { useEffect, useState } from "react";
import type { UnitSummary as Summary, UnitSummaryRow } from "@/lib/owned-ads/unit-summary";
import styles from "./unit-summary.module.css";

type SortKey = "spend" | "change" | "roas" | "cpc";
const num = (value: number | null | undefined, digits = 2) => value == null ? "—" : value.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (now: number | null | undefined, before: number | null | undefined) => now == null || before == null || before <= 0 ? null : (now / before - 1) * 100;
const thaiDate = (value: string) => new Date(`${value}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });

function Delta({ value, goodUp }: { value: number | null; goodUp: boolean | null }) {
  if (value == null) return <span className={`${styles.delta} ${styles.flat}`}>ไม่มีช่วงเทียบ</span>;
  const tone = goodUp == null || Math.abs(value) < 5 ? styles.flat : (value > 0) === goodUp ? styles.good : styles.bad;
  return <span className={`${styles.delta} ${tone}`}>{value > 0 ? "▲" : "▼"} {Math.abs(value).toFixed(Math.abs(value) >= 100 ? 0 : 1)}%</span>;
}

/** Per-unit totals for the same window as the ads list; clicking a unit filters that list. */
export function UnitSummary({ query, activeUnit, onPick }: { query: string; activeUnit: string; onPick: (unitId: string) => void }) {
  const [result, setResult] = useState<{ query: string; data: Summary } | null>(null);
  const [problem, setProblem] = useState<{ query: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [sort, setSort] = useState<SortKey>("spend");
  const [all, setAll] = useState(false);
  const data = result?.query === query ? result.data : null, error = problem?.query === query ? problem.message : null;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/owned-ads/units?${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "เปิดสรุปรายยูนิตไม่สำเร็จ");
      if (!controller.signal.aborted) { setResult({ query, data: body }); setProblem(null); }
    }).catch(failure => { if (!controller.signal.aborted && failure.name !== "AbortError") setProblem({ query, message: failure.message }); });
    return () => controller.abort();
  }, [query, retry]);

  const value = (row: UnitSummaryRow, key: SortKey) => key === "spend" ? row.current?.spend ?? -1
    : key === "change" ? Math.abs(pct(row.current?.spend, row.previous?.spend) ?? 0)
    : key === "roas" ? row.current?.roas ?? -1 : -(row.current?.cost_per_conversation ?? Infinity);
  const rows = data ? [...data.units].sort((a, b) => value(b, sort) - value(a, sort)) : [];
  const shown = all ? rows : rows.slice(0, 8);
  const head = (key: SortKey, label: string) => <th className={styles.r}><button type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>{label}{sort === key ? " ↓" : ""}</button></th>;

  return <section className={styles.panel} aria-labelledby="unit-summary-heading" data-testid="unit-summary">
    <div className={styles.head}>
      <h2 id="unit-summary-heading">สรุปรายยูนิต</h2>
      <span>{data ? `${thaiDate(data.period.from)} – ${thaiDate(data.period.to)}${data.previous ? ` เทียบ ${thaiDate(data.previous.from)} – ${thaiDate(data.previous.to)}` : ""} · คลิกยูนิตเพื่อกรองแอดด้านล่าง` : "ช่วงเดียวกับรายการแอด"}</span>
    </div>
    {error ? <p className={styles.problem} role="alert">{error} <button type="button" onClick={() => setRetry(v => v + 1)}>ลองใหม่</button></p> : null}
    {!data && !error ? <p className={styles.loading} role="status">กำลังรวมผลรายยูนิต… ครั้งแรกของแต่ละช่วงอาจใช้เวลาหลายวินาที</p> : null}
    {data ? <>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>ยูนิต</th><th className={styles.r}>แอดที่มีค่าแอด</th>{head("spend", "ค่าแอด")}{head("change", "เปลี่ยน")}{head("roas", "ROAS (Meta)")}{head("cpc", "ค่าทัก")}</tr></thead>
        <tbody>
          {shown.map(row => <tr key={row.id ?? row.name} className={activeUnit === row.id ? styles.active : undefined} onClick={() => row.id && onPick(activeUnit === row.id ? "" : row.id)} tabIndex={0}
            onKeyDown={event => { if ((event.key === "Enter" || event.key === " ") && row.id) { event.preventDefault(); onPick(activeUnit === row.id ? "" : row.id); } }}
            aria-label={`กรองแอดของยูนิต ${row.name}`}>
            <td><span className={styles.unit}>{row.name}</span></td>
            <td className={styles.r}>{row.current?.ad_count ?? "—"}</td>
            <td className={styles.r}>{num(row.current?.spend, 0)}</td>
            <td className={styles.r}><Delta value={pct(row.current?.spend, row.previous?.spend)} goodUp={null} /></td>
            <td className={styles.r}>{num(row.current?.roas)} <Delta value={pct(row.current?.roas, row.previous?.roas)} goodUp={true} /></td>
            <td className={styles.r}>{num(row.current?.cost_per_conversation)} <Delta value={pct(row.current?.cost_per_conversation, row.previous?.cost_per_conversation)} goodUp={false} /></td>
          </tr>)}
          <tr className={styles.unassigned}><td><span className={`${styles.unit} ${styles.none}`}>ยังไม่ผูกยูนิต</span></td><td className={styles.r}>—</td><td className={styles.r}>{num(data.unassigned.spend, 0)}</td>
            <td className={styles.r}>{data.unassigned.share != null ? <span className={`${styles.delta} ${styles.flat}`}>{data.unassigned.share.toFixed(1)}% ของค่าแอด</span> : "—"}</td><td className={styles.r}>—</td><td className={styles.r}>—</td></tr>
        </tbody>
      </table></div>
      <div className={styles.foot}>
        <span>ยูนิตตามการผูกเพจในวันที่ยิงแอด (จาก Ads Management) · ค่าแอดเปลี่ยนไม่ใส่สี เพราะใช้มากขึ้นไม่ได้แปลว่าดีหรือแย่ · ROAS เป็นตัวเลขที่ Meta รายงาน</span>
        {rows.length > 8 ? <button type="button" onClick={() => setAll(v => !v)}>{all ? "แสดง 8 ยูนิตแรก" : `แสดงทั้ง ${rows.length} ยูนิต`}</button> : null}
      </div>
    </> : null}
  </section>;
}
