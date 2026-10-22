"use client";

import { useEffect, useState } from "react";
import type { UnitSummary as Summary, UnitSummaryRow } from "@/lib/owned-ads/unit-summary";
import styles from "./unit-summary.module.css";

const num = (value: number | null | undefined, digits = 2) => value == null ? "—" : value.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (now: number | null | undefined, before: number | null | undefined) => now == null || before == null || before <= 0 ? null : (now / before - 1) * 100;
const thaiDate = (value: string) => new Date(`${value}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });

function Delta({ value, goodUp }: { value: number | null; goodUp: boolean | null }) {
  if (value == null) return <span className={`${styles.delta} ${styles.flat}`}>ไม่มีช่วงเทียบ</span>;
  const tone = goodUp == null || Math.abs(value) < 5 ? styles.flat : (value > 0) === goodUp ? styles.good : styles.bad;
  return <span className={`${styles.delta} ${tone}`}>{value > 0 ? "▲" : "▼"} {Math.abs(value).toFixed(Math.abs(value) >= 100 ? 0 : 1)}%</span>;
}

/** One line for the same window as the ads list: every unit combined, or only the unit picked in the filter. */
export function UnitSummary({ query, activeUnit, onPick }: { query: string; activeUnit: string; onPick: (unitId: string) => void }) {
  const [result, setResult] = useState<{ query: string; data: Summary } | null>(null);
  const [problem, setProblem] = useState<{ query: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const data = result?.query === query ? result.data : null, error = problem?.query === query ? problem.message : null;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/owned-ads/units?${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "เปิดสรุปรายยูนิตไม่สำเร็จ");
      if (!controller.signal.aborted) { setResult({ query, data: body }); setProblem(null); }
    }).catch(failure => { if (!controller.signal.aborted && failure.name !== "AbortError") setProblem({ query, message: failure.message }); });
    return () => controller.abort();
  }, [query, retry]);

  const unit: UnitSummaryRow | undefined = activeUnit ? data?.units.find(row => row.id === activeUnit) : undefined;
  const now = activeUnit ? unit?.current : data?.all.current, before = activeUnit ? unit?.previous : data?.all.previous;

  return <section className={styles.panel} aria-labelledby="unit-summary-heading" data-testid="unit-summary">
    <div className={styles.head}>
      <h2 id="unit-summary-heading">สรุปรายยูนิต</h2>
      <span>{data ? `${thaiDate(data.period.from)} – ${thaiDate(data.period.to)}${data.previous ? ` เทียบ ${thaiDate(data.previous.from)} – ${thaiDate(data.previous.to)}` : ""} · เลือกยูนิตที่ตัวกรองด้านล่าง` : "ช่วงเดียวกับรายการแอด"}</span>
    </div>
    {error ? <p className={styles.problem} role="alert">{error} <button type="button" onClick={() => setRetry(v => v + 1)}>ลองใหม่</button></p> : null}
    {!data && !error ? <p className={styles.loading} role="status">กำลังรวมผลรายยูนิต…</p> : null}
    {data ? <>
      <div className={styles.tableWrap}><table className={styles.table}>
        <thead><tr><th>ยูนิต</th>{activeUnit ? <th className={styles.r}>แอดที่มีค่าแอด</th> : null}<th className={styles.r}>ค่าแอด</th><th className={styles.r}>เปลี่ยน</th><th className={styles.r}>ROAS (Meta)</th><th className={styles.r}>ค่าทัก</th></tr></thead>
        <tbody><tr className={activeUnit ? styles.active : undefined} data-testid="unit-summary-line">
          <td><span className={styles.unit}>{activeUnit ? unit?.name ?? "ยูนิตที่เลือก" : "ทุกยูนิต"}</span>
            {activeUnit ? <button type="button" className={styles.reset} onClick={() => onPick("")}>ดูทุกยูนิต</button> : null}</td>
          {activeUnit ? <td className={styles.r}>{unit?.current?.ad_count ?? "—"}</td> : null}
          <td className={styles.r}>{num(now?.spend, 0)}</td>
          <td className={styles.r}><Delta value={pct(now?.spend, before?.spend)} goodUp={null} /></td>
          <td className={styles.r}>{num(now?.roas)} <Delta value={pct(now?.roas, before?.roas)} goodUp={true} /></td>
          <td className={styles.r}>{num(now?.cost_per_conversation)} <Delta value={pct(now?.cost_per_conversation, before?.cost_per_conversation)} goodUp={false} /></td>
        </tr></tbody>
      </table></div>
      <div className={styles.foot}>
        <span>{activeUnit && !unit ? "ยูนิตนี้ไม่มีค่าแอดในช่วงที่เลือก · " : ""}{!activeUnit && data.unassigned.share ? `รวมแอดที่ยังไม่ผูกยูนิต ${data.unassigned.share.toFixed(1)}% ของค่าแอด · ` : ""}ยูนิตตามการผูกเพจในวันที่ยิงแอด · ค่าแอดเปลี่ยนไม่ใส่สี เพราะใช้มากขึ้นไม่ได้แปลว่าดีหรือแย่ · ROAS เป็นตัวเลขที่ Meta รายงาน</span>
      </div>
    </> : null}
  </section>;
}
