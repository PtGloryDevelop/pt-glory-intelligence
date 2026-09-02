import styles from "./States.module.css";

export function EmptyState({
  title, body, action, testId,
}: {
  title: string; body?: string; action?: React.ReactNode; testId?: string;
}) {
  return (
    <div className={styles.box} data-testid={testId}>
      <p className={styles.title}>{title}</p>
      {body ? <p className={styles.body}>{body}</p> : null}
      {action}
    </div>
  );
}
