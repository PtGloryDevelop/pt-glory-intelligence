import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_TOOLS, NAV, SETTINGS, visibleAdminTools, visibleNav } from "../components/shell/nav.ts";
import { activeHref } from "../components/shell/active.ts";
import type { Role } from "../lib/auth/role-model.ts";

/**
 * C14 — who sees which menu, and who may import a file.
 *
 * The menu is a promise about what somebody can do. An entry that answers 403
 * is a worse lie than no entry at all, so these cases are mostly about absence:
 * what never reaches a viewer's HTML, and what an analyst no longer has.
 *
 * UI v3 (macOS): the sidebar carries the jobs and the two routine updates; the
 * admin upkeep tools moved to the settings page, filtered the same way.
 */

const labels = (role: Role) => visibleNav(role).flatMap((section) => section.items.map((item) => item.label));
const itemFor = (role: Role, label: string) =>
  [...visibleNav(role).flatMap((section) => section.items), ...visibleAdminTools(role)].find((item) => item.label === label);
const ROLES = ["viewer", "analyst", "admin"] as const;

test('overview is the shared entry at its own URL; owned daily performance remains analyst-only', () => {
  // `/` follows each person's home choice, so the menu points at the page that is always the overview.
  for (const role of ROLES) assert.equal(itemFor(role, 'ภาพรวม')?.href, '/market-overview');
  assert.equal(itemFor('viewer', 'ผลแอดเรา'), undefined);
  for (const role of ['analyst', 'admin'] as const) assert.equal(itemFor(role, 'ผลแอดเรา')?.href, '/owned-ads/performance');
});

test("manual import is an admin tool, and says what it is for", () => {
  const item = itemFor("admin", "กู้คืนจากไฟล์");
  assert.ok(item, "the admin keeps the recovery import");
  assert.equal(item.href, "/import", "and it still goes to the page that exists");
  assert.equal(item.minRole, "admin");
  // The old wording made it look like one of the ways to collect.
  assert.ok(!labels("admin").includes("นำเข้าข้อมูล"));
  assert.ok(!visibleAdminTools("admin").some((tool) => tool.label === "นำเข้าข้อมูล"));
});

test("an analyst sees the collection entry and nothing that would answer 403", () => {
  const visible = labels("analyst");
  assert.ok(visible.includes("ค้นแอดคู่แข่งใหม่"));
  assert.deepEqual(visibleAdminTools("analyst"), [], "no admin tool reaches an analyst");
  assert.ok(!visible.includes("กู้คืนจากไฟล์"), "manual import is not theirs any more");
  assert.ok(!visible.includes("การเชื่อมต่อและงบ"), "and neither are the collector's figures");
});

test("a viewer sees the shared work surfaces only", () => {
  const visible = labels("viewer");
  for (const label of ["ค้นแอดคู่แข่งใหม่", "การเชื่อมต่อและงบ", "กู้คืนจากไฟล์"]) {
    assert.ok(!visible.includes(label), `${label} must not reach a viewer`);
  }
  assert.deepEqual(visible, ["ภาพรวม", "ส่องแอด", "ติดตามคู่แข่ง"]);
  assert.deepEqual(visibleAdminTools("viewer"), []);
});

test("an admin sees everything the other two do, and every admin tool as well", () => {
  const admin = labels("admin");
  for (const label of labels("analyst")) assert.ok(admin.includes(label), label);
  assert.deepEqual(visibleAdminTools("admin").map((tool) => tool.label), ADMIN_TOOLS.map((tool) => tool.label));
});

test("the two collection entries lead to the pages C15 built", () => {
  for (const [role, label, href] of [
    ["analyst", "ค้นแอดคู่แข่งใหม่", "/collect"],
    ["admin", "การเชื่อมต่อและงบ", "/collector"],
  ] as const) {
    const item = itemFor(role, label);
    assert.ok(item, label);
    assert.equal(item.href, href, label);
  }
});

test("a section with nothing left in it does not appear at all", () => {
  // Otherwise an empty heading would tell a viewer which tools exist above it.
  for (const role of ROLES) {
    for (const section of visibleNav(role)) {
      assert.ok(section.items.length > 0, `${role}: ${section.heading}`);
    }
  }
  // Nothing is lost for an admin: every item in the model is still reachable.
  assert.equal(
    visibleNav("admin").flatMap((section) => section.items).length,
    NAV.flatMap((section) => section.items).length,
  );
});

