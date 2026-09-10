import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A table on a phone.
 *
 * Two faults found by looking at real 375px screenshots rather than at the
 * "no horizontal overflow" assertion, which both of them passed:
 *
 *   1. `table { width: 100% }` squeezed every table into the viewport instead
 *      of letting its scroll wrapper scroll. Columns collapsed to about forty
 *      pixels and content shattered — "meta-ads-th-2026-09-10" came out as five
 *      stacked fragments.
 *   2. On the mapping queue, the button that does the work sat in the seventh
 *      column, off-screen, with nothing to suggest it was there. The team's main
 *      task was unreachable on a phone.
 */

test("a wrapped table may be wider than its wrapper", () => {
  const surface = readFileSync(join("components", "Surface.module.css"), "utf8");
  // max-content lets it size to its contents; min-width keeps it filling the
  // panel on a desktop, where the contents are narrower than the space.
  assert.match(surface, /\.tableWrap table \{[^}]*width: max-content/);
  assert.match(surface, /\.tableWrap table \{[^}]*min-width: 100%/);
});

test("the mapping queue keeps the decision on screen", () => {
  const page = readFileSync(join("app", "(app)", "unmapped-pages", "page.tsx"), "utf8");
  const css = readFileSync(join("app", "(app)", "unmapped-pages", "unmapped.module.css"), "utf8");

  // Name, size and action stay; the rest fold away below 640px.
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.secondary \{ display: none/);
  const secondaries = [...page.matchAll(/styles\.secondary/g)];
  assert.equal(secondaries.length, 8, "four columns, header and body cell each");

  // The name stays capped on a phone too — without the cap the longest name
  // took the whole width and pushed the button back off-screen.
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.pageCell \{ max-width: 17ch/);
});

test("hidden columns are announced, not silently dropped", () => {
  const page = readFileSync(join("app", "(app)", "unmapped-pages", "page.tsx"), "utf8");
  assert.match(page, /unmapped-mobile-note/);
  assert.match(page, /บนจอเล็กแสดงเฉพาะคอลัมน์ที่ใช้ตัดสินใจ/);
  // And it says where the rest of it lives.
  assert.match(page, /ดูได้ในหน้าเพจ/);
});
