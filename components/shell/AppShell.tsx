"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV } from "./nav.ts";
import styles from "./AppShell.module.css";

/**
 * Sidebar + main column for every authenticated page.
 *
 * Client-side only for the collapse toggle and the active-route highlight. It
 * receives the actor's role as a prop rather than reading it — authorization
 * stays on the server, and the shell only displays what the server decided.
 */
export function AppShell({ role, children }: { role: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [railed, setRailed] = useState(false);
  const [open, setOpen] = useState(false);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <div className={styles.shell}>
      <aside
        className={[styles.sidebar, railed ? styles.rail : "", open ? styles.open : ""].join(" ")}
        data-testid="app-sidebar"
        data-state={railed ? "rail" : "expanded"}
      >
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden>PT</span>
          <span className={styles.brandText}>PT Glory</span>
        </div>

        <nav className={styles.nav} aria-label="เมนูหลัก">
          {NAV.map((section) => (
            <div key={section.heading}>
              <div className={styles.heading}>{section.heading}</div>
              {section.items.map((item) =>
                item.href ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={[styles.item, isActive(item.href) ? styles.active : ""].join(" ")}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    data-testid={`nav-${item.href}`}
                    // In rail mode the label is display:none, which would leave
                    // the link with no accessible name and nothing but a dot to
                    // identify it. The title carries both.
                    title={item.label}
                    onClick={() => setOpen(false)}
                  >
                    <span className={styles.dot} aria-hidden />
                    <span className={styles.label}>{item.label}</span>
                  </Link>
                ) : (
                  // Reference-only until its own phase. Rendered so the shell is
                  // recognisable, disabled so it cannot promise data we lack.
                  <span
                    key={item.label}
                    className={styles.disabled}
                    aria-disabled="true"
                    title={`${item.label} — ยังไม่เปิดใช้งานในเฟสนี้`}
                  >
                    <span className={styles.dot} aria-hidden />
                    <span className={styles.label}>{item.label}</span>
                  </span>
                ),
              )}
            </div>
          ))}
        </nav>

        <button type="button" className={styles.collapse} onClick={() => setRailed((v) => !v)}>
          {railed ? "»" : "« ย่อเมนู"}
        </button>
        <div className={styles.footer} data-testid="shell-role">สิทธิ์ {role}</div>
      </aside>

      {open ? (
        <button
          type="button" className={styles.scrim} aria-label="ปิดเมนู"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className={styles.main}>
        <div className={styles.topbar}>
          <button type="button" onClick={() => setOpen(true)} aria-label="เปิดเมนู">☰</button>
          <strong>PT Glory</strong>
        </div>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
