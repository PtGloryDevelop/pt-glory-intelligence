"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem, NavSection } from "./nav.ts";
import type { Freshness } from "../../lib/shell/freshness.ts";
import { activeHref } from "./active.ts";
import { Icon } from "./icons.tsx";
import { Tile } from "./Tile.tsx";
import styles from "./AppShell.module.css";

/** Open to every role, so it needs no permission and lives here rather than in the menu model. */
const SETTINGS = { label: "ตั้งค่า", href: "/settings" } as const;

/**
 * Sidebar + main column for every authenticated page (UI v3, macOS).
 *
 * Wide screens get the labelled sidebar; between 901 and 1279px it folds to a
 * rail of tiles on its own, and the toggle overrides either way. Phones get a
 * slim top bar and a tab bar instead.
 *
 * Client-side only for the toggle and the active-route highlight. It receives the
 * actor's role AND the menu that role may see as props rather than reading either
 * — authorization stays on the server, and the shell only displays what the
 * server decided. Filtering here instead would ship every admin label to every
 * browser and call CSS a permission.
 */
export function AppShell(
  { role, sections, freshness, children }:
  { role: string; sections: NavSection[]; freshness?: Freshness; children: React.ReactNode },
) {
  const pathname = usePathname();
  const search = useSearchParams();
  // The layout renders once; re-read the status lines on every navigation so a collection shows up without a reload.
  const [liveFreshness, setLiveFreshness] = useState<Freshness | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch("/api/shell/freshness").then(response => response.ok ? response.json() : null)
      .then((data: Freshness | null) => { if (live && data) setLiveFreshness(data); }).catch(() => {});
    return () => { live = false; };
  }, [pathname]);
  const chips = liveFreshness ?? freshness;
  const fresh = [chips?.owned, chips?.rivals].filter(chip => chip != null);
  const stale = fresh.some(chip => chip.stale);

  // "auto" lets the width decide; a click pins the opposite of what is on screen.
  const [state, setState] = useState<"auto" | "expanded" | "rail">("auto");
  const toggle = () => setState(current => {
    const shown = current === "auto" ? (window.matchMedia("(min-width: 1280px)").matches ? "expanded" : "rail") : current;
    return shown === "expanded" ? "rail" : "expanded";
  });

  const items = sections.flatMap(section => section.items);
  const active = activeHref([...items, SETTINGS], pathname, search);
  const tabs = items.filter(item => item.tab);

  // A dataset page carries the research grid, which genuinely wants the canvas.
  // Every other page reads better at a fixed measure.
  const path = pathname === "/" ? "/market-overview" : pathname;
  const isWide = path === "/market-overview" || /^\/datasets\/[^/]+/.test(path)
    || path === "/competitors" || path === "/owned-ads" || path === "/owned-ads/performance" || path === "/compare/ads" || path === "/command-center";

  const link = (item: Pick<NavItem, "label" | "href" | "icon" | "tone">) => (
    <Link
      key={item.href}
      href={item.href}
      className={[styles.item, active === item.href ? styles.active : ""].join(" ")}
      aria-current={active === item.href ? "page" : undefined}
      data-testid={`nav-${item.href}`}
    >
      <Tile icon={item.icon} tone={item.tone} />
      <span className={styles.label}>{item.label}</span>
    </Link>
  );

  return (
    <div className={styles.shell}>
      <a href="#workspace-content" className={styles.skipLink}>ข้ามไปเนื้อหา</a>
      <aside className={styles.sidebar} data-testid="app-sidebar" data-state={state}>
        <div className={styles.brand}>
          <Link href="/" className={styles.wordmark} aria-label="PT Glory หน้าแรก">
            <Image className={styles.logo} src="/logo/pt-mark.png" alt="" width={30} height={30} priority />
            <span className={styles.lockup}>PT Glory<small>Ad Intelligence</small></span>
          </Link>
          <button type="button" className={styles.toggle} onClick={toggle} aria-label="ย่อหรือขยายแถบด้านข้าง" title="ย่อหรือขยายแถบด้านข้าง">
            <Icon name="sidebar" />
          </button>
        </div>

        <nav className={styles.nav} aria-label="เมนูหลัก">
          {sections.map(section => (
            <div key={section.heading} className={styles.section}>
              <div className={styles.heading}>{section.heading}</div>
              {section.items.map(link)}
            </div>
          ))}
        </nav>

        <div className={styles.footer}>
          {/* How fresh both sides are, as one box that turns amber when either is late and opens the details. */}
          {fresh.length ? <Link href={SETTINGS.href} className={styles.status} data-stale={stale || undefined} data-testid="shell-freshness">
            <span className={styles.statusHead}>{stale ? <><Icon name="alert" size={13} />ข้อมูลไม่อัปเดต</> : "สถานะข้อมูล"}</span>
            {fresh.map(chip => (
              <span key={chip.label} className={styles.fresh} title={chip.stale ? "ข้อมูลเก่ากว่าที่ควร" : undefined}>
                <span className={chip.stale ? styles.dotWarn : styles.dot} aria-hidden />{chip.label}
              </span>
            ))}
          </Link> : null}
          <Link
            href={SETTINGS.href}
            className={[styles.item, active === SETTINGS.href ? styles.active : ""].join(" ")}
            aria-current={active === SETTINGS.href ? "page" : undefined}
            data-testid={`nav-${SETTINGS.href}`}
          >
            <Tile icon="settings" tone="neutral" />
            <span className={styles.label}>{SETTINGS.label}</span>
            <span className={styles.role} data-testid="shell-role">สิทธิ์ {role}</span>
          </Link>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar} data-testid="shell-topbar">
          <Link href="/" className={styles.wordmark} aria-label="PT Glory หน้าแรก">
            <Image className={styles.logo} src="/logo/pt-mark.png" alt="" width={28} height={28} />
            <span className={styles.lockup}>PT Glory</span>
          </Link>
          <Link href={SETTINGS.href} className={styles.settingsButton} aria-label={SETTINGS.label} aria-current={active === SETTINGS.href ? "page" : undefined}>
            <Icon name="settings" size={20} />
          </Link>
        </header>
        <main
          id="workspace-content"
          tabIndex={-1}
          className={styles.content}
          data-testid="shell-content"
          data-width={isWide ? "wide" : undefined}
        >
          {children}
        </main>
        <nav className={styles.tabbar} aria-label="แถบเมนู">
          {tabs.map(item => (
            <Link key={item.href} href={item.href} className={styles.tab} aria-current={active === item.href ? "page" : undefined}>
              <Icon name={item.icon} size={24} />
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