test("the menu is decided on the server, not hidden in the browser", () => {
  const layout = readFileSync(join("app", "(app)", "layout.tsx"), "utf8");
  const shell = readFileSync(join("components", "shell", "AppShell.tsx"), "utf8");
  const settings = readFileSync(join("app", "(app)", "settings", "page.tsx"), "utf8");

  // The server computes the sections and passes them down.
  assert.match(layout, /visibleNav\(actor\.role\)/);
  // The client shell renders what it was given; it cannot see the whole model,
  // and it takes nothing but types from the module that holds it.
  assert.match(shell, /sections\.map\(/);
  assert.doesNotMatch(shell, /\bNAV\b|\bADMIN_TOOLS\b/);
  assert.doesNotMatch(shell, /minRole/);
  assert.doesNotMatch(shell, /^import (?!type )[^\n]*["']\.\/nav(\.ts)?["']/m);
  // The settings page is a server component that filters by the resolved role.
  assert.doesNotMatch(settings, /["']use client["']/);
  assert.match(settings, /visibleAdminTools\(actor\.role\)/);
  assert.match(settings, /visibleNav\(actor\.role\)/);
});

test("all three import surfaces require an admin, on the server", () => {
  const preview = readFileSync(join("app", "api", "imports", "preview", "route.ts"), "utf8");
  const commit = readFileSync(join("app", "api", "imports", "commit", "route.ts"), "utf8");
  const page = readFileSync(join("app", "(app)", "import", "page.tsx"), "utf8");

  assert.match(preview, /requireRole\("admin"\)/);
  assert.doesNotMatch(preview, /requireRole\("(viewer|analyst)"\)/);
  assert.match(commit, /requireRole\("admin"\)/);
  assert.doesNotMatch(commit, /requireRole\("(viewer|analyst)"\)/);
  // The page checks too: hiding a form is a convenience, never the control —
  // and it refuses with a real 403 rather than a 200 carrying a message.
  assert.match(page, /satisfies\(actor\.role, "admin"\)/);
  assert.match(page, /forbidden\(\);/);
  const boundary = readFileSync(join("app", "(app)", "forbidden.tsx"), "utf8");
  assert.match(boundary, /forbidden-notice/);
  assert.doesNotMatch(boundary, /apify|extension/i);

  // And the frozen import pipeline is untouched by any of it.
  assert.match(commit, /commitImport\(/);
  assert.match(commit, /enqueueRun\(/);
  assert.match(preview, /previewImport\(/);
});

test("no normal surface offers a choice of collector", () => {
  const nav = readFileSync(join("components", "shell", "nav.ts"), "utf8");
  const page = readFileSync(join("app", "(app)", "import", "page.tsx"), "utf8");
  // What a person reads, with the source comments stripped: a provider may be
  // named in an explanation to a developer, never on screen.
  const rendered = (source: string) => source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  for (const source of [rendered(nav), rendered(page)]) {
    assert.doesNotMatch(source, /apify/i);
    assert.doesNotMatch(source, /extension/i);
  }
  // Every label and hint in the whole menu, for every role.
  for (const role of ROLES) {
    for (const item of [...visibleNav(role).flatMap((section) => section.items), ...visibleAdminTools(role)]) {
      assert.doesNotMatch(`${item.label} ${item.hint ?? ""}`, /apify|actor|extension|provider/i, item.label);
    }
  }
  // The label a person reads says recovery, not collection.
  assert.match(nav, /กู้คืนจากไฟล์/);
});

test("routine updates stay in sight; admin upkeep is on the settings page, not in the sidebar", () => {
  const routine = visibleNav("analyst").find((section) => section.heading === "อัปเดตข้อมูล");
  assert.deepEqual(routine?.items.map((item) => item.label), ["ค้นแอดคู่แข่งใหม่", "อัปเดตแอดของเรา"]);
  const sidebar = labels("admin");
  for (const tool of ADMIN_TOOLS) assert.ok(!sidebar.includes(tool.label), `${tool.label} belongs on the settings page`);
  assert.deepEqual(ADMIN_TOOLS.map((tool) => tool.label), ["แบรนด์คู่แข่ง", "หมวดหมู่", "ประวัติการเก็บข้อมูล", "การเชื่อมต่อและงบ", "กู้คืนจากไฟล์"]);
  assert.ok(ADMIN_TOOLS.every((tool) => tool.minRole === "admin"), "only admin pages are admin tools");
  assert.ok(ADMIN_TOOLS.every((tool) => tool.hint), "each tool says what it is for");
  assert.equal(SETTINGS.href, "/settings");
  assert.equal(SETTINGS.minRole, undefined, "everyone has a settings page: it is where a phone signs out");
});

test("no two entries share an icon: the folded rail shows icons first", () => {
  const icons = [...NAV.flatMap((section) => section.items), ...ADMIN_TOOLS, SETTINGS].map((item) => item.icon);
  assert.equal(new Set(icons).size, icons.length);
});

test("an entry's tile colour says whose data it opens", () => {
  const tone = (label: string) => itemFor("admin", label)?.tone;
  for (const label of ["ผลแอดเรา", "อัปเดตแอดของเรา"]) assert.equal(tone(label), "ours", label);
  for (const label of ["ส่องแอด", "ติดตามคู่แข่ง", "ค้นแอดคู่แข่งใหม่"]) assert.equal(tone(label), "rival", label);
  assert.equal(tone("เทียบ"), "compare");
  assert.equal(tone("ภาพรวม"), "neutral");
  assert.ok(ADMIN_TOOLS.every((tool) => tool.tone === "neutral"));
});

test("each upkeep entry is named like the page it opens", () => {
  for (const [label, file] of [
    ["อัปเดตแอดของเรา", join("app", "(app)", "owned-ads", "company-library.tsx")],
    ["ประวัติการเก็บข้อมูล", join("app", "(app)", "datasets", "page.tsx")],
    ["การเชื่อมต่อและงบ", join("app", "(app)", "collector", "page.tsx")],
    ["กู้คืนจากไฟล์", join("app", "(app)", "import", "page.tsx")],
  ]) {
    assert.ok(itemFor("admin", label), label);
    assert.match(readFileSync(file, "utf8"), new RegExp(`title="${label}`), `${file} should open with ${label}`);
  }
});

test("a phone gets at most five tabs, and they are the jobs", () => {
  const tabs = (role: Role) => visibleNav(role).flatMap((section) => section.items).filter((item) => item.tab).map((item) => item.label);
  assert.deepEqual(tabs("viewer"), ["ภาพรวม", "ส่องแอด", "ติดตามคู่แข่ง"]);
  assert.deepEqual(tabs("analyst"), ["ภาพรวม", "ส่องแอด", "ติดตามคู่แข่ง", "ผลแอดเรา", "เทียบ"]);
  for (const role of ROLES) assert.ok(tabs(role).length <= 5, role);
});

test("the lit entry follows the URL, query included", () => {
  const items = [...visibleNav("admin").flatMap((section) => section.items), SETTINGS];
  const lit = (url: string) => {
    const parsed = new URL(url, "http://local");
    return items.find((item) => item.href === activeHref(items, parsed.pathname, parsed.searchParams))?.label;
  };
  assert.equal(lit("/"), "ภาพรวม");
  assert.equal(lit("/market-overview"), "ภาพรวม");
  assert.equal(lit("/competitors"), "ติดตามคู่แข่ง");
  assert.equal(lit("/pages/123"), "ติดตามคู่แข่ง");
  assert.equal(lit("/competitors?view=all"), "ส่องแอด");
  assert.equal(lit("/competitors?view=all&period=week"), "ส่องแอด");
  assert.equal(lit("/competitors?search=kivari"), "ส่องแอด");
  assert.equal(lit("/owned-ads/performance"), "ผลแอดเรา");
  assert.equal(lit("/owned-ads"), "อัปเดตแอดของเรา");
  assert.equal(lit("/compare/ads?ours=1"), "เทียบ");
  assert.equal(lit("/settings"), "ตั้งค่า");
  assert.equal(lit("/brands"), undefined, "an admin tool lights nothing in the sidebar");
});

test("the Command Center is the owned-ads page's quick-rankings tab, and its old URL still lands there", () => {
  assert.ok(!labels('admin').includes('Command Center'), 'no separate entry any more');
  const page = readFileSync(join('app', '(app)', 'command-center', 'page.tsx'), 'utf8');
  assert.match(page, /forbidden\(\)/, 'a viewer is still refused before any redirect');
  assert.match(page, /next\.set\("tab", "rank"\)/);
  assert.match(page, /redirect\(`\/owned-ads\/performance\?\$\{next\}`\)/);
  const owned = readFileSync(join('app', '(app)', 'owned-performance.tsx'), 'utf8');
  assert.match(owned, /<QuickRankings /);
  // The old URL lights the entry it now belongs to.
  const items = visibleNav('analyst').flatMap(section => section.items);
  assert.equal(activeHref(items, '/command-center', new URLSearchParams()), '/owned-ads/performance');
});
