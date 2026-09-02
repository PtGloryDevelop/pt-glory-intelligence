import styles from "./Badge.module.css";

/**
 * Active / Inactive / Unknown.
 *
 * `null` is unknown and gets its own neutral treatment — it is never folded into
 * inactive, and the word is always rendered so the colour is not doing the work
 * on its own.
 */
export function StatusBadge({ isActive }: { isActive: boolean | null | undefined }) {
  const [variant, label] =
    isActive === true ? ["ok", "Active"] as const
    : isActive === false ? ["neutral", "Inactive"] as const
    : ["neutral", "ไม่ทราบ"] as const;

  return (
    <span className={`${styles.badge} ${styles[variant]}`} data-status={String(isActive ?? "unknown")}>
      <span className={styles.dot} aria-hidden />
      {label}
    </span>
  );
}
