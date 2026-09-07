import styles from "./Surface.module.css";

type Level = "1" | "highlight" | "tint";

/**
 * A level-1 (or tinted level-2) surface.
 *
 * `padded` is off by default because the most common case — a table — wants to
 * reach the panel edges.
 */
export function Panel({
  children, level = "1", padded = false, raised = false, className = "", testId,
}: {
  children: React.ReactNode;
  level?: Level;
  padded?: boolean;
  raised?: boolean;
  className?: string;
  testId?: string;
}) {
  const tone = level === "highlight" ? styles.highlight : level === "tint" ? styles.tint : "";
  return (
    <section
      data-testid={testId}
      className={[styles.panel, tone, padded ? styles.padded : "", raised ? styles.raised : "", className]
        .filter(Boolean).join(" ")}
    >
      {children}
    </section>
  );
}

export function PanelHead({ title, meta }: { title: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className={styles.head}>
      <span className={styles.title}>{title}</span>
      {meta ? <span className={styles.meta}>{meta}</span> : null}
    </div>
  );
}

/** Wraps a wide table so it scrolls inside its panel instead of the page. */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className={styles.tableWrap}>{children}</div>;
}
