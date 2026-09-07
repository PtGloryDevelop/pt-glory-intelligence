/**
 * One icon system for the sidebar.
 *
 * Hand-drawn on a 24px grid with a single stroke weight and round caps, so the
 * set reads as one family rather than a pile of borrowed glyphs. They inherit
 * `currentColor`, which is what lets the nav tint them muted by default and
 * orange when active without a second colour rule.
 *
 * No icon library: fourteen 20-line SVGs cost less than a dependency, and this
 * way the weight and corner radius match the rest of the shell exactly.
 */

const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export type IconName =
  | "home" | "search" | "folder" | "layers" | "grid" | "building" | "image"
  | "chart" | "swords" | "sparkle" | "target" | "tag" | "trend" | "compare"
  | "bookmark" | "upload" | "history" | "shield" | "brain" | "unlink" | "settings";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <><path d="M4 10.5 12 4l8 6.5" /><path d="M6 10v9h12v-9" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
  folder: <path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />,
  layers: <><path d="m12 4 8 4-8 4-8-4z" /><path d="m4 13 8 4 8-4" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  building: <><path d="M5 20V6a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v14" /><path d="M14 10h4a1 1 0 0 1 1 1v9" /><path d="M8 9h3M8 13h3M8 17h3" /></>,
  image: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 4.5-4.5 3.5 3.5 2.5-2.5L19 17" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 20v-6M12 20V6M17 20v-9" /></>,
  swords: <><path d="m5 5 6 6M5 11l6-6" /><path d="m19 5-8 8" /><path d="m14 16 2 2 3-3-2-2" /></>,
  sparkle: <><path d="m12 4 1.8 4.7L18.5 10l-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.3z" /><path d="m18 17 .8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>,
  target: <><circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3.5" /></>,
  tag: <><path d="M11 4H5a1 1 0 0 0-1 1v6l8.5 8.5a1 1 0 0 0 1.4 0l5.6-5.6a1 1 0 0 0 0-1.4z" /><circle cx="8.5" cy="8.5" r="1.2" /></>,
  trend: <><path d="m4 16 5-5 3.5 3.5L20 7" /><path d="M15 7h5v5" /></>,
  compare: <><path d="M12 4v16" /><path d="M5 8h4M5 12h4M5 16h4" /><path d="M15 8h4M15 12h4M15 16h4" /></>,
  bookmark: <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" />,
  upload: <><path d="M12 16V5" /><path d="m8 9 4-4 4 4" /><path d="M5 15v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" /></>,
  history: <><path d="M4 12a8 8 0 1 0 2.5-5.8" /><path d="M4 4v4h4" /><path d="M12 8v4.5l3 2" /></>,
  shield: <><path d="M12 4 5 7v5c0 4 3 6.6 7 8 4-1.4 7-4 7-8V7z" /><path d="m9.5 12 1.8 1.8 3.4-3.6" /></>,
  brain: <><path d="M9.5 5A2.5 2.5 0 0 0 7 7.5 2.5 2.5 0 0 0 5.5 12 2.5 2.5 0 0 0 7 16.5 2.5 2.5 0 0 0 9.5 19H12V5z" /><path d="M14.5 5A2.5 2.5 0 0 1 17 7.5 2.5 2.5 0 0 1 18.5 12 2.5 2.5 0 0 1 17 16.5 2.5 2.5 0 0 1 14.5 19H12" /></>,
  unlink: <><path d="M9 15 5.5 18.5" /><path d="M15 9 18.5 5.5" /><path d="M10 7.5 12 5.5a3.5 3.5 0 0 1 5 5l-2 2" /><path d="M14 16.5 12 18.5a3.5 3.5 0 0 1-5-5l2-2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M4.9 7.8l1.7 1M17.4 15.2l1.7 1M4.9 16.2l1.7-1M17.4 8.8l1.7-1" /></>,
};

export function Icon({ name }: { name: IconName }) {
  return <svg {...base}>{PATHS[name]}</svg>;
}
