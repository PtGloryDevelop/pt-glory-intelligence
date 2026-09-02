import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { normalize } from "../../lib/collector/normalize.ts";
import { computeCoverage } from "../../lib/collector/coverage.ts";
import { validate } from "../../lib/collector/validate.ts";
import { goldenExport } from "../fixtures/load.ts";

/**
 * Whole-output pin for the 500-ad export (T17).
 *
 * The other collector tests assert one property each, so a normalizer change
 * that nothing thought to check can still slip through. This hashes the entire
 * canonical result: any change in any field of any of the 500 ads moves the
 * digest and fails here first.
 *
 * A failure is not automatically a bug — it means the normalizer's output
 * changed. Re-derive the digest deliberately, and only after confirming the new
 * output is what the contract should produce.
 */

const CANONICAL_DIGEST = "ad8f5414848c55b0ab915423f59378e3709120be17d2fa063ffdb12a99673fbb";
const COVERAGE_DIGEST = "079b575828c8274886b938221c80b8541ebc4a842312d6dd08876d2cb8fca3bf";

/** JSON with object keys sorted, so key order can never move the digest. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

/** The golden export, validated then normalized — the same path a real upload takes. */
function canonicalGolden() {
  const result = validate(goldenExport());
  assert.ok(result.ok, "the golden fixture must still validate");
  return normalize(result.file);
}

const digest = (value: unknown) =>
  createHash("sha256").update(stableStringify(value)).digest("hex");

test("the canonical output of the golden export is byte-stable", () => {
  const canonical = canonicalGolden();
  assert.equal(canonical.ads.length, 500);
  assert.equal(canonical.pages.length, 309);
  assert.equal(digest(canonical), CANONICAL_DIGEST);
});

test("the data-quality baseline of the golden export is frozen", () => {
  const coverage = computeCoverage(canonicalGolden());
  assert.equal(coverage.length, 20);
  // Every row still carries present/total alongside the ratio.
  for (const row of coverage) {
    assert.equal(row.totalCount, 500);
    assert.equal(row.coverage, row.presentCount / row.totalCount);
  }
  assert.equal(digest(coverage), COVERAGE_DIGEST);
});
