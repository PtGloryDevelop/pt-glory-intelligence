import { coverageOf, formatShare } from "@/lib/domain/coverage-language";
import styles from "./CompareBars.module.css";

/**
 * One dimension, two pages, aligned.
 *
 * Not DistributionBars with a second series bolted on: that component describes
 * one set against one denominator, and the whole point here is that the two
 * sides keep separate denominators. A CTA readable on 12 of A's 20 ads and on
 * 18 of B's 60 is two different levels of confidence, and a shared coverage
 * number would describe neither.
 *
 * The bars are scaled to the larger of the two counts so the comparison is
 * visible, and the counts are printed either way — a bar is a hint, the number
 * is the fact.
 */

export type CompareBarItem = { value: string; a: number; b: number };

export function CompareBars({
  title, items, exclusive, coverage, testId, evidenceHref,
}: {
  title: string;
  items: CompareBarItem[];
  /** False for multi-value dimensions, whose shares may exceed 100%. */
  exclusive: boolean;
  coverage: { a: { covered: number; observed: number }; b: { covered: number; observed: number } };
  testId: string;
  /** Builds the link that opens one side's ads for one value. */
  evidenceHref?: (value: string, side: "a" | "b") => string;
}) {
  const a = coverageOf(coverage.a.covered, coverage.a.observed);
  const b = coverageOf(coverage.b.covered, coverage.b.observed);
  const denominator = (side: "a" | "b") =>
    exclusive ? coverage[side].covered : coverage[side].observed;

  const rows = [...items].sort((x, y) => (y.a + y.b) - (x.a + x.b));
  const peak = Math.max(1, ...rows.flatMap((row) => [row.a, row.b]));

  // The weaker of the two sides governs how the section may be described: a
  // comparison is only as representative as its thinner half.
  const weakest = a.ratio <= b.ratio ? a : b;

  return (
    <section className={styles.block} data-testid={testId}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.pairs} data-testid={`${testId}-coverage`}>
          A {a.pair} · B {b.pair}
        </span>
      </header>

      <p className={styles.qualifier} data-testid={`${testId}-qualifier`} data-tier={weakest.tier}>
        {exclusive
          ? weakest.representative
            ? "อ่านค่าได้เกือบครบทั้งสองฝั่ง"
            : "เปรียบเทียบเฉพาะ Ads ที่อ่านค่านี้ได้ — ความครอบคลุมสองฝั่งไม่เท่ากัน จึงไม่ใช่ภาพรวมของทั้งเพจ"
          : "หนึ่งโฆษณามีได้หลายค่า ผลรวมของแต่ละฝั่งจึงเกิน 100% ได้ และไม่ใช่สัดส่วนที่แบ่งกัน"}
      </p>

      {rows.length === 0 ? (
        <p className={styles.empty}>ไม่มีค่าที่อ่านได้ในทั้งสองฝั่ง</p>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.value} className={styles.row} data-testid={`${testId}-row`}>
              <span className={styles.name} title={row.value}>{row.value}</span>
              {(["a", "b"] as const).map((side) => (
                <span key={side} className={styles.side} data-side={side}>
                  <span className={styles.sideLabel} aria-hidden>{side.toUpperCase()}</span>
                  <span className={styles.track} aria-hidden>
                    <span
                      className={side === "a" ? styles.fillA : styles.fillB}
                      style={{ width: `${(row[side] / peak) * 100}%` }}
                    />
                  </span>
                  {evidenceHref && row[side] > 0 ? (
                    <a
                      className={styles.count}
                      href={evidenceHref(row.value, side)}
                      data-testid={`${testId}-evidence-${side}-${row.value}`}
                      data-numeral
                    >
                      {row[side]}
                    </a>
                  ) : (
                    <span className={styles.count} data-numeral>{row[side]}</span>
                  )}
                  <span className={styles.share}>{formatShare(row[side], denominator(side))}</span>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
