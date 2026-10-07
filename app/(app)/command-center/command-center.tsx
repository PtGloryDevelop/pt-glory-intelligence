"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { AdImage } from "@/components/AdImage";
import type { CompanyAd } from "@/lib/owned-ads/source-rows";
import type { UnitSummary as UnitSummaryData } from "@/lib/owned-ads/unit-summary";
import type { CommandCenterResult } from "@/lib/owned-ads/command-center-read";
import { FALL_MIN_SPEND, FALL_ROAS, RANK_MIN_SPEND, railOrder, type CommandAd } from "@/lib/owned-ads/command-center";
import { closeRate, daysSinceCreated } from "@/lib/owned-ads/performance";
import { MIN_CHATS } from "@/lib/dashboard/updates";
import { UnitRail } from "../owned-ads/unit-rail";
import { useJson } from "../owned-ads/use-json";
import { CompanyDetail } from "../owned-ads/company-library";
import styles from "./command-center.module.css";

const PERIODS = [["3d", "3 วัน"], ["7d", "7 วัน"], ["14d", "14 วัน"], ["this-month", "เดือนนี้"], ["last-month", "เดือนที่แล้ว"], ["all", "ทั้งหมดที่นำเข้า"]] as const;
const n = (value: number | null | undefined, digits = 0) => value == null ? "—" : value.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (value: number | null) => value == null ? "—" : `${n(value * 100, 1)}%`;
const thai = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
const key = (ad: { account_id: string; ad_id: string }) => `${ad.account_id}:${ad.ad_id}`;

type Panel = { id: "sales" | "cheap_chats" | "top_roas" | "oldest"; title: string; why: string; main: (ad: CommandAd) => string; unit: string; sub: (ad: CommandAd) => string; good?: boolean; empty: string };
const PANELS: Panel[] = [
  { id: "sales", title: "💰 สื่อที่ทำเงิน", why: "ยอดขาย (Meta) สูงสุดในช่วงที่เลือก", main: ad => n(ad.purchase_value), unit: "บาท", sub: ad => `ROAS ${n(ad.roas, 2)} · ค่าแอด ${n(ad.spend)}`, empty: "ยังไม่มีแอดที่มียอดขายในช่วงนี้" },
  { id: "cheap_chats", title: "💬 ค่าทักถูกที่สุด", why: `เฉพาะแอดที่ทักตั้งแต่ ${MIN_CHATS} ครั้ง`, main: ad => n(ad.cost_per_conversation, 2), unit: "บาท/ทัก", sub: ad => `ทัก ${n(ad.conversations)} · %ปิด ${pct(closeRate(ad, MIN_CHATS))}`, empty: `ยังไม่มีแอดที่ทักถึง ${MIN_CHATS} ครั้ง` },
  { id: "top_roas", title: "📈 ROAS สูงสุด", why: `เฉพาะแอดที่ใช้งบตั้งแต่ ${n(RANK_MIN_SPEND)} บาท`, main: ad => n(ad.roas, 2), unit: "ROAS (Meta)", sub: ad => `ค่าแอด ${n(ad.spend)}`, good: true, empty: `ยังไม่มีแอดที่ใช้งบถึง ${n(RANK_MIN_SPEND)} บาท` },
  { id: "oldest", title: "⏳ สื่อที่ใช้มานาน", why: `ยังใช้งบอยู่ (ตั้งแต่ ${n(RANK_MIN_SPEND)} บาทในช่วงนี้) · นับจากวันที่สร้างแอด`, main: ad => n(daysSinceCreated(ad.created_time)), unit: "วัน", sub: ad => `ROAS ${n(ad.roas, 2)} · ค่าแอด ${n(ad.spend)}`, empty: `ยังไม่มีแอดที่ใช้งบถึง ${n(RANK_MIN_SPEND)} บาท` },
];

