import { satisfies, type Role } from "../../lib/auth/role-model.ts";
import type { IconName } from "./icons";

export type NavItem = { label: string; icon: IconName; href?: string; minRole?: Role };
export type NavSection = { heading: string; items: NavItem[] };

// UI v2: four jobs for everyone; data upkeep for analysts/admins only.
export const NAV: NavSection[] = [
  { heading: "พื้นที่ทำงาน", items: [
    { label: "ภาพรวม", icon: "home", href: "/market-overview" },
    { label: "แอดของเรา", icon: "grid", href: "/owned-ads/performance", minRole: "analyst" },
    { label: "Command Center", icon: "target", href: "/command-center", minRole: "analyst" },
    { label: "คู่แข่ง", icon: "search", href: "/competitors" },
    { label: "เทียบกับคู่แข่ง", icon: "compare", href: "/compare/ads", minRole: "analyst" },
  ] },
  // Data upkeep. Hidden pages (watchlist, page compare, trends, page list) still answer at their URLs.
  { heading: "ตั้งค่าข้อมูล", items: [
    { label: "นำเข้าแอดเรา", icon: "upload", href: "/owned-ads", minRole: "analyst" },
    { label: "เก็บข้อมูลใหม่", icon: "search", href: "/collect", minRole: "analyst" },
    { label: "แบรนด์คู่แข่ง", icon: "building", href: "/brands", minRole: "admin" },
    { label: "หมวดหมู่", icon: "folder", href: "/categories", minRole: "admin" },
    { label: "รอบเก็บข้อมูล", icon: "layers", href: "/datasets", minRole: "admin" },
    { label: "ค่าเก็บข้อมูล", icon: "wallet", href: "/collector", minRole: "admin" },
    { label: "นำเข้าไฟล์ (กู้คืนระบบ)", icon: "upload", href: "/import", minRole: "admin" },
  ] },
];

/** Only permitted, working destinations reach the browser. */
export function visibleNav(role: Role): NavSection[] {
  return NAV.map((section) => ({
    heading: section.heading,
    items: section.items.filter((item) => !item.minRole || satisfies(role, item.minRole)),
  })).filter((section) => section.items.length > 0);
}
