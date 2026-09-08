import { fieldRank } from "@/lib/domain/quality-tier";
import { QualityBadge } from "./QualityBadge";
import styles from "./QualityStrip.module.css";

export type QualityItem = {
  field: string;
  presentCount: number;
  totalCount: number;
  /** 0..1, computed in the database. Never recomputed here. */
  coverage: number;
  tier: string;
};

/**
 * The one coverage table. Dataset Detail and the import preview both render
 * this, so "485 / 500" means the same thing and looks the same in both places.
 *
 * It formats what it is given and orders it. It never sums fields into a group
 * score: adding body_text and cta_type together would produce a denominator no
 * stored row supports.
 */

/** How many priority fields stay open before the rest fold into the details. */
const LEAD = 6;

export function QualityStrip({
  rows, testId, rowPrefix = "quality", warningPrefix = "quality-warning",
}: {
  rows: QualityItem[];
  testId: string;
  /** data-testid prefix per row, so existing route tests keep their handles. */
  rowPrefix?: string;
  warningPrefix?: string;
}) {
  const ordered = [...rows].sort((a, b) => fieldRank(a.field) - fieldRank(b.field) || a.field.localeCompare(b.field));
  const lead = ordered.slice(0, LEAD);
  const rest = ordered.slice(LEAD);

  return (
    <div className={styles.wrap}>
      <Table rows={lead} testId={testId} rowPrefix={rowPrefix} warningPrefix={warningPrefix} />
      {ordered.some((row) => row.tier !== "normal") ? (
        <p className={styles.footnote}>
          {ordered.some((row) => row.tier === "unknown")
            ? "ฟิลด์ระดับ “ยังไม่วัด” คือยังไม่ได้วัดความครอบคลุม ไม่ใช่ค่าที่วัดแล้วได้ผลแย่ · "
            : ""}
          ฟิลด์ที่ไม่ใช่ระดับปกติ อ้างได้เฉพาะในกลุ่มที่อ่านค่าได้ ไม่ใช่ทั้งชุดข้อมูล
        </p>
      ) : null}
      {rest.length ? (
        <details className={styles.more} data-testid={`${testId}-more`}>
          <summary>ดู Data Quality ทั้งหมด ({ordered.length} ฟิลด์)</summary>
          <Table rows={rest} testId={`${testId}-rest`} rowPrefix={rowPrefix} warningPrefix={warningPrefix} />
        </details>
      ) : null}
    </div>
  );
}

function Table({
  rows, testId, rowPrefix, warningPrefix,
}: {
  rows: QualityItem[]; testId: string; rowPrefix: string; warningPrefix: string;
}) {
  return (
    // Scrolls inside itself rather than dragging the page sideways; below 640px
    // the rows restack (see the stylesheet) so the warning text keeps its width.
    <div className={styles.scroll}>
      <table className={styles.table} data-testid={testId}>
        <thead>
          <tr><th>ฟิลด์</th><th>พบ / ทั้งหมด</th><th>สัดส่วน</th><th>ระดับ</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} data-testid={`${rowPrefix}-${row.field}`}>
              <td data-label="ฟิลด์" className={styles.field}>{row.field}</td>
              {/* A percentage without its denominator is not a fact anyone can check. */}
              <td data-label="พบ / ทั้งหมด">{row.presentCount} / {row.totalCount}</td>
              <td data-label="สัดส่วน">{(row.coverage * 100).toFixed(1)}%</td>
              <td data-label="ระดับ">
                <QualityBadge tier={row.tier} />
                <Warning tier={row.tier} testId={`${warningPrefix}-${row.field}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Three different sentences, because the three tiers mean different things.
 * "unknown" is the one that must not sound like a verdict: no row was computed,
 * which is not the same as a field that scored badly.
 */
function Warning({ tier, testId }: { tier: string; testId: string }) {
  if (tier === "normal") return null;
  const text =
    tier === "unknown"
      ? "ยังไม่ได้วัดความครอบคลุมของฟิลด์นี้"
      : "อ้างได้เฉพาะในกลุ่มที่อ่านค่าได้ ไม่ใช่ทั้งชุดข้อมูล";
  // The sentence stays on the row for assistive technology and for the tests,
  // but it is no longer repeated as visible text five times over — printed on
  // every non-normal row it wrapped, and six rows of it was 413px of screen
  // before the user reached a single ad. The visible version is one footnote
  // under the table.
  return <span data-testid={testId} className={styles.warning} title={text}>{text}</span>;
}

