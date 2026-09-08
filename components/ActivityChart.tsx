import { thaiDate } from "@/lib/format/date";
import styles from "./ActivityChart.module.css";

/**
 * Two series about one page, drawn side by side and never stacked.
 *
 * "PT Glory first observed this ad" and "Meta says the ad started running" are
 * different events, often months apart — an ad started in February and first
 * seen in September is one bar in each series, at opposite ends of the chart.
 * Summing them, or drawing them as one line, would invent a third quantity that
 * means nothing.
 *
 * Plain SVG: a charting library would be a dependency for forty rectangles, and
 * the axis labels here have to say which fact they belong to anyway.
 */

export type ActivityPoint = { bucket_start: string; first_seen_ads: number; started_ads: number };

export function ActivityChart({ points, bucket, testId = "page-activity" }: {
  points: ActivityPoint[];
  bucket: "day" | "week";
  testId?: string;
}) {
  if (points.length === 0) {
    return (
      <p className={styles.empty} data-testid={`${testId}-empty`}>
        ยังไม่มีกิจกรรมให้แสดงในขอบเขตนี้
      </p>
    );
  }

  const peak = Math.max(1, ...points.map((p) => Math.max(p.first_seen_ads, p.started_ads)));
  const width = Math.max(points.length * 26, 240);
  const height = 132;
  const floor = height - 22;

  return (
    <figure className={styles.figure} data-testid={testId}>
      <figcaption className={styles.legend}>
        <span className={styles.key}>
          <span className={`${styles.swatch} ${styles.firstSeen}`} aria-hidden />
          พบครั้งแรก (PT Glory เห็นครั้งแรก)
        </span>
        <span className={styles.key}>
          <span className={`${styles.swatch} ${styles.started}`} aria-hidden />
          เริ่มแสดง (วันที่ Meta ระบุ)
        </span>
        <span className={styles.unit}>ต่อ{bucket === "day" ? "วัน" : "สัปดาห์"}</span>
      </figcaption>

      <div className={styles.scroll}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={`กิจกรรมของเพจ: พบครั้งแรกและเริ่มแสดง ต่อ${bucket === "day" ? "วัน" : "สัปดาห์"}`}
        >
          <line x1="0" y1={floor} x2={width} y2={floor} className={styles.axis} />
          {points.map((point, index) => {
            const x = index * 26 + 4;
            const a = (point.first_seen_ads / peak) * (floor - 8);
            const b = (point.started_ads / peak) * (floor - 8);
            return (
              <g key={point.bucket_start} data-testid={`${testId}-bucket`}>
                <rect
                  className={styles.firstSeenBar}
                  x={x} y={floor - a} width="8" height={a}
                  data-value={point.first_seen_ads}
                >
                  <title>{`${thaiDate(point.bucket_start)} · พบครั้งแรก ${point.first_seen_ads}`}</title>
                </rect>
                <rect
                  className={styles.startedBar}
                  x={x + 10} y={floor - b} width="8" height={b}
                  data-value={point.started_ads}
                >
                  <title>{`${thaiDate(point.bucket_start)} · เริ่มแสดง ${point.started_ads}`}</title>
                </rect>
              </g>
            );
          })}
        </svg>
      </div>

      {/* The endpoints in words, because an unlabelled axis is a decoration. */}
      <p className={styles.range}>
        {thaiDate(points[0].bucket_start)} — {thaiDate(points[points.length - 1].bucket_start)}
        {" · "}สูงสุด {peak} รายการต่อ{bucket === "day" ? "วัน" : "สัปดาห์"}
      </p>
    </figure>
  );
}
