"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NavSection } from "./nav.ts";
import type { Freshness } from "../../lib/shell/freshness.ts";
import { Icon } from "./icons.tsx";
import { signOut } from "../../app/(app)/sign-out.ts";
import styles from "./AppShell.module.css";

/**
 * Sidebar + main column for every authenticated page.
 *
 * Client-side only for the collapse toggle and the active-route highlight. It
 * receives the actor's role AND the menu that role may see as props rather than
 * reading either — authorization stays on the server, and the shell only
 * displays what the server decided. Filtering here instead would ship every
 * admin label to every browser and call CSS a permission.
 */
export function AppShell(
  { role, sections, freshness, children }:
  { role: string; sections: NavSection[]; freshness?: Freshness; children: React.ReactNode },
) {
  const pathname = usePathname();
  const [railed, setRailed] = useState(false);
  const [open, setOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = menuButton.current;
    const mobile = window.matchMedia('(max-width: 900px)');
    const resized = () => { if (!mobile.matches) setOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const controls = [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),summary') ?? [])].filter(element => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', keyboard);
    mobile.addEventListener('change', resized);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keyboard);
      mobile.removeEventListener('change', resized);
      opener?.focus();
    };
  }, [open]);

  // A dataset page carries the research grid, which genuinely wants the canvas.
  // Every other page reads better at a fixed measure.
  const isWide = pathname === "/" || /^\/datasets\/[^/]+/.test(pathname)
    || pathname === "/competitors" || pathname === "/owned-ads" || pathname === "/owned-ads/performance" || pathname === "/compare/ads" || pathname === "/command-center";

  const activeItem=sections.flatMap(section=>section.items).filter(item=>item.href&&(item.href==='/'?pathname==='/':pathname===item.href||pathname.startsWith(`${item.href}/`))).sort((a,b)=>(b.href?.length??0)-(a.href?.length??0))[0];
  const isActive = (href: string) => activeItem?.href===href;

  return (
    <div className={styles.shell}>
      <a href="#workspace-content" className={styles.skipLink}>ข้ามไปเนื้อหา</a>
      <aside
        ref={sidebar}
        id="workspace-menu"
        role={open ? 'dialog' : undefined}
        aria-label={open ? 'เมนูหลัก' : undefined}
        aria-modal={open || undefined}
        className={[styles.sidebar, railed ? styles.rail : "", open ? styles.open : ""].join(" ")}
        data-testid="app-sidebar"
        data-state={railed ? "rail" : "expanded"}
      >
        <div className={styles.brand}>
          <Link href="/" className={styles.wordmark} aria-label="PT Glory หน้าแรก">
            <Image className={styles.logo} src="/logo/pt-mark.png" alt="" width={36} height={36} priority />
            <span className={styles.lockup}>PT GLORY<small>AD INTELLIGENCE</small></span>
          </Link>
          <button type="button" className={styles.mobileClose} aria-label="ปิดเมนูหลัก" onClick={() => setOpen(false)}>×</button>
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
          {sections.map((section,index) => {
            const links=<>
              {index===0?<div className={styles.heading}>{section.heading}</div>:null}
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
            </>;
            return index===0?<div key={section.heading}>{links}</div>:<details key={section.heading} className={styles.advanced} open={section.items.some(item=>item.href&&isActive(item.href))||undefined}><summary>{section.heading}</summary>{links}</details>;
          })}
        </nav>

        <div className={styles.workspaceNote}><span>พื้นที่วิจัยของทีม</span><small>ค้นหลักฐาน · เปรียบเทียบ · ตัดสินใจ</small></div>
        <button type="button" className={styles.collapse} aria-label={railed ? 'ขยายเมนู' : 'ย่อเมนู'} aria-expanded={!railed} onClick={() => setRailed((v) => !v)}>
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

      <div className={styles.main} inert={open}>
        <div className={styles.topbar}>
          <button ref={menuButton} type="button" onClick={() => setOpen(true)} aria-label="เปิดเมนู" aria-expanded={open} aria-controls="workspace-menu">☰</button>
          <span className={styles.breadcrumb}>PT GLORY <span>/</span> <strong>{activeItem?.label??'ข้อมูลการตลาด'}</strong></span>
          <span className={styles.freshness} data-testid="shell-freshness">
            {[freshness?.owned, freshness?.rivals].filter(chip => chip != null).map(chip => (
              <span key={chip.label} className={styles.fresh} title={chip.stale ? "ข้อมูลเก่ากว่าที่ควร" : undefined}>
                <span className={chip.stale ? styles.dotWarn : styles.dot} aria-hidden />{chip.label}
              </span>
            ))}
          </span>
        </div>
        {/* A dataset page carries the research grid, which genuinely wants the
            canvas. Every other page reads better at a fixed measure. */}
        <main
          id="workspace-content"
          tabIndex={-1}
          className={styles.content}
          data-testid="shell-content"
          data-width={isWide ? "wide" : undefined}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
