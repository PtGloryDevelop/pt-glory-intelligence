import { coverageOf } from "@/lib/domain/coverage-language";
import { pointChange, share } from "@/lib/trends/periods";
import styles from "./TrendMix.module.css";

/**
 * One creative dimension, as it stood at the end of each period.
 *
 * Not CompareBars with the labels changed: that component compares two pages
 * under one coverage question, and this one compares two moments whose coverage
 * can differ for a reason that matters — a field readable in 90% of one
 * reference view and 40% of the other has not changed advertising, it has
 * changed how much we could read.
 *
 * Shares move in PERCENTAGE POINTS. 40% → 55% is +15 pp, not +37.5%; both are
 * arithmetically true and only one is what a reader means, so the unit is
 * printed rather than assumed.
 */

export type TrendMixItem = { value: string; current: number; previous: number };

export function TrendMix({
  title, items, exclusive, coverage, testId, evidenceHref,
}: {
  title: string;
  items: TrendMixItem[];
  /** False for multi-value dimensions, whose shares may exceed 100%. */
  exclusive: boolean;
  coverage: {
    current: { covered: number; observed: number };
    previous: { covered: number; observed: number };
  };
  testId: string;
  evidenceHref?: (value: string, period: "current" | "previous") => string;
}) {
  const current = coverageOf(coverage.current.covered, coverage.current.observed);
  const previous = coverageOf(coverage.previous.covered, coverage.previous.observed);
  const denominator = (period: "current" | "previous") =>
    exclusive ? coverage[period].covered : coverage[period].observed;

  const rows = [...items].sort((a, b) => (b.current + b.previous) - (a.current + a.previous));
  // The thinner of the two views governs what may be said about the pair.
  const weakest = current.ratio <= previous.ratio ? current : previous;

  return (
    <section className={styles.block} data-testid={testId}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.pairs} data-testid={`${testId}-coverage`}>
          ช่วงนี้ {current.pair} · ช่วงก่อน {previous.pair}
        </span>
      </header>

      <p className={styles.qualifier} data-testid={`${testId}-qualifier`} data-tier={weakest.tier}>
        {exclusive
          ? weakest.representative
            ? "อ่านค่าได้เกือบครบทั้งสองช่วง"
            : "เทียบเฉพาะ Ads ที่อ่านค่านี้ได้ — ความครอบคลุมสองช่วงไม่เท่ากัน การเปลี่ยนแปลงจึงอาจมาจากการอ่านค่าได้มากขึ้นหรือน้อยลง"
          : "หนึ่งโฆษณามีได้หลายค่า ผลรวมของแต่ละช่วงจึงเกิน 100% ได้ และไม่ใช่สัดส่วนที่แบ่งกัน"}
      </p>

      {rows.length === 0 ? (
        <p className={styles.empty}>ไม่มีค่าที่อ่านได้ในทั้งสองช่วง</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">ค่า</th>
              <th scope="col">ช่วงนี้</th>
              <th scope="col">ช่วงก่อน</th>
              <th scope="col">ต่าง</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const currentShare = share(row.current, denominator("current"));
              const previousShare = share(row.previous, denominator("previous"));
              const points = pointChange(currentShare, previousShare);
              return (
                <tr key={row.value} data-testid={`${testId}-row`}>
                  <th scope="row" className={styles.name} title={row.value}>{row.value}</th>
                  {(["current", "previous"] as const).map((period) => {
                    const n = period === "current" ? row.current : row.previous;
                    const percent = period === "current" ? currentShare : previousShare;
                    return (
                      <td key={period} className={styles.cell}>
                        {evidenceHref && n > 0 ? (
                          <a
                            href={evidenceHref(row.value, period)}
                            data-testid={`${testId}-evidence-${period}-${row.value}`}
                            data-numeral
                          >
                            {n}
                          </a>
                        ) : (
                          <span data-numeral>{n}</span>
                        )}
                        <span className={styles.share}>{percent.toFixed(1)}%</span>
                      </td>
                    );
                  })}
                  {/* Percentage points, with the unit written out. */}
                  <td className={styles.points} data-testid={`${testId}-points-${row.value}`}>
                    {points.label}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
