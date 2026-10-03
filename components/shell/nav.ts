import { satisfies, type Role } from "../../lib/auth/role-model.ts";
import type { IconName } from "./icons";

export type NavItem = { label: string; icon: IconName; href?: string; minRole?: Role };
export type NavSection = { heading: string; items: NavItem[] };

export const NAV: NavSection[] = [
  { heading: "พื้นที่ทำงาน", items: [
    { label: "ภาพรวม", icon: "home", href: "/" },
    { label: "แอดของเรา", icon: "grid", href: "/owned-ads/performance", minRole: "analyst" },
    { label: "Command Center", icon: "chart", href: "/command-center", minRole: "analyst" },
    { label: "ส่องคู่แข่ง", icon: "search", href: "/competitors" },
    { label: "เปรียบเทียบแอด", icon: "compare", href: "/compare/ads", minRole: "analyst" },
    { label: "รายการติดตาม", icon: "bookmark", href: "/watchlist" },
  ] },
  { heading: "เครื่องมือวิเคราะห์", items: [
    { label: "คลังแอดทั้งหมด", icon: "building", href: "/owned-ads", minRole: "analyst" },
    { label: "เพจ / แบรนด์", icon: "building", href: "/pages" },
    { label: "เปรียบเทียบเพจ", icon: "compare", href: "/compare" },
    { label: "แนวโน้ม", icon: "trend", href: "/trends" },
    { label: "แบรนด์", icon: "building", href: "/brands" },
  ] },
  { heading: "จัดการข้อมูล", items: [
    { label: "เก็บข้อมูลใหม่", icon: "search", href: "/collect", minRole: "analyst" },
    { label: "หมวดหมู่", icon: "folder", href: "/categories" },
    { label: "Dataset", icon: "layers", href: "/datasets" },
    { label: "Unmapped Pages", icon: "unlink", href: "/unmapped-pages" },
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
