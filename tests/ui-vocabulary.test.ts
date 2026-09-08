import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * What the interface is allowed to say.
 *
 * The collector contract already refuses forbidden metrics as data, and the
 * filter allowlist refuses them as query keys. This is the third place they
 * could still appear: as words on a screen. A label reading "Engagement" over a
 * column of ad counts is the same false claim whether or not a column called
 * engagement exists — the reader believes the label, not the schema.
 *
 * Comments are excluded on purpose. A comment saying why a metric is banned is
 * how the rule survives; only rendered text is the subject here.
 */

const SURFACES = ["app", "components"];

/** Every source file under the UI directories, comments stripped. */
function renderedSource(): { file: string; text: string }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".tsx") || path.endsWith(".ts")) files.push(path);
    }
  };
  for (const dir of SURFACES) walk(dir);

  return files.map((file) => ({
    file,
    text: readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|\s)\/\/.*$/gm, " "),
  }));
}

const FORBIDDEN = [
  // English, as they would appear in a label or a heading.
  /\bspend\b/i, /\breach\b/i, /\bimpressions?\b/i, /\bengagement\b/i,
  /\breactions?\b/i, /\bshares\b/i, /\bCTR\b/, /\bCPC\b/, /\bCPA\b/, /\bROAS\b/i,
  /\bconversions?\b/i, /\bwinning ads?\b/i, /\bmarket share\b/i,
  // Thai, which is what these screens are actually written in.
  /ยอดขาย/, /การมีส่วนร่วม/, /การเข้าถึง/, /จำนวนการแสดงผล/,
  /ส่วนแบ่งตลาด/, /โฆษณาที่ชนะ/, /งบโฆษณา/,
];

test("no forbidden performance metric is named anywhere in the interface", () => {
  for (const { file, text } of renderedSource()) {
    for (const pattern of FORBIDDEN) {
      assert.ok(
        !pattern.test(text),
        `${file} names ${pattern} — the source carries no such field, so the UI must not claim one`,
      );
    }
  }
});

test("a Page is never presented as a Brand", () => {
  for (const { file, text } of renderedSource()) {
    // The sidebar lists a future "เพจ / แบรนด์" route, disabled, with no data
    // behind it. That is an unbuilt destination, not a claim about a page.
    if (file.endsWith(join("shell", "nav.ts"))) continue;
    // BrandMark is the product's own logo lockup.
    if (/BrandMark|BrandLockup/.test(file)) continue;

    const claims = text.match(/[^\n]*\b(brand|แบรนด์)\b[^\n]*/gi) ?? [];
    for (const line of claims) {
      // The product's own visual identity tokens and classes are not a claim
      // that an advertiser page is a brand.
      if (/--brand|styles\.\w*[Bb]rand|iconBrand|BrandMark|BrandLockup/.test(line)) continue;
      assert.fail(`${file} presents a Brand: ${line.trim()}\nA Page is not a Brand until a reviewed mapping exists.`);
    }
  }
});
