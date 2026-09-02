import assert from "node:assert/strict";
import test from "node:test";
import { MAX_BYTES, MAX_RECORDS } from "../lib/collector/contract.ts";
import { analyzeImport } from "../lib/import/analyze.ts";

/**
 * The import entry point's own guards.
 *
 * previewImport is what both HTTP routes call, so a limit that only validateRaw
 * knows about is not enforced anywhere real unless this path reaches it. An
 * earlier version parsed the JSON itself and skipped the byte ceiling entirely;
 * these are the cases that would have caught that.
 *
 * All of them reject before any database work, so no DATABASE_URL is needed.
 */

test("a file over the byte ceiling is rejected before it is parsed", () => {
  // Valid JSON, just too large: proves the size check runs first rather than
  // the file happening to fail for some other reason.
  const filler = "x".repeat(MAX_BYTES + 1);
  const result = analyzeImport(JSON.stringify({ schema_version: "v1", pad: filler }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "size_limit_exceeded");
});

test("malformed JSON is a typed rejection, not a thrown error", () => {
  const result = analyzeImport("{ not json");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "malformed_json");
});

test("an empty body is rejected rather than treated as an empty export", () => {
  const result = analyzeImport("");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "malformed_json");
});

test("a JSON array is not an export", () => {
  const result = analyzeImport("[]");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "schema_mismatch");
});

test("too many records is rejected without touching the database", () => {
  const row = { ad_archive_id: "1", page_id: "1", start_date: "2026-01-01T00:00:00.000Z" };
  const result = analyzeImport(JSON.stringify({
    schema_version: "pt-glory-meta-ad-library-export.v1",
    generated_at: "2026-08-28T00:00:00.000Z",
    source: { collection_method: "network_response_observation" },
    ads: Array.from({ length: MAX_RECORDS + 1 }, () => row),
    unresolved_ads: [],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "size_limit_exceeded");
});

test("a forbidden performance field rejects the whole file", () => {
  const result = analyzeImport(JSON.stringify({
    schema_version: "pt-glory-meta-ad-library-export.v1",
    generated_at: "2026-08-28T00:00:00.000Z",
    source: { collection_method: "network_response_observation" },
    ads: [{
      ad_archive_id: "1", page_id: "1", start_date: "2026-01-01T00:00:00.000Z",
      impressions: 10_000,
    }],
    unresolved_ads: [],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unknown_field");
  assert.match(result.detail, /impressions/);
});

test("a rejection detail never carries the uploaded payload back", () => {
  const secret = "SECRET-PAYLOAD-VALUE-9137";
  const result = analyzeImport(JSON.stringify({
    schema_version: "pt-glory-meta-ad-library-export.v1",
    generated_at: "2026-08-28T00:00:00.000Z",
    source: { collection_method: "not_a_real_method", note: secret },
    ads: [], unresolved_ads: [],
  }));
  assert.equal(result.ok, false);
  assert.ok(!result.detail.includes(secret), "reject reasons must not echo file contents back");
});
