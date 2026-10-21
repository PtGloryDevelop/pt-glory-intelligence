import { satisfies, type Role } from "../../lib/auth/role-model.ts";
import type { IconName } from "./icons";

/**
 * Which side of the product an entry belongs to, and so the colour of its tile:
 * ours is pink, rivals are blue, the comparison of the two is purple, the rest grey.
 */
export type NavTone = "neutral" | "ours" | "rival" | "compare";
export type NavItem = {
  label: string; icon: IconName; href: string; tone: NavTone; minRole?: Role;
  /** Other paths that belong to this entry, so it stays lit on its detail pages. */
  also?: string[];
  /** One of the phone's bottom tabs. */
  tab?: true;
  /** What the entry is for, said on the settings page. */
  hint?: string;
};
export type NavSection = { heading: string; items: NavItem[] };

// UI v3 (macOS): the four jobs everyone has, then the two routine updates, always in sight.
// Each label matches the title of the page it opens, and no two entries share an icon (the folded rail shows icons first).
export const NAV: NavSection[] = [
  { heading: "พื้นที่ทำงาน", items: [
    { label: "ภาพรวม", icon: "home", href: "/market-overview", tone: "neutral", tab: true },
    { label: "ส่องแอด", icon: "search", href: "/competitors?view=all", tone: "rival", tab: true },
    { label: "ติดตามคู่แข่ง", icon: "swords", href: "/competitors", tone: "rival", also: ["/pages"], tab: true },
    // The Command Center is this page's quick-rankings tab now; its old URL redirects here.
    { label: "ผลแอดเรา", icon: "chart", href: "/owned-ads/performance", tone: "ours", minRole: "analyst", also: ["/command-center"], tab: true },
    { label: "เทียบ", icon: "compare", href: "/compare/ads", tone: "compare", minRole: "analyst", tab: true },
  ] },
  { heading: "อัปเดตข้อมูล", items: [
    { label: "ค้นแอดคู่แข่งใหม่", icon: "collect", href: "/collect", tone: "rival", minRole: "analyst", hint: "เก็บแอดจาก Meta Ad Library ตามคำค้น" },
    { label: "อัปเดตแอดของเรา", icon: "download", href: "/owned-ads", tone: "ours", minRole: "analyst", hint: "ดึงรายงานแอดของบริษัทจาก Ads Management" },
  ] },
];

export const SETTINGS: NavItem = { label: "ตั้งค่า", icon: "settings", href: "/settings", tone: "neutral" };

// Admin upkeep lives on the settings page. Hidden pages (watchlist, page compare, trends, page list) still answer at their URLs.
export const ADMIN_TOOLS: NavItem[] = [
  { label: "แบรนด์คู่แข่ง", icon: "building", href: "/brands", tone: "neutral", minRole: "admin", hint: "จับคู่เพจเข้ากับแบรนด์ ให้ทีมตรวจก่อนนำไปใช้" },
  { label: "หมวดหมู่", icon: "folder", href: "/categories", tone: "neutral", minRole: "admin", hint: "จัดกลุ่มข้อมูลที่เก็บตามหมวดสินค้า" },
  { label: "ประวัติการเก็บข้อมูล", icon: "history", href: "/datasets", tone: "neutral", minRole: "admin", hint: "ทุกรอบที่เก็บ พร้อมจำนวนแอดที่ได้ในแต่ละรอบ" },
  { label: "การเชื่อมต่อและงบ", icon: "wallet", href: "/collector", tone: "neutral", minRole: "admin", hint: "สถานะการเชื่อมต่อตัวเก็บข้อมูล และงบที่ใช้เก็บ" },
  { label: "กู้คืนจากไฟล์", icon: "upload", href: "/import", tone: "neutral", minRole: "admin", hint: "นำเข้าไฟล์ JSON เมื่อการเก็บปกติใช้ไม่ได้" },
];

const permitted = (role: Role) => (item: NavItem) => !item.minRole || satisfies(role, item.minRole);

/** Only permitted, working destinations reach the browser. */
export function visibleNav(role: Role): NavSection[] {
  return NAV.map((section) => ({ ...section, items: section.items.filter(permitted(role)) }))
    .filter((section) => section.items.length > 0);
}

/** The admin tools a role may open; empty for everyone but an admin. */
export function visibleAdminTools(role: Role): NavItem[] {
  return ADMIN_TOOLS.filter(permitted(role));
}
