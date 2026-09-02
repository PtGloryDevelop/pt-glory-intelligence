import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PAGE_SIZE, MAX_OFFSET, MAX_PAGE_SIZE, MAX_SEARCH_LENGTH,
  activeFilter, filterValue, isAdArchiveId, isUuid, pageOffset, pageSize, searchValue,
} from "../lib/read/request.ts";

test("only a well-formed UUID is accepted as an id", () => {
  assert.ok(isUuid("11111111-1111-4111-8111-111111111111"));
  assert.ok(isUuid("11111111-1111-4111-8111-111111111111".toUpperCase()));
  for (const bad of [
    "", "not-a-uuid", "11111111-1111-4111-8111", "11111111111141118111111111111111",
    "11111111-1111-4111-8111-111111111111'; drop table ads --",
    "../../etc/passwd", "00000000-0000-0000-0000-000000000000",
  ]) {
    assert.equal(isUuid(bad), false, `${bad} must be rejected`);
  }
});

test("ad ids are numeric strings and nothing else", () => {
  assert.ok(isAdArchiveId("828081969741692"));
  for (const bad of ["", "abc", "12 34", "1e5", "-1", "1".repeat(33), "1 or 1=1"]) {
    assert.equal(isAdArchiveId(bad), false, `${bad} must be rejected`);
  }
});

test("page size is clamped at both ends, never unbounded", () => {
  assert.equal(pageSize(null), DEFAULT_PAGE_SIZE);
  assert.equal(pageSize(""), DEFAULT_PAGE_SIZE);
  assert.equal(pageSize("abc"), DEFAULT_PAGE_SIZE, "unparseable falls back, not through");
  assert.equal(pageSize("50"), 50);
  assert.equal(pageSize("100000"), MAX_PAGE_SIZE, "an oversized page is clamped, not served");
  assert.equal(pageSize("0"), 1);
  assert.equal(pageSize("-5"), 1, "a negative page size must not reach SQL");
  assert.equal(pageSize("30.9"), 30);
  assert.equal(pageSize("Infinity"), DEFAULT_PAGE_SIZE);
  assert.equal(pageSize("NaN"), DEFAULT_PAGE_SIZE);
});

test("offset is clamped to a range a query can survive", () => {
  assert.equal(pageOffset(null), 0);
  assert.equal(pageOffset("-1"), 0);
  assert.equal(pageOffset("60"), 60);
  assert.equal(pageOffset("999999999"), MAX_OFFSET);
  assert.equal(pageOffset("abc"), 0);
});

test("filter values are trimmed, capped and never empty strings", () => {
  assert.equal(filterValue(null), null);
  assert.equal(filterValue("   "), null, "whitespace means no filter, not a filter on spaces");
  assert.equal(filterValue("  VIDEO "), "VIDEO");
  assert.equal(filterValue("x".repeat(500))?.length, 100);
  assert.equal(searchValue("ก".repeat(5000))?.length, MAX_SEARCH_LENGTH);
});

test("a search string keeps its own characters — escaping is the driver's job", () => {
  // The value travels as an RPC parameter, so % and _ are matched literally by
  // ILIKE's wildcards but can never end up as SQL syntax.
  assert.equal(searchValue("100% ฟรี'"), "100% ฟรี'");
});

test("the active filter accepts three words and rejects the rest", () => {
  assert.deepEqual(activeFilter(null), { ok: true, value: null });
  assert.deepEqual(activeFilter(""), { ok: true, value: null });
  for (const value of ["active", "inactive", "unknown"]) {
    assert.deepEqual(activeFilter(value), { ok: true, value });
  }
  for (const bad of ["ACTIVE", "true", "1", "yes", "' or 1=1"]) {
    assert.deepEqual(activeFilter(bad), { ok: false }, `${bad} must be a bad request`);
  }
});
