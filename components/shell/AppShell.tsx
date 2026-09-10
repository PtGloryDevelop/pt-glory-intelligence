"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV } from "./nav.ts";
import { Icon } from "./icons.tsx";
import { BrandLockup, BrandMark } from "../BrandMark.tsx";
import { signOut } from "../../app/(app)/sign-out.ts";
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

  // A dataset page carries the research grid, which genuinely wants the canvas.
  // Every other page reads better at a fixed measure.
  const isWide = /^\/datasets\/[^/]+/.test(pathname);

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
          <span className={styles.lockup}><BrandLockup tagline="Ads Intelligence" /></span>
          <span className={styles.markOnly}><BrandMark /></span>
        </div>

        <nav className={styles.nav} aria-label="เมนูหลัก">
          {/*
            * Built first, unbuilt last.
            *
            * The menu used to interleave nine unbuilt destinations among eleven
            * working ones, so finding a screen meant discovering by clicking
            * which greyed-out entries were decoration. Each section now leads
            * with what works; anything without a route sinks to the end of its
            * section, still visible so the shape of the product is legible, but
            * never in the way of the thing somebody came to open.
            */}
          {NAV.map((section) => (
            <div key={section.heading}>
              <div className={styles.heading}>{section.heading}</div>
              {[...section.items]
                .sort((a, b) => Number(Boolean(b.href)) - Number(Boolean(a.href)))
                .map((item) =>
                item.href ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={[styles.item, isActive(item.href) ? styles.active : ""].join(" ")}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    data-testid={`nav-${item.href}`}
                    // In rail mode the label is display:none, which would leave
                    // the link with no accessible name and nothing but an icon
                    // to identify it. The title carries the name.
                    title={item.label}
                    onClick={() => setOpen(false)}
                  >
                    <span className={styles.icon}><Icon name={item.icon} /></span>
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
                    <span className={styles.icon}><Icon name={item.icon} /></span>
                    <span className={styles.label}>{item.label}</span>
                    {/* Said once, in place, rather than hidden in a tooltip
                        nobody hovers on a phone. */}
                    <span className={styles.soon}>เร็ว ๆ นี้</span>
                  </span>
                ),
              )}
            </div>
          ))}
        </nav>

        <button type="button" className={styles.collapse} onClick={() => setRailed((v) => !v)}>
          {railed ? "»" : "« ย่อเมนู"}
        </button>
        <div className={styles.footer}>
          <span data-testid="shell-role">สิทธิ์ {role}</span>
          {/* A server action, not a click handler: the session is a cookie, and
              only a server response can clear one. */}
          <form action={signOut}>
            <button type="submit" className={styles.signOut} data-testid="sign-out">
              ออกจากระบบ
            </button>
          </form>
        </div>
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
          <BrandLockup />
        </div>
        {/* A dataset page carries the research grid, which genuinely wants the
            canvas. Every other page reads better at a fixed measure. */}
        <div
          className={styles.content}
          data-testid="shell-content"
          data-width={isWide ? "wide" : undefined}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
