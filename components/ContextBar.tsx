import styles from "./ContextBar.module.css";

export type ContextItem = { label: string; value: React.ReactNode; testId?: string };

/**
 * One shared context bar. Every value is passed in by a server component that
 * read it from the dataset's own collection run — this component derives
 * nothing and must never be given a "latest" value in a snapshot context.
 */
export function ContextBar({ items, testId = "context-bar" }: { items: ContextItem[]; testId?: string }) {
  return (
    <section className={styles.bar} data-testid={testId} aria-label="บริบทของข้อมูล">
      {items.map((item) => (
        <div key={item.label} className={styles.item}>
          <div className={styles.label}>{item.label}</div>
          <div className={styles.value} data-testid={item.testId}>{item.value}</div>
        </div>
      ))}
    </section>
  );
}
