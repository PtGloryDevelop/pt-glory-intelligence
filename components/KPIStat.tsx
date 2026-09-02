import styles from "./KPIStat.module.css";

/**
 * Presentation only.
 *
 * It renders a value someone else read from the database. It does no arithmetic,
 * holds no thresholds, and knows nothing about what the number means — a
 * component that computed its own figure would become a second definition of a
 * canonical count.
 */
export function KPIStat({
  label, value, helper, status, testId,
}: {
  label: string;
  value: React.ReactNode;
  /** Small caption under the value, e.g. a denominator or the unit. */
  helper?: React.ReactNode;
  /** A badge the caller already decided on. */
  status?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className={styles.stat} data-testid={testId}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {helper ? <div className={styles.helper}>{helper}</div> : null}
      {status ? <div className={styles.status}>{status}</div> : null}
    </div>
  );
}

/** Row of stats. Wraps rather than scrolls, so nothing is hidden on a phone. */
export function KPIRow({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return <div className={styles.row} data-testid={testId}>{children}</div>;
}
