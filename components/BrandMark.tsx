import styles from "./BrandMark.module.css";

type Size = "sm" | "md" | "lg";

/** The mark on its own — used where the words would not fit, e.g. the nav rail. */
export function BrandMark({ size = "sm" }: { size?: Size }) {
  return (
    <span className={`${styles.mark} ${styles[size]}`} aria-hidden>
      PTG
      <span className={styles.dot} />
    </span>
  );
}

/** Mark plus wordmark. `tagline` is optional so the sidebar can stay compact. */
export function BrandLockup({
  size = "sm", tagline,
}: {
  size?: Size; tagline?: string;
}) {
  const nameClass = { sm: styles.nameSm, md: styles.nameMd, lg: styles.nameLg }[size];
  return (
    <div className={styles.lockup}>
      <BrandMark size={size} />
      <div className={styles.words}>
        <div className={`${styles.name} ${nameClass}`}>PT Glory</div>
        {tagline ? <div className={styles.tagline}>{tagline}</div> : null}
      </div>
    </div>
  );
}
