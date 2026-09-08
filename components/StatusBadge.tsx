import styles from "./Badge.module.css";

/**
 * Active / Inactive / Unknown.
 *
 * `null` is unknown and gets its own neutral treatment — it is never folded into
 * inactive, and the word is always rendered so the colour is not doing the work
 * on its own.
 */
export function StatusBadge({ isActive, count }: {
  isActive: boolean | null | undefined;
  /**
   * How many ads are in this state, when the badge is summarising a set rather
   * than labelling one ad. The word is still rendered, so a row of three badges
   * reads as three named states and not as three coloured numbers.
   */
  count?: number;
}) {
  const [variant, label] =
    isActive === true ? ["ok", "Active"] as const
    : isActive === false ? ["neutral", "Inactive"] as const
    : ["neutral", "ไม่ทราบ"] as const;

  return (
    <span className={`${styles.badge} ${styles[variant]}`} data-status={String(isActive ?? "unknown")}>
      <span className={styles.dot} aria-hidden />
      {label}
      {count === undefined ? null : <span className={styles.count} data-numeral>{count}</span>}
    </span>
  );
}
