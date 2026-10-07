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

/**
 * A refusal is not a claim.
 *
 * Some screens have to say outright that a number is NOT market share and NOT
 * an ad budget — that sentence is the reason a reader does not invent one. A
 * plain substring scan cannot tell "ส่วนแบ่งตลาด" from "ไม่ใช่ส่วนแบ่งตลาด", so
 * the negations are removed first and everything left standing is a claim.
 *
 * Deliberately narrow: only a negation immediately in front of the term counts,
 * so nothing can smuggle a metric in by denying it somewhere else on the page.
 */
const DENIALS =
  /(ไม่ใช่|ไม่ได้บอก|ไม่มี|ไม่ได้แปลว่า)(ส่วนแบ่งตลาด|งบโฆษณา|ยอดขาย|การเข้าถึง|การมีส่วนร่วม|โฆษณาที่ชนะ)/g;

// Owned reports have an independent, authorized performance source. Keep this
// exception bounded to those routes; the Ad Library contract is unchanged.
const OWNED_SURFACES = [join("app", "(app)", "owned-ads") + "/", join("app", "api", "owned-ads") + "/",join('app','(app)','owned-performance.tsx'),join('app','(app)','compare','ads')+'/',join('app','(app)','dashboard.tsx'),join('app','api','dashboard')+'/',join('app','(app)','command-center')+'/']
  .map((path) => path.replaceAll("\\", "/"));

test("public competitor surfaces never claim unavailable performance metrics", () => {
  for (const { file, text } of renderedSource()) {
    if (OWNED_SURFACES.some((prefix) => file.replaceAll("\\", "/").startsWith(prefix))) continue;
    const claims = text.replace(DENIALS, " ");
    for (const pattern of FORBIDDEN) {
      assert.ok(
        !pattern.test(claims),
        `${file} names ${pattern} — the source carries no such field, so the UI must not claim one`,
      );
    }
  }
});

test('mixed own/rival screens read financial fields only from owned data',()=>{
  const comparison=readFileSync(join('app','(app)','compare','ads','comparison.tsx'),'utf8');
  assert.doesNotMatch(comparison,/\bb\??\.(?:spend|roas|purchases|purchase_value|conversations|impressions)\b/);
  const dashboard=readFileSync(join('app','(app)','dashboard.tsx'),'utf8');
  assert.doesNotMatch(dashboard,/\brivals\??\.(?:spend|roas|purchases|purchase_value|conversations|impressions)\b/);
});

/**
 * The Brand mapping surfaces (P2.8), where a Brand is the subject rather than a
 * claim about a Page. They exist because a reviewed mapping now does: a person
 * created the Brand, attached the Page, and their name is on the row.
 * Everywhere else the ban below still holds.
 */
const BRAND_SURFACES = [
  join("app", "(app)", "brands"),
  join("app", "(app)", "unmapped-pages"),
  join("components", "brand"),
  join("app", "api", "brands"),
  join("app", "api", "brand-mappings"),
];

test("a Page is never presented as a Brand", () => {
  for (const { file, text } of renderedSource()) {
    // The sidebar lists routes, some still unbuilt. A destination is not a
    // claim about a page.
    if (file.endsWith(join("shell", "nav.ts"))) continue;
    // BrandMark is the product's own logo lockup.
    if (/BrandMark|BrandLockup/.test(file)) continue;
    // The mapping surfaces are about Brands by definition.
    if (BRAND_SURFACES.some((dir) => file.startsWith(dir))) continue;

    const claims = text.match(/[^\n]*\b(brand|แบรนด์)\b[^\n]*/gi) ?? [];
    for (const line of claims) {
      // The product's own visual identity tokens and classes are not a claim
      // that an advertiser page is a brand.
      if (/--brand|styles\.\w*[Bb]rand|iconBrand|BrandMark|BrandLockup/.test(line)) continue;
      /*
       * A Page surface may show the mapping, but only through the labelled
       * constant — "Brand (จัดกลุ่มโดย PT Glory)" — which says who grouped it.
       * An unlabelled brand name beside a page would read as something Meta
       * reported.
       */
      if (/BRAND_ON_PAGE_LABEL|getPageBrand|MapPageControl|pageBrand|"page-brand"/.test(line)) {
        continue;
      }
      assert.fail(`${file} presents a Brand: ${line.trim()}\nA Page is not a Brand until a reviewed mapping exists.`);
    }
  }
});

test("the brand a page belongs to is always labelled as ours", () => {
  const label = readFileSync(join("lib", "brands", "contract.ts"), "utf8");
  assert.match(label, /BRAND_ON_PAGE_LABEL =\s*"Brand \(จัดกลุ่มโดย PT Glory\)"/);

  // A Brand never replaces a Page's identity, however many Pages it holds: the
  // page's own observed name stays the title of its page.
  const detail = readFileSync(join("app", "(app)", "pages", "[pageId]", "page.tsx"), "utf8");
  assert.match(detail, /title=\{detail\.page_name \?\? detail\.page_id\}/);
  assert.ok(!/title=\{brand/.test(detail));
});
