import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The status split shown on a list row.
 *
 * Rendering is checked by reading the component's own rule rather than by
 * mounting React: the rule is what matters, and it is one line. A state appears
 * when it has ads in it, so anything absent is a zero — which is only honest
 * because the total sits in the column beside it.
 */

const source = readFileSync(join("components", "StatusBreakdown.tsx"), "utf8");

test("a state is shown when it holds ads, and hidden only when it is zero", () => {
  assert.match(source, /filter\(\(state\) => state\.count > 0\)/);
});

test("unknown is never folded into inactive", () => {
  // Three separate entries, three separate meanings. A collector that could not
  // read a state has not told us the ad stopped.
  const keys = [...source.matchAll(/key: "(active|inactive|unknown)"/g)].map((m) => m[1]);
  assert.deepEqual(keys, ["active", "inactive", "unknown"]);
});

test("a page with no ads says so instead of rendering an empty cell", () => {
  assert.match(source, /ไม่มีโฆษณา/);
});

test("the full three-way split stays where the caveat is", () => {
  // The Page and Category screens show every state, including the zeros,
  // because that is where the sentence explaining the collection's filter sits.
  for (const file of [
    join("app", "(app)", "pages", "[pageId]", "page.tsx"),
    join("app", "(app)", "categories", "[id]", "page.tsx"),
  ]) {
    const screen = readFileSync(file, "utf8");
    assert.match(screen, /StatusBadge isActive=\{true\}/, file);
    assert.match(screen, /StatusBadge isActive=\{false\}/, file);
    assert.match(screen, /StatusBadge isActive=\{null\}/, file);
    assert.match(screen, /statusFilterNote/, file);
  }
});
