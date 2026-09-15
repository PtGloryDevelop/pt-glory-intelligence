import { satisfies, type Role } from "../../lib/auth/role-model.ts";
import type { IconName } from "./icons";

/**
 * Sidebar information architecture — handoff §5.
 *
 * `href` present means the route exists in Phase 1. Everything else is listed so
 * the shell reads as the finished product, but renders disabled: a future page
 * with no data behind it must never look available, and must never be populated
 * with facts the engine cannot support.
 *
 * `minRole` is the other half of that honesty. An entry a person may not use is
 * not hidden with CSS — it never reaches their HTML at all, because the server
 * filters this list before rendering. A menu is a promise about what somebody
 * can do; showing one that answers 403 is a worse lie than showing nothing.
 */
export type NavItem = { label: string; icon: IconName; href?: string; minRole?: Role };
export type NavSection = { heading: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    heading: "MAIN",
    items: [
      { label: "หน้าหลัก", icon: "home", href: "/" },
      { label: "Deep Search", icon: "search" },
    ],
  },
  {
    heading: "DATA",
    items: [
      // The internal research grouping (P2.3). Not Meta's page categories.
      { label: "หมวดหมู่", icon: "folder", href: "/categories" },
      { label: "Dataset", icon: "layers", href: "/datasets" },
      { label: "Ads Explorer", icon: "grid" },
      // Page Intelligence (P2.1). The label keeps the product's planned wording,
      // but what exists behind it is pages: a Page is not a Brand, and nothing
      // in here maps one to the other.
      { label: "เพจ / แบรนด์", icon: "building", href: "/pages" },
      // Brand mapping (P2.8). The grouping itself, kept apart from the Page
      // surfaces above: a Brand here is a decision somebody made and signed,
      // never an identity the data implied.
      { label: "แบรนด์", icon: "building", href: "/brands" },
      { label: "Creatives", icon: "image" },
    ],
  },
  {
    heading: "INTELLIGENCE",
    items: [
      { label: "ภาพรวมตลาด", icon: "chart" },
      { label: "คู่แข่ง", icon: "swords" },
      { label: "Creative Intelligence", icon: "sparkle" },
      { label: "Pain Point / Hook / Offer", icon: "target" },
      { label: "ราคา & Promotion", icon: "tag" },
      // Trends (P2.5): the difference between two observed periods. Not a
      // forecast, and not a claim about the market.
      { label: "แนวโน้ม", icon: "trend", href: "/trends" },
      // Page vs Page (P2.4). Pages, never brands: no grouping, no fuzzy identity.
      { label: "Compare", icon: "compare", href: "/compare" },
      // Watchlist V1 (P2.7): saved targets and a manual baseline. Nothing
      // evaluates these on a schedule — there are no alerts to miss.
      { label: "Watchlist", icon: "bookmark", href: "/watchlist" },
    ],
  },
  {
    heading: "SYSTEM",
    items: [
      // The collection a person actually asks for (C15). Listed from C14 so the
      // shell is honest about what is coming, disabled until its page exists.
      { label: "เก็บข้อมูลใหม่", icon: "download", minRole: "analyst" },
      // The collector's own operating figures (C15): budget window, held
      // reservations, what still needs a person. Admin work, never a user's.
      { label: "ค่าเก็บข้อมูล", icon: "wallet", minRole: "admin" },
      // Manual file import is recovery infrastructure now, not a way to collect:
      // the label says so, and only an admin sees it. The capture-tool export is
      // what it takes, and that still works exactly as before.
      { label: "นำเข้าไฟล์ (กู้คืนระบบ)", icon: "upload", href: "/import", minRole: "admin" },
      { label: "Collection Runs", icon: "history" },
      { label: "Data Quality", icon: "shield" },
      { label: "AI Analysis History", icon: "brain" },
      // The review queue behind Brand mapping (P2.8).
      { label: "Unmapped Pages", icon: "unlink", href: "/unmapped-pages" },
      { label: "Settings", icon: "settings" },
    ],
  },
];

/**
 * The menu one role may see, decided on the server.
 *
 * Sections with nothing left in them disappear rather than leaving an empty
 * heading: a viewer should not be able to tell which admin tools exist from the
 * gaps in their own sidebar.
 */
export function visibleNav(role: Role): NavSection[] {
  return NAV
    .map((section) => ({
      heading: section.heading,
      items: section.items.filter((item) => !item.minRole || satisfies(role, item.minRole)),
    }))
    .filter((section) => section.items.length > 0);
}
