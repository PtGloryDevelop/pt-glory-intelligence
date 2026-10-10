"use client";

import type { CompanyAd } from "@/lib/owned-ads/source-rows";
import type { OwnedMediaMembers } from "@/lib/owned-ads/performance";
import { AdStatus } from "./owned-client";
import { useJson } from "./use-json";
import styles from "./media-members.module.css";

const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
/** Meta's ISO time as a Bangkok calendar date. */
export const bangkokDate = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time + 7 * 3600000).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
};
const keyOf = (ad: { account_id: string; ad_id: string }) => `${ad.account_id}:${ad.ad_id}`;

/**
 * The ads behind one creative card, inside its detail drawer. Picking one shows that ad's own
 * figures in the same drawer; "ผลรวมของสื่อ" goes back to the creative's sum.
 */
export function MediaMembers({ mediaKey, count, filters, current, onPick, onTotal }: {
  mediaKey: string; count: number; filters: string; current: string | null;
  onPick: (ad: CompanyAd) => void; onTotal: () => void;
}) {
  const members = useJson<OwnedMediaMembers>(`/api/owned-ads/performance/members?${filters}${filters ? "&" : ""}media_key=${encodeURIComponent(mediaKey)}`);
  const rows = members.data?.rows ?? [];
  const total = members.data?.total ?? count;
  return <section className={styles.members} aria-labelledby="media-members-title" data-testid="media-members">
    <div className={styles.head}>
      <h3 id="media-members-title">แอดทั้งหมดของสื่อนี้ · {number(total)} แอด</h3>
      {current ? <button type="button" onClick={onTotal} data-testid="media-members-total">← ดูผลรวมของสื่อ</button> : null}
    </div>
    <p className={styles.note}>ใช้วิดีโอหรือภาพเดียวกัน · เรียงจากค่าแอดมากไปน้อยในช่วงที่เลือก{total > rows.length && rows.length ? ` · แสดง ${number(rows.length)} แอดแรก` : ""}</p>
    {members.error ? <p className={styles.note} role="alert">{members.error}</p> : null}
    {!members.data && !members.error ? <p className={styles.note} role="status">กำลังเปิดรายการแอด…</p> : null}
    <ol className={styles.list}>{rows.map(ad => <li key={keyOf(ad)}>
      <button type="button" aria-pressed={current === keyOf(ad)} onClick={() => onPick(ad)} data-testid={`media-member-${ad.ad_id}`}>
        <span className={styles.name}><b title={ad.campaign_name}>{ad.campaign_name}</b><small>{ad.adset_name ?? "ไม่ทราบชุดโฆษณา"} · {ad.account_name}</small></span>
        <span className={styles.meta}><AdStatus status={ad.status} /><small>สร้าง {bangkokDate(ad.created_time)}</small></span>
        <span className={styles.nums}><span>ค่าแอด <b>{number(ad.spend)}</b></span><span>ROAS <b>{number(ad.roas)}</b></span><span>ทัก <b>{number(ad.conversations)}</b></span></span>
      </button>
    </li>)}</ol>
  </section>;
}
