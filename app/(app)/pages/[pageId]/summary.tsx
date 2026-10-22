"use client";

import Link from "next/link";
import { useState } from "react";
import { AdDrawer } from "@/components/AdDrawer";
import { AdThumb } from "@/components/AdThumb";
import { Tile } from "@/components/shell/Tile";
import type { Media } from "@/lib/media";
import type { LaunchPace, OfferChange, OfferSummary } from "@/lib/pages/summary";
import { OfferChangeLine } from "@/components/OfferChangeLine";
import type { PageUnit } from "@/lib/read/pages";
import styles from "./summary.module.css";

export type SummaryTop = {
  ad_archive_id: string; collation: number; line: string;
  display_format: string | null; media: Media; archive_url: string | null; archive_status: string | null;
};
/** A null part could not be read; the rest of the summary still shows. `units` is null for roles that cannot compare. */
export type PageSummaryData = {
  active: number | null; top: SummaryTop | null; offers: OfferSummary | null; change: OfferChange | null; pace: LaunchPace | null;
  units: PageUnit[] | null; compareHref: string | null; lastObserved: string | null;
};

const RELATION: Record<PageUnit["relation"], string> = { direct: "คู่แข่งตรง", substitute: "สินค้าทดแทน" };
const whole = (value: number) => value.toLocaleString("th-TH", { maximumFractionDigits: 1 });
const weekLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Four answers at the top of a rival page, so the reader can scan them before the detail below:
 * what it runs now, the offers in its copy, how often it starts new ads, and which unit of ours it
 * competes with. Counts and text matches only (FACT); nothing here estimates how an ad performs.
 */
