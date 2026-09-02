import assert from "node:assert/strict";
import test from "node:test";
import {
  ADVANCED_KEYS, ALL_KEYS, DEFAULT_SORT, PRIMARY_KEYS, SORTS,
  appliedFilters, chipLabel, fromQuery, toQuery,
} from "../lib/explorer/filters.ts";
import { SORT_KEYS, boolFilter, dateFilter, intFilter, sortKey } from "../lib/read/request.ts";

/**
 * The filter contract. The toolbar, the API route and any future dashboard
 * drilldown all speak it, so a link built by one has to be understood by the
 * others.
 */

test("the client's sort list and the server's allowlist are the same set", () => {
  assert.deepEqual(
    SORTS.map((option) => option.key).sort(),
    [...SORT_KEYS].sort(),
    "a sort the UI offers but the server refuses would 400 on click",
  );
  assert.ok(SORT_KEYS.includes(DEFAULT_SORT as never));
});

test("a sort key is never a column name", () => {
  for (const bad of ["start_date", "start_date desc", "ads.start_date", "1", "; drop table ads"]) {
    assert.equal(sortKey(bad).ok, false, bad);
  }
  assert.deepEqual(sortKey(null), { ok: true, value: DEFAULT_SORT });
  assert.deepEqual(sortKey("most_reused"), { ok: true, value: "most_reused" });
});

test("a three-valued flag refuses anything that is not yes or no", () => {
  assert.deepEqual(boolFilter(null), { ok: true, value: null }, "absent means any");
  assert.deepEqual(boolFilter("true"), { ok: true, value: true });
  assert.deepEqual(boolFilter("false"), { ok: true, value: false });
  for (const bad of ["1", "0", "yes", "TRUE", "null"]) {
    assert.equal(boolFilter(bad).ok, false, `${bad} must not widen the query to any`);
  }
});

test("dates and counts are parsed or refused, never coerced to nothing", () => {
  assert.equal(dateFilter("2026-08-01").ok, true);
  assert.equal(dateFilter("not-a-date").ok, false);
  assert.equal(dateFilter(null).ok, true);

  assert.deepEqual(intFilter("12"), { ok: true, value: 12 });
  assert.deepEqual(intFilter("0"), { ok: true, value: 0 });
  assert.equal(intFilter("-1").ok, false);
  assert.equal(intFilter("abc").ok, false);
  // Clamped rather than refused: a huge number is answerable, just empty.
  assert.equal((intFilter("99999999") as { value: number }).value, 100_000);
});

test("a URL round-trips into the same research state", () => {
  const filters = { platform: "INSTAGRAM", evergreen: "true", ageMin: "90", page: "12345" };
  const query = toQuery(filters, "most_reused", 60);
  const back = fromQuery(new URLSearchParams(query.toString()));
  assert.deepEqual(back.filters, filters);
  assert.equal(back.sort, "most_reused");
  assert.equal(back.offset, 60);
});

test("defaults are left out of the URL, and junk in the URL does not become state", () => {
  assert.equal(toQuery({}, DEFAULT_SORT, 0).toString(), "");
  const junk = fromQuery(new URLSearchParams("sort=hack&offset=-5&nonsense=1&format="));
  assert.equal(junk.sort, DEFAULT_SORT);
  assert.equal(junk.offset, 0);
  assert.deepEqual(junk.filters, {}, "an unknown parameter is not a filter");
});

test("a drilldown link is enough on its own", () => {
  // What a future dashboard would link to. It must read back as one applied
  // filter, with no toolbar interaction needed to make it real.
  const state = fromQuery(new URLSearchParams("evergreen=true"));
  assert.deepEqual(appliedFilters(state.filters), [{ key: "evergreen", value: "true" }]);
  assert.equal(chipLabel("evergreen", "true"), "Evergreen");
  assert.equal(chipLabel("evergreen", "false"), "ไม่Evergreen");
  assert.equal(chipLabel("page", "12345", "ร้านตัวอย่าง"), "เพจ: ร้านตัวอย่าง");
});

test("the toolbar stays small: six primary filters, the rest behind Advanced", () => {
  assert.equal(PRIMARY_KEYS.length, 6);
  assert.equal(new Set(ALL_KEYS).size, ALL_KEYS.length, "no key is in both groups");
  for (const key of PRIMARY_KEYS) {
    assert.ok(!ADVANCED_KEYS.includes(key), `${key} must not be in both`);
  }
});

test("no forbidden metric can be filtered or sorted by", () => {
  const forbidden = [
    "spend", "reach", "impressions", "engagement", "reactions", "comments",
    "shares", "ctr", "cpc", "cpa", "roas", "sales", "conversion", "share",
    "winning", "estimated",
  ];
  const surface = [...ALL_KEYS, ...SORTS.map((option) => option.key)].join(" ").toLowerCase();
  for (const word of forbidden) {
    assert.ok(!surface.includes(word), `${word} must not appear in the filter contract`);
  }
});
