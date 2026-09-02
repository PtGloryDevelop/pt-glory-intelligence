import styles from "./States.module.css";

export function LoadingSkeleton({ rows = 3, label = "กำลังโหลด…" }: { rows?: number; label?: string }) {
  return (
    <div className={styles.skeleton} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className={styles.bar} style={{ width: `${100 - index * 12}%` }} />
      ))}
    </div>
  );
}
