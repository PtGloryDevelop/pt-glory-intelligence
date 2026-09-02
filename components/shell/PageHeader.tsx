import Link from "next/link";
import styles from "./PageHeader.module.css";

/** One page title treatment, so five pages stop each inventing their own. */
export function PageHeader({
  title, description, back, actions,
}: {
  title: string;
  description?: string;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {back ? <Link className={styles.back} href={back.href}>← {back.label}</Link> : null}
        <h1>{title}</h1>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
