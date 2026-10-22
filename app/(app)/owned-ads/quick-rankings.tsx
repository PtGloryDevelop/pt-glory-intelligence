"use client";

import { useState } from "react";
import { AdImage } from "@/components/AdImage";
import { Icon } from "@/components/shell/icons";
import { FALL_MIN_SPEND, FALL_ROAS, RANK_MIN_SPEND, type CommandAd, type CommandCenterData } from "@/lib/owned-ads/command-center";
import { closeRate, daysSinceCreated } from "@/lib/owned-ads/performance";
import { MIN_CHATS } from "@/lib/dashboard/updates";
import styles from "./quick-rankings.module.css";

const n = (value: number | null | undefined, digits = 0) => value == null ? "—" : value.toLocaleString("th-TH", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (value: number | null) => value == null ? "—" : `${n(value * 100, 1)}%`;
const thai = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
const key = (ad: { account_id: string; ad_id: string }) => `${ad.account_id}:${ad.ad_id}`;
const SHOWN = 5;

type Panel = { id: "sales" | "top_roas" | "cheap_chats" | "oldest"; title: string; why: string; main: (ad: CommandAd) => string; unit: string; sub: (ad: CommandAd) => string; good?: boolean; empty: string };
const PANELS: Panel[] = [
  { id: "sales", title: "ทำเงินสูงสุด (Meta)", why: "ยอดขายที่ Meta รายงานสูงสุดในช่วงที่เลือก", main: ad => n(ad.purchase_value), unit: "บาท", sub: ad => `ROAS ${n(ad.roas, 2)} · ค่าแอด ${n(ad.spend)}`, empty: "ยังไม่มีแอดที่มียอดขายในช่วงนี้" },
  { id: "top_roas", title: "ROAS สูงสุด", why: `เฉพาะแอดที่ใช้งบตั้งแต่ ${n(RANK_MIN_SPEND)} บาท`, main: ad => n(ad.roas, 2), unit: "ROAS (Meta)", sub: ad => `ค่าแอด ${n(ad.spend)}`, good: true, empty: `ยังไม่มีแอดที่ใช้งบถึง ${n(RANK_MIN_SPEND)} บาท` },
  { id: "cheap_chats", title: "ค่าทักถูกที่สุด", why: `เฉพาะแอดที่ทักตั้งแต่ ${MIN_CHATS} ครั้ง`, main: ad => n(ad.cost_per_conversation, 2), unit: "บาท/ทัก", sub: ad => `ทัก ${n(ad.conversations)} · %ปิด (Meta) ${pct(closeRate(ad, MIN_CHATS))}`, empty: `ยังไม่มีแอดที่ทักถึง ${MIN_CHATS} ครั้ง` },
  { id: "oldest", title: "สื่อที่ใช้มานาน", why: `ยังใช้งบอยู่ (ตั้งแต่ ${n(RANK_MIN_SPEND)} บาทในช่วงนี้) · นับจากวันที่สร้างแอดใน Meta`, main: ad => n(daysSinceCreated(ad.created_time)), unit: "วัน", sub: ad => `ROAS ${n(ad.roas, 2)} · ค่าแอด ${n(ad.spend)}`, empty: `ยังไม่มีแอดที่ใช้งบถึง ${n(RANK_MIN_SPEND)} บาท` },
];

/**
 * The quick rankings (formerly the Command Center) for the filters on the owned-ads page.
 * Every list is the database's ranking for the same period, unit and page; nothing is re-ranked here.
 */
export function QuickRankings({ data, scope, onPick }: { data: CommandCenterData; scope: string; onPick: (ad: CommandAd) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpen(value => ({ ...value, [id]: !value[id] }));
  const row = (ad: CommandAd, index: number, main: React.ReactNode, sub: string) => <li key={key(ad)}>
    <button type="button" className={styles.row} onClick={() => onPick(ad)} data-testid={`cc-ad-${ad.ad_id}`}>
      <span className={styles.rank}>{index + 1}</span>
      <span className={styles.thumb}>{ad.creative_url ? <AdImage src={ad.creative_url} alt="" sizes="40px" referrerPolicy="no-referrer" /> : null}{ad.video_id ? <span className={styles.play} aria-label="วิดีโอ">▶</span> : null}</span>
      <span className={styles.name}><b>{ad.ad_name}</b><small>{ad.unit_names[0] ?? "ยังไม่ผูกยูนิต"} · {sub}</small></span>
      <span className={styles.main}>{main}</span>
    </button>
  </li>;
  const more = (id: string, length: number) => length > SHOWN ? <button type="button" className={styles.more} aria-expanded={Boolean(open[id])} onClick={() => toggle(id)}>{open[id] ? "ย่อ" : `ดูทั้ง ${n(length)} แอด`}</button> : null;

  return <div className={styles.board} data-testid="quick-rankings">
    <section className={`${styles.panel} ${styles.wide}`} data-testid="cc-falling">
      <div className={styles.head}><h2 className={styles.alert}><Icon name="alert" />สื่อที่เริ่มตก · {n(data.falling_total)} แอด{scope ? ` ใน ${scope}` : ""}</h2>{more("falling", data.falling.length)}</div>
      <p className={styles.why}>เคย ROAS ≥ {FALL_ROAS} ช่วง {thai(data.windows.previous.from)}–{thai(data.windows.previous.to)} แต่ {thai(data.windows.recent.from)}–{thai(data.windows.recent.to)} ต่ำกว่า {FALL_ROAS} · งบทั้งสองช่วงตั้งแต่ {n(FALL_MIN_SPEND)} บาท · เรียงจากงบล่าสุดมากสุด</p>
      {data.falling.length ? <ol className={styles.twoCol}>{(open.falling ? data.falling : data.falling.slice(0, SHOWN * 2)).map((ad, index) => row(ad, index, <span className={styles.bad}>{n(ad.previous_roas, 2)} → {n(ad.recent_roas, 2)}<small>ROAS (Meta)</small></span>, `งบ 7 วันล่าสุด ${n(ad.recent_spend)} บาท`))}</ol>
        : <p className={styles.empty}>ไม่มีสื่อที่เริ่มตก{scope ? "ในตัวกรองนี้" : ""}</p>}
    </section>
    {PANELS.map(panel => { const list = data[panel.id]; return <section key={panel.id} className={styles.panel} data-testid={`cc-${panel.id}`}>
      <div className={styles.head}><h2>{panel.title}</h2>{more(panel.id, list.length)}</div>
      <p className={styles.why}>{panel.why}</p>
      {list.length ? <ol className={styles.list}>{(open[panel.id] ? list : list.slice(0, SHOWN)).map((ad, index) => row(ad, index, <span className={panel.good ? styles.good : undefined}>{panel.main(ad)}<small>{panel.unit}</small></span>, panel.sub(ad)))}</ol>
        : <p className={styles.empty}>{panel.empty}</p>}
    </section>; })}
  </div>;
}
