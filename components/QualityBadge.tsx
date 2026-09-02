import styles from "./Badge.module.css";

/**
 * Coverage tier. Thresholds are the canonical ones (>=80 normal, 50-79 partial,
 * <50 low) and are computed in the database — this only paints what it is told.
 *
 * It never renders a percentage on its own: a coverage figure without its
 * denominator is not something a reader can check, so callers pair this with
 * `present / total`.
 */
const VARIANT = { normal: "ok", partial: "warn", low: "danger" } as const;
const LABEL = { normal: "ปกติ", partial: "บางส่วน", low: "ต่ำ" } as const;

export type Tier = keyof typeof VARIANT;

export function QualityBadge({ tier }: { tier: Tier | string }) {
  const key = (tier in VARIANT ? tier : "low") as Tier;
  return (
    <span className={`${styles.badge} ${styles[VARIANT[key]]}`} data-tier={key}>
      {LABEL[key]}
    </span>
  );
}
