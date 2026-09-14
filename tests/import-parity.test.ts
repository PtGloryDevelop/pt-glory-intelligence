import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { analyzeImport } from "../lib/import/analyze.ts";
import { goldenText, syntheticExport, GOLDEN_EXPECTED } from "./fixtures/load.ts";

/**
 * C09 — the two entrances to the same import.
 *
 * A person uploading a file goes through `previewImport`, which needs their
 * session to count the ads the database already holds. The collector has no
 * session, so it calls `analyzeImport` directly.
 *
 * The parity that matters is that there is only ONE validator and ONE
 * normalizer, and that the preview wrapper adds a database lookup rather than a
 * second opinion. `previewImport` itself cannot be loaded in this runner — it
 * reaches `next/headers` through the request-scoped read client, which only
 * resolves inside a Next build — so the delegation is proved from the source and
 * the shared half is exercised directly.
 */

const preview = readFileSync("lib/import/preview.ts", "utf8");

test("the preview wrapper delegates rather than re-deciding", () => {
  // It calls the same analysis the collector calls.
  assert.match(preview, /analyzeImport\(text\)/);
  // It returns that analysis unchanged, plus exactly two database-derived counts.
  assert.match(preview, /\.\.\.analysis/);
  assert.match(preview, /existingAds/);
  assert.match(preview, /newAds: analysis\.canonical\.ads\.length - existingAds/);
  // A rejection is passed straight back: no second judgement of the same file.
  assert.match(preview, /if \(!analysis\.ok\) return analysis;/);
  // And it owns no validation or normalization of its own.
  assert.doesNotMatch(preview, /from "\.\.\/collector\/(validate|normalize|counts|coverage)\.ts"/);
});

test("the shared analysis reads a real export the same way every time", () => {
  const text = goldenText();
  const first = analyzeImport(text);
  const second = analyzeImport(text);
  assert.ok(first.ok && second.ok);

  assert.deepEqual(first.canonical, second.canonical);
  assert.deepEqual(first.reported, second.reported);
  assert.deepEqual(first.computed, second.computed);
  assert.deepEqual(first.counts, second.counts);
  assert.deepEqual(first.computed, {
    sourceRows: GOLDEN_EXPECTED.sourceRows,
    uniqueAds: GOLDEN_EXPECTED.uniqueAds,
    uniquePages: GOLDEN_EXPECTED.uniquePages,
    unresolvedCount: GOLDEN_EXPECTED.unresolvedCount,
  });
});

test("a rejected file is rejected with the same reason on both paths", () => {
  const broken = JSON.stringify(syntheticExport({ ads: "not an array" }));
  const analysis = analyzeImport(broken);
  assert.equal(analysis.ok, false);
  // The wrapper hands this very object back, so the rejection a person sees and
  // the rejection the collector records carry the same reason and detail.
  assert.match(preview, /export type PreviewRejection = AnalysisRejection;/);
});

test("reported counts that disagree with the rows reject, identically on both paths", () => {
  const disagreeing = JSON.stringify(syntheticExport({ source_rows: 99 }));
  const analysis = analyzeImport(disagreeing);
  assert.equal(analysis.ok, false);
  assert.equal(analysis.ok === false ? analysis.reason : null, "count_mismatch");
  assert.match(analysis.ok === false ? analysis.detail : "", /reported 99 \/ computed 1/);
});
