import { coverageOf, formatShare } from "@/lib/domain/coverage-language";
import styles from "./DistributionBars.module.css";

/**
 * A distribution, with the denominator it was computed from.
 *
 * Horizontal bars rather than a pie, and not only for the multi-value
 * dimensions: a pie asserts that its slices are the whole and are mutually
 * exclusive. `publisher_platform` and `page_categories` are neither — one ad
 * runs on four platforms — so their shares sum past 100% and a pie of them
 * would be a drawn falsehood.
 *
 * `exclusive: false` is therefore not a styling flag. It changes the sentence
 * above the bars and the denominator each row is divided by.
 */

export type DistributionItem = { value: string; n: number };

/** Rows shown before the tail folds away. */
const VISIBLE = 10;

export function DistributionBars({
  title, items, covered, observed, exclusive, testId, evidenceHref,
}: {
  title: string;
  items: DistributionItem[];
  /** Ads in which this field was readable at all. */
  covered: number;
  /** Ads in scope. The denominator behind coverage. */
  observed: number;
  exclusive: boolean;
  testId: string;
  /** Builds the link that opens the ads behind one value, when there is one. */
  evidenceHref?: (value: string) => string;
}) {
  const coverage = coverageOf(covered, observed);
  // An exclusive field divides by what was readable; a multi-value field divides
  // by the ads observed, because one ad can appear in several rows.
  const denominator = exclusive ? covered : observed;
  const top = [...items].sort((a, b) => b.n - a.n);
  const widest = top[0]?.n ?? 0;
  /*
   * A multi-value field can have sixty readable values, and page_category does.
   * The long tail is real and stays reachable, but folded: sixty rows of 0.1%
   * buried the panels under this one, and nobody scrolls a bar chart to find
   * the row that matters. The fold is a <details>, so it works without script
   * and prints open.
   */
  const head = top.slice(0, VISIBLE);
  const tail = top.slice(VISIBLE);

  return (
    <section className={styles.block} data-testid={testId}>
      <header className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        <span className={styles.pair} data-testid={`${testId}-denominator`}>{coverage.pair}</span>
      </header>

      {/*
        * The sentence that keeps a percentage honest. Below 80% readable it says
        * so in words, because "42% ใช้ Send Message" and "42% ของโฆษณาที่อ่าน CTA
        * ได้ใช้ Send Message" are different claims and only one of them is
        * supported by the rows.
        */}
      <p className={styles.qualifier} data-testid={`${testId}-qualifier`} data-tier={coverage.tier}>
        {exclusive
          ? coverage.qualifier
          : `นับเป็นสัดส่วนของโฆษณา ${observed.toLocaleString("th-TH")} รายการที่มีค่านี้ — หนึ่งโฆษณามีได้หลายค่า ผลรวมจึงเกิน 100% ได้`}
      </p>

      {top.length === 0 ? (
        <p className={styles.empty}>ไม่มีค่าที่อ่านได้ในขอบเขตนี้</p>
      ) : (
        <>
          <ul className={styles.list}>
            {head.map((item) => (
              <Row
                key={item.value} item={item} widest={widest} denominator={denominator}
                testId={testId} evidenceHref={evidenceHref}
              />
            ))}
          </ul>
          {tail.length > 0 ? (
            <details className={styles.more} data-testid={`${testId}-more`}>
              <summary className={styles.moreSummary}>
                ดูอีก {tail.length.toLocaleString("th-TH")} ค่า · ค่าละไม่เกิน{" "}
                {formatShare(tail[0].n, denominator)}
              </summary>
              <ul className={styles.list}>
                {tail.map((item) => (
                  <Row
                    key={item.value} item={item} widest={widest} denominator={denominator}
                    testId={testId} evidenceHref={evidenceHref}
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}

/** One value: its name, its bar, its count and its share of the stated base. */
function Row({ item, widest, denominator, testId, evidenceHref }: {
  item: DistributionItem;
  widest: number;
  denominator: number;
  testId: string;
  evidenceHref?: (value: string) => string;
}) {
  return (
    <li className={styles.row} data-testid={`${testId}-row`}>
      <span className={styles.name} title={item.value}>
        {/* The placeholder bucket is "the collector could not read this",
            which is not a value anything can be filtered by. */}
        {evidenceHref && item.value !== "—" ? (
          <a href={evidenceHref(item.value)} data-testid={`${testId}-evidence-${item.value}`}>
            {item.value}
          </a>
        ) : item.value}
      </span>
      <span className={styles.track} aria-hidden>
        <span
          className={styles.fill}
          style={{ width: `${widest === 0 ? 0 : (item.n / widest) * 100}%` }}
        />
      </span>
      <span className={styles.count} data-numeral>{item.n}</span>
      <span className={styles.share}>{formatShare(item.n, denominator)}</span>
    </li>
  );
}
