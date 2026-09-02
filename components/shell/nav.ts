/**
 * Sidebar information architecture — handoff §5.
 *
 * `href` present means the route exists in Phase 1. Everything else is listed so
 * the shell reads as the finished product, but renders disabled: a future page
 * with no data behind it must never look available, and must never be populated
 * with facts the engine cannot support.
 */
export type NavItem = { label: string; href?: string };
export type NavSection = { heading: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    heading: "MAIN",
    items: [
      { label: "หน้าหลัก", href: "/" },
      { label: "Deep Search" },
    ],
  },
  {
    heading: "DATA",
    items: [
      { label: "หมวดหมู่" },
      { label: "Dataset", href: "/datasets" },
      { label: "Ads Explorer" },
      { label: "เพจ / แบรนด์" },
      { label: "Creatives" },
    ],
  },
  {
    heading: "INTELLIGENCE",
    items: [
      { label: "ภาพรวมตลาด" },
      { label: "คู่แข่ง" },
      { label: "Creative Intelligence" },
      { label: "Pain Point / Hook / Offer" },
      { label: "ราคา & Promotion" },
      { label: "แนวโน้ม" },
      { label: "Compare" },
      { label: "Watchlist" },
    ],
  },
  {
    heading: "SYSTEM",
    items: [
      { label: "นำเข้าข้อมูล", href: "/import" },
      { label: "Collection Runs" },
      { label: "Data Quality" },
      { label: "AI Analysis History" },
      { label: "Unmapped Pages" },
      { label: "Settings" },
    ],
  },
];
