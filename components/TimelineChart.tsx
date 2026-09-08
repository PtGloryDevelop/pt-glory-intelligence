import { thaiDate } from "@/lib/format/date";
import styles from "./TimelineChart.module.css";

/**
 * Two ad-property series over time, drawn once and listed once.
 *
 * The drawing is `aria-hidden`, because a chart that exists only as pixels is a
 * chart half the readers cannot use and nobody can click precisely. The list
 * below it is the real interface: every bucket is a link carrying its own
 * window, so the count and the ads behind it are the same query.
 *
 * The two series are never stacked. An ad that started in March and was first
 * seen in September appears once in each — a bar of height two would be a
 * quantity that does not exist.
 */

export type TimelineBucket = {
  bucket_start: string;
  started_ads: number;
  first_seen_ads: number;
};

export function TimelineChart({ points, grain, href, selected, testId = "timeline-chart" }: {
  points: TimelineBucket[];
  grain: "day" | "week";
  /** Builds the link for one bucket of one series. */
  href: (metric: "started" | "first_seen", bucketStart: string) => string;
  selected?: { metric: string; bucket: string } | null;
  testId?: string;
}) {
  if (points.length === 0) {
    return (
      <p className={styles.empty} data-testid={`${testId}-empty`}>
        ไม่มีโฆษณาของเพจนี้ในช่วงเวลาที่เลือก
      </p>
    );
  }

  const peak = Math.max(1, ...points.map((p) => Math.max(p.started_ads, p.first_seen_ads)));
  const step = 22;
  const width = Math.max(points.length * step, 260);
  const height = 148;
  const floor = height - 24;
  const unit = grain === "day" ? "วัน" : "สัปดาห์";

  return (
    <div className={styles.wrap} data-testid={testId}>
      <div className={styles.legend}>
        <span className={styles.key}>
          <span className={`${styles.swatch} ${styles.started}`} aria-hidden />
          เริ่มแสดง (วันที่ Meta ระบุ)
        </span>
        <span className={styles.key}>
          <span className={`${styles.swatch} ${styles.firstSeen}`} aria-hidden />
          PT Glory พบครั้งแรก
        </span>
        <span className={styles.unit}>ต่อ{unit} · สูงสุด {peak}</span>
      </div>

      {/* Decoration over the table below, not a second source of truth. */}
      <div className={styles.scroll}>
        <svg
          className={styles.svg} viewBox={`0 0 ${width} ${height}`}
          width={width} height={height} aria-hidden focusable="false"
        >
          <line x1="0" y1={floor} x2={width} y2={floor} className={styles.axis} />
          {points.map((point, index) => {
            const x = index * step + 3;
            const a = (point.started_ads / peak) * (floor - 10);
            const b = (point.first_seen_ads / peak) * (floor - 10);
            return (
              <g key={point.bucket_start}>
                <rect className={styles.startedBar} x={x} y={floor - a} width="7" height={a} />
                <rect className={styles.firstSeenBar} x={x + 9} y={floor - b} width="7" height={b} />
              </g>
            );
          })}
        </svg>
      </div>

      {/*
        * The accessible, clickable form. Only buckets that contain something are
        * listed: a year of empty weeks is not information, and scrolling past it
        * is how a reader misses the week that matters.
        */}
      <table className={styles.table} data-testid={`${testId}-buckets`}>
        <caption className={styles.caption}>
          ช่วงเวลาที่มีโฆษณา · แต่ละแถวเปิดดูโฆษณาที่นับไว้ได้
        </caption>
        <thead>
          <tr>
            <th scope="col">ช่วง{unit}</th>
            <th scope="col">เริ่มแสดง</th>
            <th scope="col">PT Glory พบครั้งแรก</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr
              key={point.bucket_start}
              data-testid="timeline-bucket"
              data-bucket={point.bucket_start}
            >
              <th scope="row" className={styles.bucketDate}>{thaiDate(point.bucket_start)}</th>
              <td>
                <BucketCell
                  n={point.started_ads}
                  href={href("started", point.bucket_start)}
                  active={selected?.metric === "started" && selected.bucket === point.bucket_start}
                  testId={`bucket-started-${point.bucket_start}`}
                />
              </td>
              <td>
                <BucketCell
                  n={point.first_seen_ads}
                  href={href("first_seen", point.bucket_start)}
                  active={selected?.metric === "first_seen" && selected.bucket === point.bucket_start}
                  testId={`bucket-first-seen-${point.bucket_start}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A count that can be opened, or a plain zero. Zero has nothing to show. */
function BucketCell({ n, href, active, testId }: {
  n: number; href: string; active: boolean; testId: string;
}) {
  if (n === 0) return <span className={styles.zero}>0</span>;
  return (
    <a
      className={active ? `${styles.count} ${styles.countOn}` : styles.count}
      href={href}
      data-testid={testId}
      aria-current={active ? "true" : undefined}
      data-numeral
    >
      {n}
    </a>
  );
}