export function CommandCenter() {
  const params = useSearchParams(), pathname = usePathname();
  const period = PERIODS.find(([value]) => value === params.get("period"))?.[0] ?? "7d";
  const unit = params.get("unit") ?? "";
  const query = new URLSearchParams([["period", period], ...(unit ? [["unit", unit]] : [])]).toString();
  const center = useJson<CommandCenterResult>(`/api/owned-ads/command-center?${query}`);
  const units = useJson<UnitSummaryData>(`/api/owned-ads/units?period=${period}`);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<CompanyAd | null>(null);
  const data = center.data;
  const rail = railOrder(units.data?.units.map(row => ({ id: row.id, name: row.name, ads: row.current?.ad_count ?? null })) ?? [], data?.falling_counts ?? []);
  const unitName = unit ? rail.find(row => row.id === unit)?.name ?? "ยูนิตที่เลือก" : "ทุกยูนิต";

  function change(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(values)) if (value) next.set(name, value); else next.delete(name);
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`);
    setOpen({});
  }
  const toggle = (id: string) => setOpen(value => ({ ...value, [id]: !value[id] }));
  const row = (ad: CommandAd, index: number, main: React.ReactNode, sub: string) => <li key={key(ad)}>
    <button type="button" className={styles.row} onClick={() => setSelected(ad)} data-testid={`cc-ad-${ad.ad_id}`}>
      <span className={styles.rank}>{index + 1}</span>
      <span className={styles.thumb}>{ad.creative_url ? <AdImage src={ad.creative_url} alt="" sizes="48px" referrerPolicy="no-referrer" /> : null}{ad.video_id ? <span className={styles.play} aria-label="วิดีโอ">▶</span> : null}</span>
      <span className={styles.name}><b>{ad.ad_name}</b><small>{sub}</small></span>
      <span className={styles.main}>{main}</span>
    </button>
  </li>;

  return <div className={styles.page} data-testid="command-center">
    <section className={styles.hero}><PageHeader title="Command Center" description={data ? `จัดอันดับสื่อของเรา · ${thai(data.period.from)} – ${thai(data.period.to)} · ${unitName}` : "กำลังจัดอันดับสื่อ…"}
      actions={<label className={styles.periodPick}>ช่วงวันที่<select value={period} onChange={event => change({ period: event.target.value })} data-testid="cc-period">{PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>} /></section>
    <div className={styles.body}>
      <UnitRail units={rail} unassigned={units.data?.unassigned.totals?.ad_count ?? null} fallingTotal={data ? data.falling_counts.reduce((sum, item) => sum + item.count, 0) : null} active={unit} onPick={value => change({ unit: value })} />
      <div className={styles.board}>
        {center.error ? <p className={styles.problem} role="alert">{center.error}</p> : null}
        {!data && !center.error ? <p className={styles.loading} role="status">กำลังจัดอันดับสื่อ…</p> : null}
        {data ? <>
          <section className={`${styles.panel} ${styles.fallingPanel}`} data-testid="cc-falling">
            <div className={styles.head}><h2>⚠ สื่อที่เริ่มตก · {n(data.falling_total)} แอด{unit ? ` ใน ${unitName}` : ""}</h2>
              {data.falling.length > 4 ? <button type="button" className={styles.more} onClick={() => toggle("falling")}>{open.falling ? "ย่อ" : `ดูทั้ง ${n(data.falling.length)} แอด`}</button> : null}</div>
            <p className={styles.why}>เคย ROAS ≥ {FALL_ROAS} ช่วง {thai(data.windows.previous.from)}–{thai(data.windows.previous.to)} แต่ {thai(data.windows.recent.from)}–{thai(data.windows.recent.to)} ต่ำกว่า {FALL_ROAS} · งบทั้งสองช่วงตั้งแต่ {n(FALL_MIN_SPEND)} บาท · เรียงจากงบล่าสุดมากสุด</p>
            {data.falling.length ? <ol className={styles.twoCol}>{(open.falling ? data.falling : data.falling.slice(0, 4)).map((ad, index) => row(ad, index, <span className={styles.bad}>{n(ad.previous_roas, 2)} → {n(ad.recent_roas, 2)}<small>ROAS</small></span>, `งบ 7 วันล่าสุด ${n(ad.recent_spend)} บาท`))}</ol>
              : <p className={styles.empty}>ไม่มีสื่อที่เริ่มตก{unit ? "ในยูนิตนี้" : ""}</p>}
          </section>
          {PANELS.map(panel => { const list = data[panel.id]; return <section key={panel.id} className={styles.panel} data-testid={`cc-${panel.id}`}>
            <div className={styles.head}><h2>{panel.title}</h2>{list.length > 3 ? <button type="button" className={styles.more} onClick={() => toggle(panel.id)}>{open[panel.id] ? "ย่อ" : "ดูทั้งหมด"}</button> : null}</div>
            <p className={styles.why}>{panel.why}</p>
            {list.length ? <ol className={styles.list}>{(open[panel.id] ? list : list.slice(0, 3)).map((ad, index) => row(ad, index, <span className={panel.good ? styles.good : undefined}>{panel.main(ad)}<small>{panel.unit}</small></span>, panel.sub(ad)))}</ol>
              : <p className={styles.empty}>{panel.empty}</p>}
          </section>; })}
        </> : null}
      </div>
    </div>
    {selected ? <CompanyDetail ad={selected} creativeUrl={selected.creative_url} mediaLoading={false} period={data ? { date_start: data.period.from, date_end: data.period.to } : null} returnTo={`${pathname}?${query}`} onClose={() => setSelected(null)} /> : null}
  </div>;
}
