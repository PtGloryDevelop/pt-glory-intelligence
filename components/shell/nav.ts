import { satisfies, type Role } from "../../lib/auth/role-model.ts";
import type { IconName } from "./icons";

export type NavItem = { label: string; icon: IconName; href?: string; minRole?: Role };
/** `folded`: shown closed until opened (or until one of its pages is the current one). */
export type NavSection = { heading: string; items: NavItem[]; folded?: true };

// UI v2: four jobs for everyone; the two routine updates always in sight; admin upkeep folded away.
// Each label matches the title of the page it opens, and no two entries share an icon (the rail shows only icons).
export const NAV: NavSection[] = [
  { heading: "พื้นที่ทำงาน", items: [
    { label: "ภาพรวม", icon: "home", href: "/market-overview" },
    { label: "แอดของเรา", icon: "grid", href: "/owned-ads/performance", minRole: "analyst" },
    { label: "Command Center", icon: "target", href: "/command-center", minRole: "analyst" },
    { label: "คู่แข่ง", icon: "swords", href: "/competitors" },
    { label: "เทียบกับคู่แข่ง", icon: "compare", href: "/compare/ads", minRole: "analyst" },
  ] },
  { heading: "อัปเดตข้อมูล", items: [
    { label: "ค้นแอดคู่แข่งใหม่", icon: "search", href: "/collect", minRole: "analyst" },
    { label: "อัปเดตแอดของเรา", icon: "download", href: "/owned-ads", minRole: "analyst" },
  ] },
  // Hidden pages (watchlist, page compare, trends, page list) still answer at their URLs.
  { heading: "จัดการระบบ", folded: true, items: [
    { label: "แบรนด์คู่แข่ง", icon: "building", href: "/brands", minRole: "admin" },
    { label: "หมวดหมู่", icon: "folder", href: "/categories", minRole: "admin" },
    { label: "ประวัติการเก็บข้อมูล", icon: "history", href: "/datasets", minRole: "admin" },
    { label: "การเชื่อมต่อและงบ", icon: "settings", href: "/collector", minRole: "admin" },
    { label: "กู้คืนจากไฟล์", icon: "upload", href: "/import", minRole: "admin" },
  ] },
];

/** Only permitted, working destinations reach the browser. */
export function visibleNav(role: Role): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.minRole || satisfies(role, item.minRole)),
  })).filter((section) => section.items.length > 0);
}
