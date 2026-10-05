import { satisfies, type Role } from "../../lib/auth/role-model.ts";
import type { IconName } from "./icons";

export type NavItem = { label: string; icon: IconName; href?: string; minRole?: Role };
export type NavSection = { heading: string; items: NavItem[] };

// UI v2: four jobs up front; everything else stays one click away, folded.
export const NAV: NavSection[] = [
  { heading: "พื้นที่ทำงาน", items: [
    { label: "ภาพรวม", icon: "home", href: "/" },
    { label: "แอดของเรา", icon: "grid", href: "/owned-ads/performance", minRole: "analyst" },
    { label: "คู่แข่ง", icon: "search", href: "/competitors" },
    { label: "เทียบและวางแผน", icon: "compare", href: "/compare/ads", minRole: "analyst" },
  ] },
  { heading: "เครื่องมือเพิ่มเติม", items: [
    { label: "รายการติดตาม", icon: "bookmark", href: "/watchlist" },
    { label: "คลังแอดเราทั้งหมด", icon: "building", href: "/owned-ads", minRole: "analyst" },
    { label: "เพจคู่แข่ง", icon: "building", href: "/pages" },
    { label: "เปรียบเทียบเพจ", icon: "compare", href: "/compare" },
    { label: "แนวโน้ม", icon: "trend", href: "/trends" },
  ] },
  { heading: "ตั้งค่าข้อมูล", items: [
    { label: "เก็บข้อมูลใหม่", icon: "search", href: "/collect", minRole: "analyst" },
    { label: "หมวดหมู่", icon: "folder", href: "/categories" },
    { label: "รอบเก็บข้อมูล", icon: "layers", href: "/datasets" },
    { label: "แบรนด์คู่แข่ง", icon: "building", href: "/brands" },
    { label: "เพจที่ยังไม่จับคู่แบรนด์", icon: "unlink", href: "/unmapped-pages" },
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
