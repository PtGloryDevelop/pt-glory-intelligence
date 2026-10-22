import type { OfferChange } from "@/lib/pages/summary";
import styles from "./OfferChangeLine.module.css";

const day = (value: string) => new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });

/**
 * What changed in a page's ad copy since its previous collection round: offers and amounts newly
 * seen, and those the latest round's running ads no longer carried. Each round sees only what its
 * search returned, so "not seen" is said as that, never as "stopped".
 */
export function OfferChangeLine({ change, quiet = false }: { change: OfferChange | null; quiet?: boolean }) {
  if (!change) return quiet ? null : <p className={styles.line}>มีรอบเก็บรอบเดียว จะเทียบได้หลังเก็บรอบถัดไป</p>;
  const since = `เทียบรอบ ${day(change.previousAt)} (${change.previousAds} แอด) กับ ${day(change.latestAt)} (${change.latestAds} แอด)`;
  if (!change.added.length && !change.gone.length) return <p className={styles.line}>{since}: ข้อเสนอและราคาเหมือนเดิม</p>;
  return (
    <p className={styles.line} data-testid="offer-change">
      {since}:
      {change.added.length ? <span className={styles.added}>เพิ่งเห็น {change.added.join(", ")}</span> : null}
      {change.gone.length ? <span className={styles.gone}>รอบล่าสุดไม่เห็น {change.gone.join(", ")}</span> : null}
    </p>
  );
}
