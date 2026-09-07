import Link from "next/link";
import styles from "./PageHeader.module.css";

/**
 * One page title treatment, so five pages stop each inventing their own.
 *
 * `eyebrow` is where a page says what kind of thing it is; `badge` is for a live
 * status that belongs beside the title rather than buried in the body.
 */
export function PageHeader({
  eyebrow, title, description, back, actions, badge,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {back ? <Link className={styles.back} href={back.href}>← {back.label}</Link> : null}
        {eyebrow ? <div className={styles.eyebrow} data-eyebrow>{eyebrow}</div> : null}
        <div className={styles.titleRow}>
          <h1>{title}</h1>
          {badge}
        </div>
        <span className={styles.rule} aria-hidden />
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
