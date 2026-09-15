import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV, visibleNav } from "../components/shell/nav.ts";
import type { Role } from "../lib/auth/role-model.ts";

/**
 * C14 — who sees which menu, and who may import a file.
 *
 * The menu is a promise about what somebody can do. An entry that answers 403
 * is a worse lie than no entry at all, so these cases are mostly about absence:
 * what never reaches a viewer's HTML, and what an analyst no longer has.
 */

const labels = (role: Role) => visibleNav(role).flatMap((section) => section.items.map((item) => item.label));
const itemFor = (role: Role, label: string) =>
  visibleNav(role).flatMap((section) => section.items).find((item) => item.label === label);

test("manual import is an admin entry, and says what it is for", () => {
  const item = itemFor("admin", "นำเข้าไฟล์ (กู้คืนระบบ)");
  assert.ok(item, "the admin keeps the recovery import");
  assert.equal(item.href, "/import", "and it still goes to the page that exists");
  assert.equal(item.minRole, "admin");
  // The old wording made it look like one of the ways to collect.
  assert.ok(!labels("admin").includes("นำเข้าข้อมูล"));
});

test("an analyst sees the collection entry and nothing that would answer 403", () => {
  const visible = labels("analyst");
  assert.ok(visible.includes("เก็บข้อมูลใหม่"));
  assert.ok(!visible.includes("นำเข้าไฟล์ (กู้คืนระบบ)"), "manual import is not theirs any more");
  assert.ok(!visible.includes("ค่าเก็บข้อมูล"), "and neither are the collector's figures");
});

test("a viewer sees none of the three", () => {
  const visible = labels("viewer");
  for (const label of ["เก็บข้อมูลใหม่", "ค่าเก็บข้อมูล", "นำเข้าไฟล์ (กู้คืนระบบ)"]) {
    assert.ok(!visible.includes(label), `${label} must not reach a viewer`);
  }
  // What a viewer does have is the research they came for.
  assert.ok(visible.includes("Dataset"));
  assert.ok(visible.includes("หมวดหมู่"));
});

test("an admin sees everything the other two do, and the admin entries as well", () => {
  const admin = labels("admin");
  for (const label of labels("analyst")) assert.ok(admin.includes(label), label);
  assert.ok(admin.includes("ค่าเก็บข้อมูล"));
  assert.ok(admin.includes("นำเข้าไฟล์ (กู้คืนระบบ)"));
});

test("the two C15 entries are listed without a destination", () => {
  // C14 adds the menu; C15 adds the pages. An href now would be a link to a
  // page that does not exist, which is worse than a disabled entry.
  for (const [role, label] of [["analyst", "เก็บข้อมูลใหม่"], ["admin", "ค่าเก็บข้อมูล"]] as const) {
    const item = itemFor(role, label);
    assert.ok(item, label);
    assert.equal(item.href, undefined, `${label} must not link anywhere yet`);
  }
});

test("a section with nothing left in it does not appear at all", () => {
  // Otherwise an empty heading would tell a viewer which tools exist above it.
  for (const role of ["viewer", "analyst", "admin"] as const) {
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

  // The server computes the sections and passes them down.
  assert.match(layout, /visibleNav\(actor\.role\)/);
  // The client shell renders what it was given; it cannot see the whole model.
  assert.match(shell, /sections\.map\(/);
  assert.doesNotMatch(shell, /\bNAV\b/);
  assert.doesNotMatch(shell, /minRole/);
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
  // Every label in the whole menu, for every role.
  for (const role of ["viewer", "analyst", "admin"] as const) {
    for (const label of labels(role)) {
      assert.doesNotMatch(label, /apify|actor|extension|provider/i, label);
    }
  }
  // The label a person reads says recovery, not collection.
  assert.match(nav, /นำเข้าไฟล์ \(กู้คืนระบบ\)/);
});
