import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnedLibraryQuery } from "../lib/owned-ads/library-query.ts";

test("owned library URLs restore every filter while preserving the reported-spend default", () => {
  assert.deepEqual(parseOwnedLibraryQuery(new URLSearchParams()), { search: "", account: "", status: "", page: 0, hasSpend: true });
  const filters = parseOwnedLibraryQuery(new URLSearchParams({ q: "กาแฟ", account: "act_123", status: "PAUSED", page: "3", spend: "all" }));
  assert.deepEqual(filters, { search: "กาแฟ", account: "act_123", status: "PAUSED", page: 3, hasSpend: false });
  assert.deepEqual(parseOwnedLibraryQuery(new URLSearchParams({ q: filters.search, account: filters.account, status: filters.status, page: String(filters.page), spend: filters.hasSpend ? "reported" : "all" })), filters);
  for (const page of ["-1", "1.5", "100001", "NaN", "Infinity", "9007199254740992"]) assert.equal(parseOwnedLibraryQuery(new URLSearchParams({ page })).page, 0);
  const invalid = parseOwnedLibraryQuery(new URLSearchParams({ q: "x".repeat(161), account: "x".repeat(129), status: "invented", spend: "invented" }));
  assert.equal(invalid.search.length, 160);
  assert.equal(invalid.account, "");
  assert.equal(invalid.status, "");
  assert.equal(invalid.hasSpend, true);
});
