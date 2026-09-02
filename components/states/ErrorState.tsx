import styles from "./States.module.css";

/** Shows a server-supplied reason verbatim. Never invents one. */
export function ErrorState({
  title, detail, testId,
}: {
  title: string; detail?: string | null; testId?: string;
}) {
  return (
    <div role="status" className={styles.error} data-testid={testId}>
      <span className={styles.errorTitle}>{title}</span>
      {detail ? <p className={styles.errorDetail}>{detail}</p> : null}
    </div>
  );
}
