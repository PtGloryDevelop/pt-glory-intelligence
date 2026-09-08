import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The type scale is closed.
 *
 * Nine roles are defined in globals.css. Before V5 there were also 9, 13.5, 15,
 * 17, 19, 21 and 22px sitting as literals across six modules, every one of them
 * a private decision about a job the scale already had a name for. Adding the
 * tenth size is easy and invisible; this is what makes it visible.
 */

const ROLES = [
  "--fs-page-title", "--fs-title", "--fs-subhead", "--fs-section",
  "--fs-title-sm", "--fs-body", "--fs-meta", "--fs-label", "--fs-eyebrow",
];

/**
 * Sizes that are geometry rather than typography: glyphs fitted to a fixed box,
 * where the box size is the design decision and the text merely fills it.
 */
const GEOMETRY = ["components/BrandMark.module.css"];

function modules(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".module.css")) found.push(path);
    }
  };
  walk("app");
  walk("components");
  return found;
}

test("globals.css defines every role in the scale", () => {
  const css = readFileSync("app/globals.css", "utf8");
  for (const role of ROLES) {
    assert.match(css, new RegExp(`${role}:\\s*[0-9.]+px`), `${role} is missing from the scale`);
  }
});

test("no module invents a font size of its own", () => {
  const offenders: string[] = [];
  for (const path of modules()) {
    if (GEOMETRY.some((allowed) => path.split(/[\\/]/).join("/").endsWith(allowed))) continue;
    for (const [line] of readFileSync(path, "utf8").matchAll(/^.*font-size:[^;]*;.*$/gm)) {
      // 0 is "hide this text but keep it for assistive technology", used by the
      // rail's section dividers. It is not a size.
      if (/font-size:\s*(var\(--fs-|0\b|inherit)/.test(line)) continue;
      offenders.push(`${path}: ${line.trim()}`);
    }
  }
  assert.deepEqual(offenders, [], `font sizes outside the scale:\n${offenders.join("\n")}`);
});