export function PageSummary({ data, datasetId, canAnalyze }: { data: PageSummaryData; datasetId: string | null; canAnalyze: boolean }) {
  const [open, setOpen] = useState(false);
  const { active, top, offers, change, pace, units, compareHref, lastObserved } = data;
  const tallest = Math.max(1, ...(pace?.weeks.map((week) => week.started) ?? []));

  return (
    <section className={styles.box} aria-labelledby="page-summary-heading" data-testid="page-summary">
      <div className={styles.head}>
        <h2 id="page-summary-heading">สรุปเพจนี้</h2>
        <span className={styles.fact}>ข้อเท็จจริง</span>
        <span className={styles.stamp}>นับจากแอดที่เก็บได้{lastObserved ? ` · สังเกตล่าสุด ${lastObserved}` : ""}</span>
      </div>
      <div className={styles.grid}>
        <div className={styles.cell} data-testid="summary-running">
          <div className={styles.label}><Tile icon="layers" tone="rival" />ตอนนี้ยิงอะไรอยู่</div>
          {active == null ? <p className={styles.detail}>อ่านแอดของเพจนี้ไม่สำเร็จ</p> : <>
            <p className={styles.headline}>กำลังแสดง <b>{whole(active)}</b> แอด</p>
            {top ? (
              <button type="button" className={styles.topAd} onClick={() => setOpen(true)} aria-label="ดูแอดที่ใช้ซ้ำมากที่สุด">
                <AdThumb ad={top} width={60} />
                <span className={styles.topText}>
                  <span>ครีเอทีฟที่ Meta รวมไว้มากที่สุด <b>{whole(top.collation)}</b> แอด</span>
                  {top.line ? <span className={styles.quote}>“{top.line}”</span> : null}
                </span>
              </button>
            ) : <p className={styles.detail}>{active ? "แต่ละแอดใช้ครีเอทีฟไม่ซ้ำกัน" : "ไม่พบแอดที่กำลังแสดงในข้อมูลที่เก็บ"}</p>}
          </>}
          <p className={styles.note}>จำนวนแอดที่ใช้ครีเอทีฟเดียวกันบอกว่าเขาวางแอดไว้หลังชิ้นนั้นมาก ไม่ได้บอกว่าขายดี</p>
        </div>

        <div className={styles.cell} data-testid="summary-offers">
          <div className={styles.label}><Tile icon="tag" tone="rival" />ข้อเสนอในข้อความแอด</div>
          {offers == null ? <p className={styles.detail}>อ่านข้อความแอดไม่สำเร็จ</p>
            : offers.offers.length || offers.prices.length ? (
              <div className={styles.chips}>
                {offers.offers.map((offer) => <span key={offer.label} className={styles.chip}><b>{offer.label}</b>{whole(offer.ads)}/{whole(offers.readable)}</span>)}
                {offers.prices.map((price) => <span key={price.baht} className={`${styles.chip} ${styles.price}`}><b>{whole(price.baht)} บาท</b>{whole(price.ads)}/{whole(offers.readable)}</span>)}
              </div>
            ) : <p className={styles.detail}>ไม่พบคำโปรหรือราคาในข้อความ</p>}
          {offers ? <OfferChangeLine change={change} /> : null}
          <p className={styles.note}>จับคำจากข้อความของแอดที่กำลังแสดง{offers ? ` ${whole(offers.readable)} แอดที่มีข้อความ` : ""} · ตัวเลขคือจำนวนแอดที่พบคำนั้น</p>
        </div>

        <div className={styles.cell} data-testid="summary-pace">
          <div className={styles.label}><Tile icon="trend" tone="rival" />ออกแอดใหม่ถี่แค่ไหน</div>
          {pace == null ? <p className={styles.detail}>อ่านวันที่เริ่มแสดงไม่สำเร็จ</p> : <>
            <p className={styles.headline}>{pace.average == null ? "ยังไม่มีสัปดาห์ที่จบให้เฉลี่ย" : <>เฉลี่ย <b>{whole(pace.average)}</b> แอดใหม่ต่อสัปดาห์</>}</p>
            <div className={styles.weeks} role="img" aria-label={pace.weeks.map((week) => `สัปดาห์ ${weekLabel(week.weekStart)} ${week.started} แอด${week.current ? " (ยังไม่จบ)" : ""}`).join(", ")}>
              {pace.weeks.map((week) => (
                <div key={week.weekStart} className={styles.week} data-current={week.current || undefined}>
                  <span className={styles.weekCount}>{whole(week.started)}</span>
                  <span className={styles.weekTrack}><span className={styles.weekBar} style={{ height: `${Math.max(4, (week.started / tallest) * 100)}%` }} /></span>
                  <span className={styles.weekLabel}>{week.current ? "สัปดาห์นี้" : weekLabel(week.weekStart)}</span>
                </div>
              ))}
            </div>
          </>}
          <p className={styles.note}>นับตามวันที่ Meta ระบุว่าเริ่มแสดง เป็นจำนวนขั้นต่ำ: แอดที่เปิดแล้วปิดระหว่างรอบเก็บจะไม่ถูกนับ · เฉลี่ยเฉพาะสัปดาห์ที่จบแล้ว</p>
        </div>

        {units ? (
          <div className={styles.cell} data-testid="summary-compare">
            <div className={styles.label}><Tile icon="compare" tone="compare" />เทียบกับแอดเรา</div>
            {units.length ? <>
              <p className={styles.headline}>{units.map((unit) => <span key={unit.unit_id} className={styles.unit}>{RELATION[unit.relation]}ของ <b>{unit.unit_name}</b></span>)}</p>
              {compareHref ? <Link className={styles.primary} href={compareHref} data-testid="summary-compare-link">เทียบกับแอดเรา {units[0].unit_name}</Link> : null}
            </> : <>
              <p className={styles.detail}>ยังไม่ได้จับคู่เพจนี้กับยูนิตของเรา</p>
              <Link className={styles.link} href="/competitors">จับคู่ที่หน้าติดตามคู่แข่ง ›</Link>
            </>}
            <p className={styles.note}>ทีมเป็นคนจับคู่เพจกับยูนิตที่หน้าติดตามคู่แข่ง · เทียบโดยเริ่มจากแอดที่ใช้ซ้ำมากที่สุด</p>
          </div>
        ) : null}
      </div>
      {open && top ? (
        <AdDrawer adArchiveId={top.ad_archive_id} datasetId={datasetId} canAnalyze={canAnalyze}
          compareHref={compareHref ?? undefined} onClose={() => setOpen(false)} />
      ) : null}
    </section>
  );
}
