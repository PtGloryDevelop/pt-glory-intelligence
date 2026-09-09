import { thaiDate } from "@/lib/format/date";
import styles from "./CompareChart.module.css";

/**
 * One clock, one window, two pages.
 *
 * Deliberately not TimelineChart with the series relabelled: that component
 * draws two clocks for one page, and this one draws one clock for two pages.
 * Reusing it would mean a legend that says "เริ่มแสดง / พบครั้งแรก" over bars
 * that mean "A / B" — drawn correctly and read wrongly.
 *
 * Same accessibility shape as the frozen chart: the drawing is decoration, the
 * table underneath is the interface, and every bucket is a link on each side.
 */

export type ComparePoint = { bucket_start: string; a_ads: number; b_ads: number };

export function CompareChart({
  points, grain, clockLabel, clockSource, names, href, selected, testId = "compare-chart",
}: {
  points: ComparePoint[];
  grain: "day" | "week";
  /** Which clock this chart counts — named where it is drawn. */
  clockLabel: string;
  clockSource: string;
  names: { a: string; b: string };
  href?: (bucketStart: string, side: "a" | "b") => string;
  selected?: { bucket: string; side: string } | null;
  testId?: string;
}) {
  const unit = grain === "day" ? "วัน" : "สัปดาห์";

  if (points.length === 0) {
    return (
      <p className={styles.empty} data-testid={`${testId}-empty`}>
        ไม่มีโฆษณาของทั้งสองเพจในช่วงเวลาที่เลือก
      </p>
    );
  }

  const peak = Math.max(1, ...points.map((point) => Math.max(point.a_ads, point.b_ads)));
  const step = 22;
  const width = Math.max(points.length * step, 260);
  const height = 148;
  const floor = height - 24;

  return (
    <div className={styles.wrap} data-testid={testId}>
      <p className={styles.clock} data-testid={`${testId}-clock`}>
        <strong>{clockLabel}</strong> — {clockSource}
      </p>

      <div className={styles.legend}>
        <span className={styles.key}>
          <span className={`${styles.swatch} ${styles.a}`} aria-hidden />A · {names.a}
        </span>
        <span className={styles.key}>
          <span className={`${styles.swatch} ${styles.b}`} aria-hidden />B · {names.b}
        </span>
        <span className={styles.unit}>ต่อ{unit} · สูงสุด {peak}</span>
      </div>

      <div className={styles.scroll}>
        <svg
          className={styles.svg} viewBox={`0 0 ${width} ${height}`}
          width={width} height={height} aria-hidden focusable="false"
        >
          <line x1="0" y1={floor} x2={width} y2={floor} className={styles.axis} />
          {points.map((point, index) => {
            const x = index * step + 3;
            const a = (point.a_ads / peak) * (floor - 10);
            const b = (point.b_ads / peak) * (floor - 10);
            return (
              <g key={point.bucket_start}>
                <rect className={styles.barA} x={x} y={floor - a} width="7" height={a} />
                <rect className={styles.barB} x={x + 9} y={floor - b} width="7" height={b} />
              </g>
            );
          })}
        </svg>
      </div>

      <table className={styles.table} data-testid={`${testId}-buckets`}>
        <caption className={styles.caption}>
          {clockLabel} ต่อ{unit} · แต่ละตัวเลขเปิดดูโฆษณาที่นับไว้ได้
        </caption>
        <thead>
          <tr>
            <th scope="col">ช่วง{unit}</th>
            <th scope="col">A</th>
            <th scope="col">B</th>
            <th scope="col">ต่าง</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => {
            const difference = point.a_ads - point.b_ads;
            return (
              <tr key={point.bucket_start} data-testid="compare-bucket" data-bucket={point.bucket_start}>
                <th scope="row" className={styles.date}>{thaiDate(point.bucket_start)}</th>
                {(["a", "b"] as const).map((side) => {
                  const n = side === "a" ? point.a_ads : point.b_ads;
                  const active = selected?.bucket === point.bucket_start && selected.side === side;
                  return (
                    <td key={side}>
                      {n === 0 || !href ? (
                        <span className={styles.zero} data-numeral>{n}</span>
                      ) : (
                        <a
                          className={active ? `${styles.count} ${styles.on}` : styles.count}
                          href={href(point.bucket_start, side)}
                          data-testid={`compare-bucket-${side}-${point.bucket_start}`}
                          aria-current={active ? "true" : undefined}
                          data-numeral
                        >
                          {n}
                        </a>
                      )}
                    </td>
                  );
                })}
                {/* Arithmetic, stated as arithmetic. */}
                <td className={styles.delta} data-numeral>
                  {difference === 0 ? "—" : `${difference > 0 ? "A" : "B"} +${Math.abs(difference)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
